/**
 * Azure DevOps Work Item Linker
 *
 * Links GitHub Pull Requests to Azure DevOps work items.
 * This module is responsible for creating the connection between a GitHub PR
 * and an Azure DevOps work item.
 *
 * @module link-work-item
 */

import * as core from '@actions/core';
import { azureDevOpsHeaders, azureDevOpsRequest } from './azure-devops-rest.js';

const relArtifactLink = 'ArtifactLink';
const relNameGitHubPr = 'GitHub Pull Request';
const msGitHubLinkDataProviderLink = 'ms.vss-work-web.github-link-data-provider';
const dataProviderUrlBase = `https://dev.azure.com/%DEVOPS_ORG%/_apis/Contribution/dataProviders/query?api-version=7.1-preview.1`;

/**
 * Link a GitHub Pull Request to an Azure DevOps work item
 * Reads configuration from environment variables set by index.js
 */
export async function run() {
  let hasError = false;
  try {
    const devOpsOrg = process.env.AZURE_DEVOPS_ORG;
    const azToken = process.env.AZURE_DEVOPS_PAT;
    const workItemId = process.env.WORKITEMID;
    const githubHostname = process.env.GITHUB_SERVER_URL;
    const prRequestId = process.env.PULLREQUESTID;
    const dataProviderUrl = dataProviderUrlBase.replace('%DEVOPS_ORG%', devOpsOrg);
    const repo = process.env.REPO;

    hasError = false;
    core.info('Retrieving internalRepoId ...');
    try {
      const dataProviderResponse = await fetch(dataProviderUrl, {
        method: 'POST',
        headers: azureDevOpsHeaders(azToken),
        body: JSON.stringify({
          context: {
            properties: {
              workItemId: workItemId,
              urls: [`${githubHostname}/${repo}/pull/${prRequestId}`]
            }
          },
          contributionIds: [msGitHubLinkDataProviderLink]
        })
      });

      if (dataProviderResponse.status === 401) {
        throw new Error('Missing authorization (Linking PRs to cards requires full access for the PAT).');
      }

      const responseData = await dataProviderResponse.json();
      const internalRepoId =
        responseData.data[msGitHubLinkDataProviderLink]?.resolvedLinkItems?.[0]?.repoInternalId ?? null;

      core.info(internalRepoId);
      core.info('... success!');

      if (null === internalRepoId || internalRepoId.length === 0) {
        throw new Error(`Internal repo url couldn't be resolved.`);
      }

      const artifactUrl = `vstfs:///GitHub/PullRequest/${internalRepoId}%2F${prRequestId}`;
      try {
        core.info('trying to create the pull request link ...');
        const patchDoc = [
          {
            op: 'add',
            path: '/relations/-',
            value: {
              rel: relArtifactLink,
              url: artifactUrl,
              attributes: {
                name: relNameGitHubPr,
                comment: `Pull Request ${prRequestId}`
              }
            }
          }
        ];
        await azureDevOpsRequest(
          `https://dev.azure.com/${devOpsOrg}/_apis/wit/workitems/${workItemId}?$expand=relations&api-version=7.1`,
          azToken,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json-patch+json' },
            body: JSON.stringify(patchDoc)
          }
        );
        core.info('... success!');
      } catch (exception) {
        if (exception.toString().indexOf('already exists') !== -1) {
          core.info('... (already exists) ...');
        } else {
          throw exception;
        }
      }
    } catch (exception) {
      hasError = true;
      core.info(`... failed! ${exception}`);
      core.setFailed(`Failed to retrieve internalRepoId!`);
      return;
    }

    if (!hasError) {
      core.info('... process complete!');
    }
  } catch (error) {
    core.error(error);
    core.setFailed(`Unknown error: ${error}`);
    throw error;
  }
}

/**
 * Check if an error indicates an authentication/authorization problem
 * (e.g. expired PAT, insufficient permissions).
 *
 * @param {unknown} error - The caught error
 * @returns {{ isAuthError: boolean, message: string }}
 */
function detectAuthError(error) {
  const msg = error instanceof Error ? error.message : String(error);
  const status = error?.statusCode ?? error?.status;

  if (status === 401 || status === 403) {
    return { isAuthError: true, message: msg };
  }

  const authPatterns = [
    /access denied/i,
    /personal access token.*expired/i,
    /unauthorized/i,
    /authentication failure/i,
    /AccessCheckException/i
  ];

  if (authPatterns.some(pattern => pattern.test(msg))) {
    return { isAuthError: true, message: msg };
  }

  return { isAuthError: false, message: msg };
}

/**
 * Validate that a work item exists in Azure DevOps
 *
 * @param {string} devOpsOrg - Azure DevOps organization name
 * @param {string} azToken - Azure DevOps PAT token
 * @param {string} workItemId - Work item ID to validate
 * @returns {Promise<{ exists: boolean, authError?: boolean, errorMessage?: string }>}
 */
export async function validateWorkItemExists(devOpsOrg, azToken, workItemId) {
  try {
    core.info(`Validating work item ${workItemId} exists...`);
    const workItem = await azureDevOpsRequest(
      `https://dev.azure.com/${devOpsOrg}/_apis/wit/workitems/${parseInt(workItemId, 10)}?api-version=7.1`,
      azToken
    );

    if (workItem && workItem.id) {
      core.info(`... work item ${workItemId} exists`);
      return { exists: true };
    }

    core.warning(`... work item ${workItemId} not found`);
    return { exists: false };
  } catch (error) {
    const { isAuthError, message } = detectAuthError(error);

    if (isAuthError) {
      core.error(`... authentication error while validating work item ${workItemId}: ${message}`);
      return { exists: false, authError: true, errorMessage: message };
    }

    core.warning(`... work item ${workItemId} not found: ${message}`);
    return { exists: false };
  }
}

/**
 * Get the title and type of a work item from Azure DevOps
 *
 * @param {string} devOpsOrg - Azure DevOps organization name
 * @param {string} azToken - Azure DevOps PAT token
 * @param {string} workItemId - Work item ID to fetch
 * @returns {Promise<{title: string, type: string}|{authError: true, errorMessage: string}|null>} - Work item title and type, auth error info, or null if not found
 */
export async function getWorkItemTitle(devOpsOrg, azToken, workItemId) {
  try {
    core.info(`Fetching work item ${workItemId} title...`);
    const workItem = await azureDevOpsRequest(
      `https://dev.azure.com/${devOpsOrg}/_apis/wit/workitems/${parseInt(workItemId, 10)}?api-version=7.1`,
      azToken
    );

    if (workItem && workItem.fields) {
      const title = workItem.fields['System.Title'] || '';
      const type = workItem.fields['System.WorkItemType'] || '';
      core.info(`... work item ${workItemId}: [${type}] ${title}`);
      return { title, type };
    }

    core.warning(`... work item ${workItemId} not found`);
    return null;
  } catch (error) {
    const { isAuthError, message } = detectAuthError(error);

    if (isAuthError) {
      core.error(`... authentication error while fetching work item ${workItemId} title: ${message}`);
      return { authError: true, errorMessage: message };
    }

    core.warning(`... failed to fetch work item ${workItemId} title: ${message}`);
    return null;
  }
}
