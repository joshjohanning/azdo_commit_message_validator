/**
 * Tests for link-work-item.js Azure DevOps Work Item Linker
 */

import { jest } from '@jest/globals';

// Mock @actions/core
const mockSetFailed = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();
const mockWarning = jest.fn();
const mockCore = {
  setFailed: mockSetFailed,
  info: mockInfo,
  error: mockError,
  warning: mockWarning
};

// Mock azure-devops-node-api
const mockUpdateWorkItem = jest.fn();
const mockGetWorkItem = jest.fn();
const mockGetWorkItemTrackingApi = jest.fn();
const mockWebApi = jest.fn();
const mockGetPersonalAccessTokenHandler = jest.fn();

// Setup module mocks
jest.unstable_mockModule('@actions/core', () => mockCore);
jest.unstable_mockModule('azure-devops-node-api', () => ({
  WebApi: mockWebApi,
  getPersonalAccessTokenHandler: mockGetPersonalAccessTokenHandler
}));

describe('Azure DevOps Work Item Linker', () => {
  let originalEnv;
  let originalFetch;

  beforeEach(() => {
    // Save original environment and fetch
    originalEnv = { ...process.env };
    originalFetch = global.fetch;

    // Clear all mocks
    jest.clearAllMocks();
    mockSetFailed.mockClear();
    mockInfo.mockClear();
    mockError.mockClear();
    mockWarning.mockClear();
    mockUpdateWorkItem.mockClear();
    mockGetWorkItem.mockClear();
    mockGetWorkItemTrackingApi.mockClear();
    mockWebApi.mockClear();
    mockGetPersonalAccessTokenHandler.mockClear();

    // Set up Azure DevOps API mocks
    mockGetWorkItemTrackingApi.mockResolvedValue({
      updateWorkItem: mockUpdateWorkItem,
      getWorkItem: mockGetWorkItem
    });

    mockWebApi.mockImplementation(() => ({
      getWorkItemTrackingApi: mockGetWorkItemTrackingApi
    }));

    mockGetPersonalAccessTokenHandler.mockReturnValue({});

    // Reset modules to ensure fresh imports
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original environment and fetch
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.clearAllTimers();
  });

  describe('Basic functionality', () => {
    it('should export a run function', async () => {
      const mainModule = await import('../src/link-work-item.js');
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
      mockUpdateWorkItem.mockRejectedValue(new Error('The relation already exists'));

      const { run } = await import('../src/link-work-item.js');
      await run();

      // Should not fail when link already exists
      expect(mockSetFailed).not.toHaveBeenCalled();
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

      mockUpdateWorkItem.mockResolvedValue({ id: 12345 });

      const { run } = await import('../src/link-work-item.js');
      await run();

      // Verify request body structure
      expect(requestBody).toBeDefined();
      expect(requestBody.context.properties.workItemId).toBe('12345');
      expect(requestBody.context.properties.urls[0]).toBe('https://github.com/owner/repo/pull/42');
      expect(requestBody.contributionIds[0]).toBe('ms.vss-work-web.github-link-data-provider');
    });

    it('should fail when Azure DevOps connection fails', async () => {
      process.env.REPO_TOKEN = 'github-token';
      process.env.AZURE_DEVOPS_ORG = 'test-org';
      process.env.AZURE_DEVOPS_PAT = 'azdo-pat';
      process.env.WORKITEMID = '12345';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.PULLREQUESTID = '42';
      process.env.REPO = 'owner/repo';

      // Mock Azure DevOps connection to fail
      mockGetWorkItemTrackingApi.mockRejectedValue(new Error('Connection failed'));

      const { run } = await import('../src/link-work-item.js');
      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('Failed connection to dev ops!');
    });

    it('should fail when internal repo ID cannot be resolved', async () => {
      process.env.REPO_TOKEN = 'github-token';
      process.env.AZURE_DEVOPS_ORG = 'test-org';
      process.env.AZURE_DEVOPS_PAT = 'azdo-pat';
      process.env.WORKITEMID = '12345';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.PULLREQUESTID = '42';
      process.env.REPO = 'owner/repo';

      // Mock fetch to return empty internal repo ID
      global.fetch = jest.fn(() => {
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve({
              data: {
                'ms.vss-work-web.github-link-data-provider': {
                  resolvedLinkItems: [
                    {
                      repoInternalId: null
                    }
                  ]
                }
              }
            })
        });
      });

      const { run } = await import('../src/link-work-item.js');
      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('Failed to retrieve internalRepoId!');
    });

    it('should handle 401 authorization error', async () => {
      process.env.REPO_TOKEN = 'github-token';
      process.env.AZURE_DEVOPS_ORG = 'test-org';
      process.env.AZURE_DEVOPS_PAT = 'invalid-pat';
      process.env.WORKITEMID = '12345';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.PULLREQUESTID = '42';
      process.env.REPO = 'owner/repo';

      // Mock fetch to return 401
      global.fetch = jest.fn(() => {
        return Promise.resolve({
          status: 401,
          json: () => Promise.resolve({})
        });
      });

      const { run } = await import('../src/link-work-item.js');
      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('Failed to retrieve internalRepoId!');
    });
  });

  describe('validateWorkItemExists', () => {
    it('should return true when work item exists', async () => {
      // Mock getWorkItem to return a valid work item
      mockGetWorkItem.mockResolvedValue({
        id: 12345,
        fields: {
          'System.Title': 'Test work item'
        }
      });

      const { validateWorkItemExists } = await import('../src/link-work-item.js');
      const result = await validateWorkItemExists('test-org', 'azdo-token', '12345');

      expect(result).toBe(true);
      expect(mockGetWorkItem).toHaveBeenCalledWith(12345);
    });

    it('should return false when work item does not exist (404)', async () => {
      // Mock getWorkItem to throw a 404 error
      const error = new Error('Work item not found');
      error.statusCode = 404;
      mockGetWorkItem.mockRejectedValue(error);

      const { validateWorkItemExists } = await import('../src/link-work-item.js');
      const result = await validateWorkItemExists('test-org', 'azdo-token', '99999');

      expect(result).toBe(false);
      expect(mockGetWorkItem).toHaveBeenCalledWith(99999);
    });

    it('should return false when work item API call fails', async () => {
      // Mock getWorkItem to throw a network error
      mockGetWorkItem.mockRejectedValue(new Error('Network error'));

      const { validateWorkItemExists } = await import('../src/link-work-item.js');
      const result = await validateWorkItemExists('test-org', 'azdo-token', '12345');

      expect(result).toBe(false);
      expect(mockGetWorkItem).toHaveBeenCalledWith(12345);
    });
  });
});
