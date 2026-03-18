/**
 * Azure DevOps Commit Validator and Pull Request Linker
 *
 * This action validates that pull requests and commits contain Azure DevOps
 * work item links (e.g. `AB#123`), and automatically links the GitHub Pull
 * Request to work items found in commit messages.
 *
 * @module index
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import { run as linkWorkItem, validateWorkItemExists, getWorkItemTitle } from './link-work-item.js';

/** Regex pattern to match Azure DevOps work item references (AB#123) */
const AB_PATTERN = /AB#[0-9]+/gi;

/** Regex pattern to extract work item IDs from branch names (digit sequences preceded by start or separator) */
const BRANCH_WORK_ITEM_PATTERN = /(?:^|[/\-_])(\d+)/g;

/** HTML comment markers for identifying different validation scenarios */
export const COMMENT_MARKERS = {
  COMMITS_NOT_LINKED: '<!-- AZDO-VALIDATOR: COMMITS-NOT-LINKED -->',
  INVALID_WORK_ITEMS: '<!-- AZDO-VALIDATOR: INVALID-WORK-ITEMS -->',
  PR_NOT_LINKED: '<!-- AZDO-VALIDATOR: PR-NOT-LINKED -->'
};

/**
 * Main action entry point
 * Validates commits and pull requests for Azure DevOps work item links
 */
export async function run() {
  try {
    // Get inputs
    const checkPullRequest = core.getInput('check-pull-request') === 'true';
    const validScopes = ['title-or-body', 'body-only', 'title-only'];
    const pullRequestCheckScopeRaw = core.getInput('pull-request-check-scope');
    const pullRequestCheckScope = validScopes.includes(pullRequestCheckScopeRaw)
      ? pullRequestCheckScopeRaw
      : 'title-or-body';
    const checkCommits = core.getInput('check-commits') === 'true';
    const failIfMissingWorkitemCommitLink = core.getInput('fail-if-missing-workitem-commit-link') === 'true';
    const linkCommitsToPullRequest = core.getInput('link-commits-to-pull-request') === 'true';
    const azureDevopsToken = core.getInput('azure-devops-token');
    const azureDevopsOrganization = core.getInput('azure-devops-organization');
    const githubToken = core.getInput('github-token');
    const commentOnFailure = core.getInput('comment-on-failure') === 'true';
    const validateWorkItemExistsFlag = core.getInput('validate-work-item-exists') === 'true';
    const addWorkItemTable = core.getInput('add-work-item-table') === 'true';
    const addWorkItemFromBranch = core.getInput('add-work-item-from-branch') === 'true';

    // Warn if an invalid scope value was provided
    if (checkPullRequest && pullRequestCheckScopeRaw && !validScopes.includes(pullRequestCheckScopeRaw)) {
      core.warning(
        `Invalid value '${pullRequestCheckScopeRaw}' for 'pull-request-check-scope'. Using default 'title-or-body'. Valid values are: ${validScopes.join(', ')}`
      );
    }

    // Validate that at least one check is enabled
    if (!checkPullRequest && !checkCommits && !addWorkItemFromBranch) {
      core.setFailed(
        `At least one of 'check-commits', 'check-pull-request', or 'add-work-item-from-branch' must be set to true.`
      );
      return;
    }

    // Get context
    const context = github.context;
    const pullNumber = context.payload.pull_request?.number;

    if (!pullNumber) {
      core.setFailed('This action can only be run on pull requests');
      return;
    }

    // Validate Azure DevOps configuration if linking, work item validation, title appending, or branch extraction is enabled
    if (linkCommitsToPullRequest || validateWorkItemExistsFlag || addWorkItemTable || addWorkItemFromBranch) {
      const missingConfig = [];
      if (!azureDevopsOrganization) missingConfig.push('azure-devops-organization');
      if (!azureDevopsToken) missingConfig.push('azure-devops-token');

      if (missingConfig.length > 0) {
        const features = [];
        if (linkCommitsToPullRequest) features.push('link-commits-to-pull-request');
        if (validateWorkItemExistsFlag) features.push('validate-work-item-exists');
        if (addWorkItemTable) features.push('add-work-item-table');
        if (addWorkItemFromBranch) features.push('add-work-item-from-branch');
        core.setFailed(
          `The following input${missingConfig.length === 1 ? ' is' : 's are'} required when ${features.join(' or ')} ${features.length === 1 ? 'is' : 'are'} enabled: ${missingConfig.join(', ')}`
        );
        return;
      }
    }

    const octokit = github.getOctokit(githubToken);

    // Automatically add AB# tags from branch name if enabled
    if (addWorkItemFromBranch) {
      await addWorkItemsToPRBody(octokit, context, pullNumber, azureDevopsOrganization, azureDevopsToken);
    }

    // Store work item to commit mapping and validation results
    let workItemToCommitMap = new Map();
    let invalidWorkItemsFromCommits = [];

    // Check commits
    if (checkCommits) {
      const commitResults = await checkCommitsForWorkItems(
        octokit,
        context,
        pullNumber,
        failIfMissingWorkitemCommitLink,
        linkCommitsToPullRequest,
        commentOnFailure,
        validateWorkItemExistsFlag,
        azureDevopsOrganization,
        azureDevopsToken,
        githubToken
      );
      workItemToCommitMap = commitResults.workItemToCommitMap;
      invalidWorkItemsFromCommits = commitResults.invalidWorkItems;
    }

    // Check pull request
    let invalidWorkItemsFromPR = [];
    if (checkPullRequest) {
      invalidWorkItemsFromPR = await checkPullRequestForWorkItems(
        octokit,
        context,
        pullNumber,
        commentOnFailure,
        validateWorkItemExistsFlag,
        azureDevopsOrganization,
        azureDevopsToken,
        workItemToCommitMap,
        addWorkItemTable,
        pullRequestCheckScope
      );
    }

    // Combine all invalid work items and create ONE comment
    const allInvalidWorkItems = [...new Set([...invalidWorkItemsFromCommits, ...invalidWorkItemsFromPR])];

    if (allInvalidWorkItems.length > 0 && commentOnFailure) {
      // Build the work item list with commit info
      const workItemListItems = allInvalidWorkItems
        .map(id => {
          const commitInfo = workItemToCommitMap.get(id);
          if (commitInfo) {
            return `- \`AB#${id}\` (commit [\`${commitInfo.shortSha}\`](${context.payload.repository?.html_url}/commit/${commitInfo.sha}))`;
          }
          return `- \`AB#${id}\` (in PR title/body)`;
        })
        .join('\n');

      const workItemList =
        allInvalidWorkItems.length > 1
          ? `\n\n<details>\n<summary>View all ${allInvalidWorkItems.length} invalid work items</summary>\n${workItemListItems}</details>`
          : '';

      // For single work item, include it inline; for multiple, use dropdown only
      const workItemReference = allInvalidWorkItems.length === 1 ? ` (\`AB#${allInvalidWorkItems[0]}\`)` : '';

      await addOrUpdateComment(
        octokit,
        context,
        pullNumber,
        `${COMMENT_MARKERS.INVALID_WORK_ITEMS}\n:x: There ${allInvalidWorkItems.length === 1 ? 'is' : 'are'} ${allInvalidWorkItems.length} work item${allInvalidWorkItems.length === 1 ? '' : 's'}${workItemReference} in pull request #${pullNumber} that ${allInvalidWorkItems.length === 1 ? 'does' : 'do'} not exist in Azure DevOps. Please verify the work item${allInvalidWorkItems.length === 1 ? '' : 's'} and update the commit message${allInvalidWorkItems.length === 1 ? '' : 's'} or PR title/body.${workItemList}`,
        COMMENT_MARKERS.INVALID_WORK_ITEMS
      );
    }

    // Fail if there were any invalid work items
    if (allInvalidWorkItems.length > 0) {
      core.error(
        `Invalid work item(s): There ${allInvalidWorkItems.length === 1 ? 'is' : 'are'} ${allInvalidWorkItems.length} work item${allInvalidWorkItems.length === 1 ? '' : 's'} that ${allInvalidWorkItems.length === 1 ? 'does' : 'do'} not exist in Azure DevOps`
      );
      core.setFailed(
        `There ${allInvalidWorkItems.length === 1 ? 'is' : 'are'} ${allInvalidWorkItems.length} work item${allInvalidWorkItems.length === 1 ? '' : 's'} that ${allInvalidWorkItems.length === 1 ? 'does' : 'do'} not exist in Azure DevOps`
      );
    } else if (commentOnFailure && validateWorkItemExistsFlag) {
      // All work items are valid - check if there's an existing invalid work item comment to update to success
      const { owner, repo } = context.repo;
      const comments = await octokit.paginate(octokit.rest.issues.listComments, {
        owner,
        repo,
        issue_number: pullNumber
      });

      const existingInvalidWorkItemComment = comments.find(comment =>
        comment.body?.includes(COMMENT_MARKERS.INVALID_WORK_ITEMS)
      );

      if (existingInvalidWorkItemComment) {
        core.info(`Found existing invalid work item comment: ${existingInvalidWorkItemComment.id}`);
        const currentDateTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const commentExtra = `\n<details>\n<summary>Workflow run details</summary>\n\n[View workflow run](${context.payload.repository?.html_url}/actions/runs/${context.runId}) - _Last ran: ${currentDateTime} UTC_\n</details>`;
        const successCommentCombined = `${COMMENT_MARKERS.INVALID_WORK_ITEMS}\n:white_check_mark: All work items referenced in this pull request now exist in Azure DevOps.${commentExtra}`;

        core.info('... attempting to update the invalid work item comment to success');
        await octokit.rest.issues.updateComment({
          owner,
          repo,
          comment_id: existingInvalidWorkItemComment.id,
          body: successCommentCombined
        });
        core.info('... invalid work item comment updated to success');
      }
    }

    // Write job summary once at the end (summary content was added throughout execution)
    await core.summary.write();
  } catch (error) {
    core.setFailed(`Action failed with error: ${error}`);
  }
}

/**
 * Check all commits in the pull request for Azure DevOps work item links
 *
 * @param {Object} octokit - GitHub API client
 * @param {Object} context - GitHub Actions context
 * @param {number} pullNumber - Pull request number
 * @param {boolean} failIfMissingWorkitemCommitLink - Whether to fail if commit lacks work item
 * @param {boolean} linkCommitsToPullRequest - Whether to link work items to PR
 * @param {boolean} commentOnFailure - Whether to comment on PR if validation fails
 * @param {boolean} validateWorkItemExistsFlag - Whether to validate work items exist in Azure DevOps
 * @param {string} azureDevopsOrganization - Azure DevOps organization name
 * @param {string} azureDevopsToken - Azure DevOps PAT token
 * @param {string} githubToken - GitHub token
 * @returns {Object} Returns {workItemToCommitMap: Map, invalidWorkItems: Array, hasCommitFailures: boolean}
 */
async function checkCommitsForWorkItems(
  octokit,
  context,
  pullNumber,
  failIfMissingWorkitemCommitLink,
  linkCommitsToPullRequest,
  commentOnFailure,
  validateWorkItemExistsFlag,
  azureDevopsOrganization,
  azureDevopsToken,
  githubToken
) {
  const { owner, repo } = context.repo;

  // Get all commits in the pull request
  const commits = await octokit.paginate(octokit.rest.pulls.listCommits, {
    owner,
    repo,
    pull_number: pullNumber
  });

  // Collect all work items from commits for deduplication
  const allWorkItems = [];
  const workItemToCommitMap = new Map(); // Track which commit each work item comes from
  const invalidCommits = [];

  for (const commit of commits) {
    const commitSha = commit.sha;
    const shortCommitSha = commitSha.substring(0, 7);
    const commitMessage = commit.commit.message;

    core.info(`Validating new commit: ${commitSha} - ${commitMessage}`);

    if (!AB_PATTERN.test(commitMessage)) {
      // Collect invalid commits
      invalidCommits.push({ sha: commitSha, shortSha: shortCommitSha, message: commitMessage });
    } else {
      core.info('valid commit');
      // Extract work item number(s)
      const workItemMatches = commitMessage.match(AB_PATTERN);
      if (workItemMatches) {
        // Collect work items for later deduplication
        allWorkItems.push(...workItemMatches);
        // Track which commit each work item comes from (first occurrence)
        for (const match of workItemMatches) {
          const workItemId = match.substring(3);
          if (!workItemToCommitMap.has(workItemId)) {
            workItemToCommitMap.set(workItemId, { sha: commitSha, shortSha: shortCommitSha });
          }
        }
      }
    }
  }

  // Handle invalid commits if any were found
  if (invalidCommits.length > 0 && failIfMissingWorkitemCommitLink) {
    const firstInvalidCommit = invalidCommits[0];
    const errorMessage = `Pull request contains invalid commit: ${firstInvalidCommit.sha}. This commit lacks an \`AB#xxx\` in the message, in the expected format: \`AB#xxx\` -- failing operation.`;
    core.info('');
    core.info('');
    core.info(errorMessage);
    core.error(
      `Commit(s) not linked to work items: There ${invalidCommits.length === 1 ? 'is' : 'are'} ${invalidCommits.length} commit${invalidCommits.length === 1 ? '' : 's'} in pull request #${pullNumber} not linked to work items`
    );

    // Add comment to PR if comment-on-failure is true
    if (commentOnFailure) {
      // Build the commit list for the dropdown
      const commitListItems = invalidCommits
        .map(
          c =>
            `- [\`${c.shortSha}\`](${context.payload.repository?.html_url}/commit/${c.sha}) - ${c.message.split('\n')[0]}`
        )
        .join('\n');

      // For single commit, include it inline; for multiple, use dropdown
      const firstCommit = invalidCommits[0];
      const commitReference =
        invalidCommits.length === 1
          ? ` ([\`${firstCommit.shortSha}\`](${context.payload.repository?.html_url}/commit/${firstCommit.sha}))`
          : '';

      const commitDetails =
        invalidCommits.length > 1
          ? `\n\n<details>\n<summary>View all ${invalidCommits.length} commits missing work items</summary>\n${commitListItems}</details>`
          : '';

      await addOrUpdateComment(
        octokit,
        context,
        pullNumber,
        `${COMMENT_MARKERS.COMMITS_NOT_LINKED}\n:x: There ${invalidCommits.length === 1 ? 'is' : 'are'} ${invalidCommits.length} commit${invalidCommits.length === 1 ? '' : 's'}${commitReference} in pull request #${pullNumber} not linked to ${invalidCommits.length === 1 ? 'a work item' : 'work items'}. Please amend the commit message${invalidCommits.length === 1 ? '' : 's'} to include a work item reference (\`AB#xxx\`) and re-run the failed job to continue. Any new commits to the pull request will also re-run the job.${commitDetails}`,
        COMMENT_MARKERS.COMMITS_NOT_LINKED
      );
    }

    core.setFailed(
      `There ${invalidCommits.length === 1 ? 'is' : 'are'} ${invalidCommits.length} commit${invalidCommits.length === 1 ? '' : 's'} in pull request #${pullNumber} not linked to work items`
    );
    return { workItemToCommitMap, invalidWorkItems: [], hasCommitFailures: true };
  }

  // All commits are valid - check if there's an existing failure comment to update
  if (commentOnFailure) {
    const comments = await octokit.paginate(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: pullNumber
    });

    const existingFailureComment = comments.find(comment => comment.body?.includes(COMMENT_MARKERS.COMMITS_NOT_LINKED));

    if (existingFailureComment) {
      core.info(`Found existing commit failure comment: ${existingFailureComment.id}`);
      const currentDateTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const commentExtra = `\n<details>\n<summary>Workflow run details</summary>\n\n[View workflow run](${context.payload.repository?.html_url}/actions/runs/${context.runId}) - _Last ran: ${currentDateTime} UTC_\n</details>`;
      const successCommentCombined = `${COMMENT_MARKERS.COMMITS_NOT_LINKED}\n:white_check_mark: All commits in this pull request are now linked to work items.${commentExtra}`;

      core.info('... attempting to update the commit failure comment to success');
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingFailureComment.id,
        body: successCommentCombined
      });
      core.info('... commit failure comment updated to success');
    }
  }

  // Validate work items exist if enabled
  if (validateWorkItemExistsFlag && azureDevopsOrganization && azureDevopsToken && allWorkItems.length > 0) {
    const uniqueWorkItems = [...new Set(allWorkItems)];
    const invalidWorkItems = [];

    for (const match of uniqueWorkItems) {
      const workItemId = match.substring(3); // Remove "AB#" prefix
      const exists = await validateWorkItemExists(azureDevopsOrganization, azureDevopsToken, workItemId);

      if (!exists) {
        invalidWorkItems.push(workItemId);
      }
    }

    // If invalid work items found, return them (don't comment/fail here - let caller handle it)
    if (invalidWorkItems.length > 0) {
      const errorMessage = `Pull request contains ${invalidWorkItems.length === 1 ? 'an' : ''} invalid work item${invalidWorkItems.length === 1 ? '' : 's'}: ${invalidWorkItems.join(', ')}. ${invalidWorkItems.length === 1 ? 'This work item does' : 'These work items do'} not exist in Azure DevOps -- failing operation.`;
      core.info('');
      core.info('');
      core.info(errorMessage);
      return { workItemToCommitMap, invalidWorkItems, hasCommitFailures: false };
    }

    // All commit work items are valid - return empty array
    // (Don't update success comment here - let caller handle it after checking PR too)
  }

  // Process work items found in commits (after deduplication)
  if (allWorkItems.length > 0) {
    // Remove duplicates
    const uniqueWorkItems = [...new Set(allWorkItems)];

    for (const match of uniqueWorkItems) {
      const workItemId = match.substring(3); // Remove "AB#" prefix
      const commitInfo = workItemToCommitMap.get(workItemId);

      // Link work items to PR if enabled
      if (linkCommitsToPullRequest) {
        core.info(`Linking work item ${workItemId} to pull request ${pullNumber}...`);

        // Set environment variables for main.js
        process.env.REPO_TOKEN = githubToken;
        process.env.AZURE_DEVOPS_ORG = azureDevopsOrganization;
        process.env.AZURE_DEVOPS_PAT = azureDevopsToken;
        process.env.WORKITEMID = workItemId;
        process.env.PULLREQUESTID = pullNumber.toString();
        process.env.REPO = `${context.repo.owner}/${context.repo.repo}`;
        process.env.GITHUB_SERVER_URL = process.env.GITHUB_SERVER_URL || 'https://github.com';

        await linkWorkItem();
      }

      // Add job summary for visibility (regardless of linking setting)
      if (commitInfo) {
        if (linkCommitsToPullRequest) {
          core.summary.addRaw(
            `- ✅ **Linked:** Work item AB#${workItemId} (from commit [\`${commitInfo.shortSha}\`](${context.payload.repository?.html_url}/commit/${commitInfo.sha})) linked to PR #${pullNumber}\n`
          );
        } else {
          core.summary.addRaw(
            `- ✔️ **Verified:** Work item AB#${workItemId} found in commit [\`${commitInfo.shortSha}\`](${context.payload.repository?.html_url}/commit/${commitInfo.sha})\n`
          );
        }
      }
    }
  }

  // Return the workItemToCommitMap and validation results for use in PR validation
  return { workItemToCommitMap, invalidWorkItems: [], hasCommitFailures: false };
}

/**
 * Check pull request title and body for Azure DevOps work item links
 *
 * @param {Object} octokit - GitHub API client
 * @param {Object} context - GitHub Actions context
 * @param {number} pullNumber - Pull request number
 * @param {boolean} commentOnFailure - Whether to comment on PR if validation fails
 * @param {boolean} validateWorkItemExistsFlag - Whether to validate work items exist in Azure DevOps
 * @param {string} azureDevopsOrganization - Azure DevOps organization name
 * @param {string} azureDevopsToken - Azure DevOps PAT token
 * @param {Map} workItemToCommitMap - Map of work item IDs to commit info from checkCommitsForWorkItems
 * @param {boolean} addWorkItemTable - Whether to add a work item titles table to the PR body
 * @param {string} pullRequestCheckScope - Where to look for AB# in the PR: 'title-or-body', 'body-only', or 'title-only'
 * @returns {Array} Returns array of invalid work item IDs found in the PR based on pullRequestCheckScope
 */
async function checkPullRequestForWorkItems(
  octokit,
  context,
  pullNumber,
  commentOnFailure,
  validateWorkItemExistsFlag,
  azureDevopsOrganization,
  azureDevopsToken,
  workItemToCommitMap,
  addWorkItemTable = false,
  pullRequestCheckScope = 'title-or-body'
) {
  const { owner, repo } = context.repo;

  // Get pull request details
  const pullRequest = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber
  });

  const pullBody = pullRequest.data.body || '';
  const pullTitle = pullRequest.data.title || '';

  // Determine which text to check based on pull-request-check-scope
  let textToCheck;
  let scopeDescription;
  switch (pullRequestCheckScope) {
    case 'body-only':
      textToCheck = pullBody;
      scopeDescription = 'body';
      break;
    case 'title-only':
      textToCheck = pullTitle;
      scopeDescription = 'title';
      break;
    case 'title-or-body':
    default:
      textToCheck = `${pullTitle} ${pullBody}`;
      scopeDescription = 'title or body';
      break;
  }

  core.info(`Checking PR ${scopeDescription} for work item links (scope: ${pullRequestCheckScope})`);

  // Define common comment text patterns
  const FAILURE_COMMENT_TEXT = ':x: This pull request is not linked to a work item.';
  const SUCCESS_COMMENT_TEXT = ':white_check_mark: This pull request is now linked to a work item.';

  if (!AB_PATTERN.test(textToCheck)) {
    core.info('PR not linked to a work item');
    core.error(
      `Pull Request not linked to work item(s): The pull request #${pullNumber} is not linked to any work item(s)`
    );

    // Add comment to PR if comment-on-failure is true
    if (commentOnFailure) {
      await addOrUpdateComment(
        octokit,
        context,
        pullNumber,
        `${FAILURE_COMMENT_TEXT} Please update the ${scopeDescription} to include a work item and re-run the failed job to continue. Any new commits to the pull request will also re-run the job.`,
        FAILURE_COMMENT_TEXT
      );
    }

    core.setFailed(`The pull request #${pullNumber} is not linked to any work item(s)`);
  } else {
    core.info('PR linked to work item');

    // Update existing failure comment if it exists
    const comments = await octokit.paginate(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: pullNumber
    });

    const existingFailureComment = comments.find(comment => comment.body?.includes(FAILURE_COMMENT_TEXT));

    if (existingFailureComment) {
      core.info(`Found existing failure comment: ${existingFailureComment.id}`);
      const currentDateTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const commentExtra = `\n<details>\n<summary>Workflow run details</summary>\n\n[View workflow run](${context.payload.repository?.html_url}/actions/runs/${context.runId}) - _Last ran: ${currentDateTime} UTC_\n</details>`;
      const successCommentCombined = SUCCESS_COMMENT_TEXT + commentExtra;

      core.info('... attempting to update the PR comment to success');
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingFailureComment.id,
        body: successCommentCombined
      });
      core.info('... PR comment updated to success');
    }

    // Extract work items from the checked scope and validate they exist
    const workItems = textToCheck.match(AB_PATTERN);
    if (workItems) {
      const uniqueWorkItems = [...new Set(workItems)];

      // Validate work items exist if enabled
      if (validateWorkItemExistsFlag && azureDevopsOrganization && azureDevopsToken) {
        const invalidWorkItems = [];

        for (const workItem of uniqueWorkItems) {
          const workItemNumber = workItem.substring(3); // Remove "AB#" prefix
          core.info(`PR title/body contains work item: ${workItemNumber}`);

          // Add to the workItemToCommitMap to track that this came from PR title/body
          if (!workItemToCommitMap.has(workItemNumber)) {
            workItemToCommitMap.set(workItemNumber, null); // null indicates it's from PR title/body
          }

          const exists = await validateWorkItemExists(azureDevopsOrganization, azureDevopsToken, workItemNumber);

          if (!exists) {
            invalidWorkItems.push(workItemNumber);
          }
        }

        // Return invalid work items if any were found (don't comment/fail here - let caller handle it)
        if (invalidWorkItems.length > 0) {
          const errorMessage = `Pull request contains ${invalidWorkItems.length === 1 ? 'an' : ''} invalid work item${invalidWorkItems.length === 1 ? '' : 's'}: ${invalidWorkItems.join(', ')}. ${invalidWorkItems.length === 1 ? 'This work item does' : 'These work items do'} not exist in Azure DevOps -- failing operation.`;
          core.info('');
          core.info('');
          core.info(errorMessage);
          return invalidWorkItems;
        }

        // All work items valid - add job summary for each (only if not already added from commits)
        for (const workItem of uniqueWorkItems) {
          const workItemNumber = workItem.substring(3); // Remove "AB#" prefix
          // Only add to summary if this work item wasn't already added from a commit
          if (!workItemToCommitMap.has(workItemNumber) || workItemToCommitMap.get(workItemNumber) === null) {
            core.summary.addRaw(`- ✔️ **Verified:** Work item AB#${workItemNumber} found in PR title/body\n`);
          }
        }
      } else {
        // Validation disabled - add job summary for each work item (only if not already added from commits)
        for (const workItem of uniqueWorkItems) {
          const workItemNumber = workItem.substring(3); // Remove "AB#" prefix

          // Only add to map and summary if this work item wasn't already added from a commit
          if (!workItemToCommitMap.has(workItemNumber)) {
            workItemToCommitMap.set(workItemNumber, null); // null indicates it's from PR title/body
            core.summary.addRaw(`- ✔️ **Verified:** Work item AB#${workItemNumber} found in PR title/body\n`);
          }
        }
      }

      // Append work item titles to PR body if enabled
      if (addWorkItemTable && azureDevopsOrganization && azureDevopsToken) {
        await appendWorkItemTitlesToPRBody(
          octokit,
          context,
          pullNumber,
          pullBody,
          uniqueWorkItems,
          azureDevopsOrganization,
          azureDevopsToken
        );
      }

      return [];
    }
  }

  // PR not linked to any work items - return empty array (this is handled separately)
  return [];
}

/** HTML comment markers for identifying the work item titles section */
const WORK_ITEM_SECTION_START = '<!-- AZDO-VALIDATOR: WORK-ITEM-TITLES-START -->';
const WORK_ITEM_SECTION_END = '<!-- AZDO-VALIDATOR: WORK-ITEM-TITLES-END -->';

/**
 * Append work item titles to the PR body as a separate section.
 * Adds a "Linked Work Items" table at the bottom of the PR body,
 * keeping the original AB# references intact so the Azure DevOps
 * GitHub integration continues to detect them for the Development section.
 *
 * @param {Object} octokit - GitHub API client
 * @param {Object} context - GitHub Actions context
 * @param {number} pullNumber - Pull request number
 * @param {string} pullBody - Current PR body text
 * @param {Array} workItems - Array of work item references (e.g. ['AB#123', 'AB#456'])
 * @param {string} azureDevopsOrganization - Azure DevOps organization name
 * @param {string} azureDevopsToken - Azure DevOps PAT token
 */
async function appendWorkItemTitlesToPRBody(
  octokit,
  context,
  pullNumber,
  pullBody,
  workItems,
  azureDevopsOrganization,
  azureDevopsToken
) {
  const { owner, repo } = context.repo;

  // Collect work item info
  const workItemInfos = [];
  for (const workItem of workItems) {
    const workItemNumber = workItem.substring(3); // Remove "AB#" prefix
    const workItemInfo = await getWorkItemTitle(azureDevopsOrganization, azureDevopsToken, workItemNumber);
    if (workItemInfo && workItemInfo.title) {
      workItemInfos.push({ id: workItemNumber, title: workItemInfo.title, type: workItemInfo.type });
      core.summary.addRaw(
        `- 📝 **Linked work item:** ${workItemNumber} - ${workItemInfo.title} (${workItemInfo.type})\n`
      );
    }
  }

  if (workItemInfos.length === 0) {
    core.info('No work item titles found to append');
    return;
  }

  // Build the work items section
  // Avoid using AB# in the table text -- the azure-boards bot detects AB#
  // references even inside markdown links and adds duplicate Development
  // section entries. Use just the work item number as the link text.
  const devOpsBaseUrl = `https://dev.azure.com/${azureDevopsOrganization}`;
  const sanitizeCell = value => String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
  const tableRows = workItemInfos
    .map(info => {
      const workItemUrl = `${devOpsBaseUrl}/_workitems/edit/${info.id}`;
      return `| [${info.id}](${workItemUrl}) | ${sanitizeCell(info.type)} | ${sanitizeCell(info.title)} |`;
    })
    .join('\n');
  const section = [
    WORK_ITEM_SECTION_START,
    '### Linked Work Items',
    '| Work Item | Type | Title |',
    '|---|---|---|',
    tableRows,
    WORK_ITEM_SECTION_END
  ].join('\n');

  // Strip any existing work item titles section from the body
  const bodyWithoutSection = pullBody
    .replace(
      new RegExp(`\\n*---\\n${escapeRegExp(WORK_ITEM_SECTION_START)}[\\s\\S]*?${escapeRegExp(WORK_ITEM_SECTION_END)}`),
      ''
    )
    .replace(
      new RegExp(`\\n*${escapeRegExp(WORK_ITEM_SECTION_START)}[\\s\\S]*?${escapeRegExp(WORK_ITEM_SECTION_END)}`),
      ''
    );

  const updatedBody = `${bodyWithoutSection}\n\n---\n${section}`;

  if (updatedBody !== pullBody) {
    core.info('Updating PR body with work item titles...');
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: pullNumber,
      body: updatedBody
    });
    core.info('... PR body updated successfully');
  } else {
    core.info('No changes needed for PR body (work item titles section already up to date)');
  }
}

/**
 * Extract work item IDs from a branch name
 * Matches digit sequences preceded by start of string or separators (/, -, _)
 *
 * @param {string | null | undefined} branchName - The branch name to extract work item IDs from
 * @returns {string[]} Array of unique work item ID strings (e.g. ['12345', '67890'])
 */
export function extractWorkItemIdsFromBranch(branchName) {
  if (!branchName) return [];

  const ids = [];
  let match;
  // Reset lastIndex since we're using a global regex
  BRANCH_WORK_ITEM_PATTERN.lastIndex = 0;
  while ((match = BRANCH_WORK_ITEM_PATTERN.exec(branchName)) !== null) {
    ids.push(match[1]);
  }

  // Return unique IDs only
  return [...new Set(ids)];
}

/**
 * Add AB# work item tags to the PR body based on work item IDs found in the branch name.
 * Skips IDs that are already referenced in the PR body.
 * Always validates IDs against Azure DevOps before adding them.
 *
 * @param {Object} octokit - GitHub API client
 * @param {Object} context - GitHub Actions context
 * @param {number} pullNumber - Pull request number
 * @param {string} azureDevopsOrganization - Azure DevOps organization name
 * @param {string} azureDevopsToken - Azure DevOps PAT token
 */
async function addWorkItemsToPRBody(octokit, context, pullNumber, azureDevopsOrganization, azureDevopsToken) {
  const { owner, repo } = context.repo;
  const branchName = context.payload.pull_request?.head?.ref || '';

  core.info(`Extracting work item IDs from branch name: ${branchName}`);
  const workItemIds = extractWorkItemIdsFromBranch(branchName);

  if (workItemIds.length === 0) {
    core.info('No work item IDs found in branch name');
    return;
  }

  // Cap the number of IDs to validate to avoid excessive API calls
  const MAX_BRANCH_IDS = 5;
  if (workItemIds.length > MAX_BRANCH_IDS) {
    core.warning(
      `Found ${workItemIds.length} potential work item IDs in branch name, only processing the first ${MAX_BRANCH_IDS}`
    );
    workItemIds.length = MAX_BRANCH_IDS;
  }

  core.info(`Found work item ID(s) in branch: ${workItemIds.join(', ')}`);

  // Get current PR body
  const pullRequest = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber
  });

  const currentBody = pullRequest.data.body || '';

  // Filter to only IDs not already in the PR body
  const missingIds = workItemIds.filter(id => {
    const pattern = new RegExp(`AB#${id}(?!\\d)`, 'i');
    return !pattern.test(currentBody);
  });

  if (missingIds.length === 0) {
    core.info('All work item IDs from branch are already in the PR body');
    return;
  }

  // Validate IDs against Azure DevOps before adding
  let idsToAdd = missingIds;
  const validatedIds = [];
  for (const id of missingIds) {
    const exists = await validateWorkItemExists(azureDevopsOrganization, azureDevopsToken, id);
    if (exists) {
      validatedIds.push(id);
    } else {
      core.warning(
        `Work item ID ${id} extracted from branch '${branchName}' does not exist in Azure DevOps - skipping`
      );
    }
  }
  idsToAdd = validatedIds;
  if (idsToAdd.length === 0) {
    core.info('No valid work item IDs from branch to add (all failed validation)');
    return;
  }

  // Build the AB# tags to add
  const abTags = idsToAdd.map(id => `AB#${id}`).join(' ');
  const updatedBody = currentBody ? `${currentBody}\n\n${abTags}` : abTags;

  core.info(`Adding work item tag(s) to PR body: ${abTags}`);
  await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: pullNumber,
    body: updatedBody
  });
  core.info('PR body updated with work item tag(s) from branch name');
  const sanitizedBranchName = branchName.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  core.summary.addRaw(`- :link: **Added from branch:** ${abTags} extracted from branch \`${sanitizedBranchName}\`\n`);
}

/**
 * Escape special regex characters in a string
 *
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for use in RegExp
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Add or update a comment on the pull request
 *
 * @param {Object} octokit - GitHub API client
 * @param {Object} context - GitHub Actions context
 * @param {number} pullNumber - Pull request number
 * @param {string} commentBody - Comment body text
 * @param {string} searchText - Text to search for in existing comments
 */
async function addOrUpdateComment(octokit, context, pullNumber, commentBody, searchText) {
  const { owner, repo } = context.repo;
  const currentDateTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const commentExtra = `\n<details>\n<summary>Workflow run details</summary>\n\n[View workflow run](${context.payload.repository?.html_url}/actions/runs/${context.runId}) - _Last ran: ${currentDateTime} UTC_\n</details>`;
  const commentCombined = commentBody + commentExtra;

  try {
    // Get all comments
    const comments = await octokit.paginate(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: pullNumber
    });

    // Find existing comment
    const existingComment = comments.find(comment => comment.body?.includes(searchText));

    if (existingComment) {
      core.info(`Comment already exists: ${existingComment.id}`);
      core.info('... attempting to update the PR comment');
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingComment.id,
        body: commentCombined
      });
      core.info('... PR comment updated');
    } else {
      core.info('Comment does not exist. Posting a new comment.');
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: commentCombined
      });
    }
  } catch (error) {
    if (error.status === 403 && error.message.includes('Resource not accessible by integration')) {
      core.setFailed(
        'Unable to comment on pull request. The GITHUB_TOKEN does not have sufficient permissions. ' +
          'Please add "pull-requests: write" permission to your workflow. ' +
          'See: https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token'
      );
    } else {
      throw error;
    }
  }
}

// Run the action (only if not being imported for testing)
if (process.env.NODE_ENV !== 'test') {
  run();
}
