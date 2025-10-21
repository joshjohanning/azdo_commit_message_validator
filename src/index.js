'use strict';
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            }
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, 'default', { enumerable: true, value: v });
      }
    : function (o, v) {
        o['default'] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null)
      for (var k in mod)
        if (k !== 'default' && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
  };
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator['throw'](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, '__esModule', { value: true });
const core = __importStar(require('@actions/core'));
const github = __importStar(require('@actions/github'));
const mainLinker = __importStar(require('./main'));

const AB_PATTERN = /AB#[0-9]+/gi;

async function run() {
  return __awaiter(this, void 0, void 0, function* () {
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
        yield checkCommitsForWorkItems(
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
        yield checkPullRequestForWorkItems(octokit, context, pullNumber, commentOnFailure);
      }
    } catch (error) {
      core.setFailed(`Action failed with error: ${error}`);
    }
  });
}

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
  return __awaiter(this, void 0, void 0, function* () {
    const { owner, repo } = context.repo;

    // Get all commits in the pull request
    const commits = yield octokit.paginate(octokit.rest.pulls.listCommits, {
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
            yield addOrUpdateComment(
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

            yield mainLinker.run();
            console.log('...PR linked to work item');
          }
        }
      }
    }
  });
}

async function checkPullRequestForWorkItems(octokit, context, pullNumber, commentOnFailure) {
  return __awaiter(this, void 0, void 0, function* () {
    const { owner, repo } = context.repo;

    // Get pull request details
    const pullRequest = yield octokit.rest.pulls.get({
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
        yield addOrUpdateComment(
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
      const comments = yield octokit.paginate(octokit.rest.issues.listComments, {
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
        yield octokit.rest.issues.updateComment({
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
  });
}

async function addOrUpdateComment(octokit, context, pullNumber, commentBody, searchText) {
  return __awaiter(this, void 0, void 0, function* () {
    const { owner, repo } = context.repo;
    const currentDateTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const commentExtra = `\n\n[View workflow run for details](${context.payload.repository?.html_url}/actions/runs/${context.runId}) _(last ran: ${currentDateTime})_`;
    const commentCombined = commentBody + commentExtra;

    // Get all comments
    const comments = yield octokit.paginate(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: pullNumber
    });

    // Find existing comment
    const existingComment = comments.find(comment => comment.body?.includes(searchText));

    if (existingComment) {
      console.log(`Comment already exists: ${existingComment.id}`);
      console.log('... attempting to update the PR comment');
      yield octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingComment.id,
        body: commentCombined
      });
      console.log('... PR comment updated');
    } else {
      console.log('Comment does not exist. Posting a new comment.');
      yield octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: commentCombined
      });
    }
  });
}

run();
