// Mock @actions/core before importing main
jest.mock('@actions/core');
const core = require('@actions/core');

// Mock azure-devops-node-api
jest.mock('azure-devops-node-api');
const azdev = require('azure-devops-node-api');

describe('Azure DevOps Work Item Linker', () => {
  let originalEnv;
  let mockWorkItemTrackingApi;
  let mockWebApi;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear all mocks
    jest.clearAllMocks();

    // Set up Azure DevOps API mocks
    mockWorkItemTrackingApi = {
      updateWorkItem: jest.fn()
    };

    mockWebApi = {
      getWorkItemTrackingApi: jest.fn().mockResolvedValue(mockWorkItemTrackingApi)
    };

    azdev.WebApi = jest.fn(() => mockWebApi);
    azdev.getPersonalAccessTokenHandler = jest.fn(() => ({}));

    // Reset modules to ensure fresh imports
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    jest.clearAllTimers();
  });

  describe('Basic functionality', () => {
    it('should export a run function', () => {
      const mainModule = require('../src/main');
      expect(mainModule.run).toBeDefined();
      expect(typeof mainModule.run).toBe('function');
    });

    it('should handle already existing link gracefully', async () => {
      // Set up environment variables
      process.env.REPO_TOKEN = 'github-token';
      process.env.AZURE_DEVOPS_ORG = 'test-org';
      process.env.AZURE_DEVOPS_PAT = 'azdo-pat';
      process.env.WORKITEMID = '12345';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.PULLREQUESTID = '42';
      process.env.REPO = 'owner/repo';

      const internalRepoId = '12345678-1234-1234-1234-123456789abc';

      // Mock global fetch
      global.fetch = jest.fn(() => {
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve({
              data: {
                'ms.vss-work-web.github-link-data-provider': {
                  resolvedLinkItems: [
                    {
                      repoInternalId: internalRepoId
                    }
                  ]
                }
              }
            })
        });
      });

      // Mock the work item API to return "already exists" error
      mockWorkItemTrackingApi.updateWorkItem.mockRejectedValue(new Error('The relation already exists'));

      const { run } = require('../src/main');
      await run();

      // Should not fail when link already exists
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it('should send correct data provider request structure', async () => {
      process.env.REPO_TOKEN = 'github-token';
      process.env.AZURE_DEVOPS_ORG = 'test-org';
      process.env.AZURE_DEVOPS_PAT = 'azdo-pat';
      process.env.WORKITEMID = '12345';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.PULLREQUESTID = '42';
      process.env.REPO = 'owner/repo';

      const internalRepoId = '12345678-1234-1234-1234-123456789abc';

      let requestBody;

      // Mock global fetch
      global.fetch = jest.fn((url, options) => {
        requestBody = JSON.parse(options.body);
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve({
              data: {
                'ms.vss-work-web.github-link-data-provider': {
                  resolvedLinkItems: [
                    {
                      repoInternalId: internalRepoId
                    }
                  ]
                }
              }
            })
        });
      });

      mockWorkItemTrackingApi.updateWorkItem.mockResolvedValue({ id: 12345 });

      const { run } = require('../src/main');
      await run();

      // Verify request body structure
      expect(requestBody).toBeDefined();
      expect(requestBody.context.properties.workItemId).toBe('12345');
      expect(requestBody.context.properties.urls[0]).toBe('https://github.com/owner/repo/pull/42');
      expect(requestBody.contributionIds[0]).toBe('ms.vss-work-web.github-link-data-provider');
    });
  });
});
