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
import { run as linkWorkItem } from './main.js';

/** Regex pattern to match Azure DevOps work item references (AB#123) */
const AB_PATTERN = /AB#[0-9]+/gi;

/**
 * Main action entry point
 * Validates commits and pull requests for Azure DevOps work item links
 */
async function run() {
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

    // Get context
    const context = github.context;
    const pullNumber = context.payload.pull_request?.number;

    if (!pullNumber) {
      core.setFailed('This action can only be run on pull requests');
      return;
    }

    const octokit = github.getOctokit(githubToken);

    // Check commits
    if (checkCommits) {
      await checkCommitsForWorkItems(
        octokit,
        context,
        pullNumber,
        failIfMissingWorkitemCommitLink,
        linkCommitsToPullRequest,
        commentOnFailure,
        azureDevopsOrganization,
        azureDevopsToken,
        githubToken
      );
    }

    // Check pull request
    if (checkPullRequest) {
      await checkPullRequestForWorkItems(octokit, context, pullNumber, commentOnFailure);
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
 * @param {string} azureDevopsOrganization - Azure DevOps organization name
 * @param {string} azureDevopsToken - Azure DevOps PAT token
 * @param {string} githubToken - GitHub token
 */
async function checkCommitsForWorkItems(
  octokit,
  context,
  pullNumber,
  failIfMissingWorkitemCommitLink,
  linkCommitsToPullRequest,
  commentOnFailure,
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

  for (const commit of commits) {
    const commitSha = commit.sha;
    const shortCommitSha = commitSha.substring(0, 7);
    const commitMessage = commit.commit.message;

    console.log(`Validating new commit: ${commitSha} - ${commitMessage}`);

    if (!AB_PATTERN.test(commitMessage)) {
      // Only fail the action if the input is true
      if (failIfMissingWorkitemCommitLink) {
        const errorMessage = `Pull request contains invalid commit: ${commitSha}. This commit lacks an AB#xxx in the message, in the expected format: AB#xxx -- failing operation.`;
        console.log('');
        console.log('');
        console.log(errorMessage);
        core.error(
          `Commit(s) not linked to work items: There is at least one commit (${shortCommitSha}) in pull request #${pullNumber} that is not linked to a work item`
        );

        // Add comment to PR if comment-on-failure is true
        if (commentOnFailure) {
          await addOrUpdateComment(
            octokit,
            context,
            pullNumber,
            `:x: There is at least one commit (${shortCommitSha}) in pull request #${pullNumber} that is not linked to a work item. Please update the commit message to include a work item reference (AB#xxx) and re-run the failed job to continue. Any new commits to the pull request will also re-run the job.`,
            `:x: There is at least one commit`
          );
        }

        core.setFailed(
          `There is at least one commit (${shortCommitSha}) in pull request #${pullNumber} that is not linked to a work item`
        );
        return;
      }
    } else {
      console.log('valid commit');
      // Extract work item number(s)
      const workItemMatches = commitMessage.match(AB_PATTERN);
      if (workItemMatches && linkCommitsToPullRequest) {
        for (const match of workItemMatches) {
          const workItemId = match.substring(3); // Remove "AB#" prefix
          console.log(`Workitem = ${workItemId}`);

          console.log(`Attempting to link work item ${workItemId} to pull request ${pullNumber}...`);

          // Set environment variables for main.js
          process.env.REPO_TOKEN = githubToken;
          process.env.AZURE_DEVOPS_ORG = azureDevopsOrganization;
          process.env.AZURE_DEVOPS_PAT = azureDevopsToken;
          process.env.WORKITEMID = workItemId;
          process.env.PULLREQUESTID = pullNumber.toString();
          process.env.REPO = `${context.repo.owner}/${context.repo.repo}`;
          process.env.GITHUB_SERVER_URL = process.env.GITHUB_SERVER_URL || 'https://github.com';

          await linkWorkItem();
          console.log('...PR linked to work item');
        }
      }
    }
  }
}

/**
 * Check pull request title and body for Azure DevOps work item links
 *
 * @param {Object} octokit - GitHub API client
 * @param {Object} context - GitHub Actions context
 * @param {number} pullNumber - Pull request number
 * @param {boolean} commentOnFailure - Whether to comment on PR if validation fails
 */
async function checkPullRequestForWorkItems(octokit, context, pullNumber, commentOnFailure) {
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
      const commentExtra = `\n\n[View workflow run for details](${context.payload.repository?.html_url}/actions/runs/${context.runId}) _(last ran: ${currentDateTime})_`;
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

    // Extract work items from PR body and title
    const workItems = (pullBody + ' ' + pullTitle).match(AB_PATTERN);
    if (workItems) {
      const uniqueWorkItems = [...new Set(workItems)];

      // Loop through each work item
      for (const workItem of uniqueWorkItems) {
        const workItemNumber = workItem.substring(3); // Remove "AB#" prefix
        console.log(`Pull request linked to work item number: ${workItemNumber}`);
      }
    }
  }
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
  const commentExtra = `\n\n[View workflow run for details](${context.payload.repository?.html_url}/actions/runs/${context.runId}) _(last ran: ${currentDateTime})_`;
  const commentCombined = commentBody + commentExtra;

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
}

// Run the action
run();
