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
import { run as linkWorkItem, validateWorkItemExists } from './link-work-item.js';

/** Regex pattern to match Azure DevOps work item references (AB#123) */
const AB_PATTERN = /AB#[0-9]+/gi;

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
    const checkCommits = core.getInput('check-commits') === 'true';
    const failIfMissingWorkitemCommitLink = core.getInput('fail-if-missing-workitem-commit-link') === 'true';
    const linkCommitsToPullRequest = core.getInput('link-commits-to-pull-request') === 'true';
    const azureDevopsToken = core.getInput('azure-devops-token');
    const azureDevopsOrganization = core.getInput('azure-devops-organization');
    const githubToken = core.getInput('github-token');
    const commentOnFailure = core.getInput('comment-on-failure') === 'true';
    const validateWorkItemExistsFlag = core.getInput('validate-work-item-exists') === 'true';

    // Get context
    const context = github.context;
    const pullNumber = context.payload.pull_request?.number;

    if (!pullNumber) {
      core.setFailed('This action can only be run on pull requests');
      return;
    }

    const octokit = github.getOctokit(githubToken);

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
        workItemToCommitMap
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
        console.log(`Found existing invalid work item comment: ${existingInvalidWorkItemComment.id}`);
        const currentDateTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const commentExtra = `\n<details>\n<summary>Workflow run details</summary>\n\n[View workflow run](${context.payload.repository?.html_url}/actions/runs/${context.runId}) - _Last ran: ${currentDateTime} UTC_\n</details>`;
        const successCommentCombined =
          `${COMMENT_MARKERS.INVALID_WORK_ITEMS}\n:white_check_mark: All work items referenced in this pull request now exist in Azure DevOps.` +
          commentExtra;

        console.log('... attempting to update the invalid work item comment to success');
        await octokit.rest.issues.updateComment({
          owner,
          repo,
          comment_id: existingInvalidWorkItemComment.id,
          body: successCommentCombined
        });
        console.log('... invalid work item comment updated to success');
      }
    }
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

    console.log(`Validating new commit: ${commitSha} - ${commitMessage}`);

    if (!AB_PATTERN.test(commitMessage)) {
      // Collect invalid commits
      invalidCommits.push({ sha: commitSha, shortSha: shortCommitSha, message: commitMessage });
    } else {
      console.log('valid commit');
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
    console.log('');
    console.log('');
    console.log(errorMessage);
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
      console.log(`Found existing commit failure comment: ${existingFailureComment.id}`);
      const currentDateTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const commentExtra = `\n<details>\n<summary>Workflow run details</summary>\n\n[View workflow run](${context.payload.repository?.html_url}/actions/runs/${context.runId}) - _Last ran: ${currentDateTime} UTC_\n</details>`;
      const successCommentCombined =
        `${COMMENT_MARKERS.COMMITS_NOT_LINKED}\n:white_check_mark: All commits in this pull request are now linked to work items.` +
        commentExtra;

      console.log('... attempting to update the commit failure comment to success');
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingFailureComment.id,
        body: successCommentCombined
      });
      console.log('... commit failure comment updated to success');
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
      console.log('');
      console.log('');
      console.log(errorMessage);
      return { workItemToCommitMap, invalidWorkItems, hasCommitFailures: false };
    }

    // All commit work items are valid - return empty array
    // (Don't update success comment here - let caller handle it after checking PR too)
  }

  // Link work items to PR if enabled (after deduplication)
  if (linkCommitsToPullRequest && allWorkItems.length > 0) {
    // Remove duplicates
    const uniqueWorkItems = [...new Set(allWorkItems)];

    for (const match of uniqueWorkItems) {
      const workItemId = match.substring(3); // Remove "AB#" prefix
      console.log(`Linking work item ${workItemId} to pull request ${pullNumber}...`);

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
 * @returns {Array} Returns array of invalid work item IDs found in PR title/body
 */
async function checkPullRequestForWorkItems(
  octokit,
  context,
  pullNumber,
  commentOnFailure,
  validateWorkItemExistsFlag,
  azureDevopsOrganization,
  azureDevopsToken,
  workItemToCommitMap
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

  // Define common comment text patterns
  const FAILURE_COMMENT_TEXT = ':x: This pull request is not linked to a work item.';
  const SUCCESS_COMMENT_TEXT = ':white_check_mark: This pull request is now linked to a work item.';

  if (!AB_PATTERN.test(pullTitle + ' ' + pullBody)) {
    console.log('PR not linked to a work item');
    core.error(
      `Pull Request not linked to work item(s): The pull request #${pullNumber} is not linked to any work item(s)`
    );

    // Add comment to PR if comment-on-failure is true
    if (commentOnFailure) {
      await addOrUpdateComment(
        octokit,
        context,
        pullNumber,
        `${FAILURE_COMMENT_TEXT} Please update the title or body to include a work item and re-run the failed job to continue. Any new commits to the pull request will also re-run the job.`,
        FAILURE_COMMENT_TEXT
      );
    }

    core.setFailed(`The pull request #${pullNumber} is not linked to any work item(s)`);
  } else {
    console.log('PR linked to work item');

    // Update existing failure comment if it exists
    const comments = await octokit.paginate(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: pullNumber
    });

    const existingFailureComment = comments.find(comment => comment.body?.includes(FAILURE_COMMENT_TEXT));

    if (existingFailureComment) {
      console.log(`Found existing failure comment: ${existingFailureComment.id}`);
      const currentDateTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const commentExtra = `\n<details>\n<summary>Workflow run details</summary>\n\n[View workflow run](${context.payload.repository?.html_url}/actions/runs/${context.runId}) - _Last ran: ${currentDateTime} UTC_\n</details>`;
      const successCommentCombined = SUCCESS_COMMENT_TEXT + commentExtra;

      console.log('... attempting to update the PR comment to success');
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingFailureComment.id,
        body: successCommentCombined
      });
      console.log('... PR comment updated to success');
    }

    // Extract work items from PR body and title and validate they exist
    const workItems = (pullBody + ' ' + pullTitle).match(AB_PATTERN);
    if (workItems) {
      const uniqueWorkItems = [...new Set(workItems)];

      // Validate work items exist if enabled
      if (validateWorkItemExistsFlag && azureDevopsOrganization && azureDevopsToken) {
        const invalidWorkItems = [];

        for (const workItem of uniqueWorkItems) {
          const workItemNumber = workItem.substring(3); // Remove "AB#" prefix
          console.log(`PR title/body contains work item: ${workItemNumber}`);

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
          console.log('');
          console.log('');
          console.log(errorMessage);
          return invalidWorkItems;
        }

        // All work items valid - return empty array
        return [];
      }

      // Validation disabled - return empty array
      return [];
    }
  }

  // PR not linked to any work items - return empty array (this is handled separately)
  return [];
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
      console.log(`Comment already exists: ${existingComment.id}`);
      console.log('... attempting to update the PR comment');
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingComment.id,
        body: commentCombined
      });
      console.log('... PR comment updated');
    } else {
      console.log('Comment does not exist. Posting a new comment.');
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
