/**
 * Azure DevOps Work Item Linker
 *
 * Links GitHub Pull Requests to Azure DevOps work items.
 * This module is responsible for creating the connection between a GitHub PR
 * and an Azure DevOps work item.
 *
 * @module main
 */

import * as core from '@actions/core';
import * as azdev from 'azure-devops-node-api';
import { WorkItemExpand } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js';

const relArtifactLink = 'ArtifactLink';
const relNameGitHubPr = 'GitHub Pull Request';
const msGitHubLinkDataProviderLink = 'ms.vss-work-web.github-link-data-provider';
const dataProviderUrlBase = `https://dev.azure.com/%DEVOPS_ORG%/_apis/Contribution/dataProviders/query?api-version=7.1-preview.1`;

let hasError = false;

/**
 * Link a GitHub Pull Request to an Azure DevOps work item
 * Reads configuration from environment variables set by index.js
 */
export async function run() {
  try {
    const devOpsOrg = process.env.AZURE_DEVOPS_ORG;
    const azToken = process.env.AZURE_DEVOPS_PAT;
    const workItemId = process.env.WORKITEMID;
    const githubHostname = process.env.GITHUB_SERVER_URL;
    const prRequestId = process.env.PULLREQUESTID;
    const dataProviderUrl = dataProviderUrlBase.replace('%DEVOPS_ORG%', devOpsOrg);
    const repo = process.env.REPO;

    core.info('Initialize dev ops connection ...');
    let azWorkApi;
    try {
      const orgUrl = `https://dev.azure.com/${devOpsOrg}`;
      const authHandler = azdev.getPersonalAccessTokenHandler(azToken);
      const azWebApi = new azdev.WebApi(orgUrl, authHandler);
      azWorkApi = await azWebApi.getWorkItemTrackingApi();
    } catch (exception) {
      core.info(`... failed! ${exception}`);
      core.setFailed('Failed connection to dev ops!');
      return;
    }
    core.info('... success!');

    hasError = false;
    core.info('Retrieving internalRepoId ...');
    try {
      const dataProviderResponse = await fetch(dataProviderUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`:${azToken}`).toString('base64')}`,
          Accept: 'application/json'
        },
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
        await azWorkApi.updateWorkItem(
          {},
          [
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
          ],
          workItemId,
          undefined,
          undefined,
          undefined,
          undefined,
          WorkItemExpand.Relations
        );
        core.info('... success!');
      } catch (exception) {
        const errorMessage = exception.toString();
        if (-1 !== errorMessage.indexOf('already exists')) {
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
