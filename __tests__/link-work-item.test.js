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

// Setup module mocks
jest.unstable_mockModule('@actions/core', () => mockCore);

describe('Azure DevOps Work Item Linker', () => {
  let originalEnv;
  let originalFetch;

  beforeEach(() => {
    // Save original environment and fetch
    originalEnv = { ...process.env };
    originalFetch = global.fetch;

    // Clear all mocks
    jest.clearAllMocks();

    // Reset modules to ensure fresh imports
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original environment and fetch
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.clearAllTimers();
  });

  /**
   * Helper to create a mock fetch response
   */
  function mockFetchResponse(status, body) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body))
    });
  }

  describe('Basic functionality', () => {
    it('should export a run function', async () => {
      const mainModule = await import('../src/link-work-item.js');
      expect(mainModule.run).toBeDefined();
      expect(typeof mainModule.run).toBe('function');
    });

    it('should handle already existing link gracefully', async () => {
      process.env.AZURE_DEVOPS_ORG = 'test-org';
      process.env.AZURE_DEVOPS_PAT = 'azdo-pat';
      process.env.WORKITEMID = '12345';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.PULLREQUESTID = '42';
      process.env.REPO = 'owner/repo';

      const internalRepoId = '12345678-1234-1234-1234-123456789abc';

      global.fetch = jest.fn(url => {
        if (url.includes('dataProviders')) {
          return mockFetchResponse(200, {
            data: {
              'ms.vss-work-web.github-link-data-provider': {
                resolvedLinkItems: [{ repoInternalId: internalRepoId }]
              }
            }
          });
        }
        // PATCH work item — "already exists" error
        return mockFetchResponse(409, 'The relation already exists');
      });

      const { run } = await import('../src/link-work-item.js');
      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should send correct data provider request structure', async () => {
      process.env.AZURE_DEVOPS_ORG = 'test-org';
      process.env.AZURE_DEVOPS_PAT = 'azdo-pat';
      process.env.WORKITEMID = '12345';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.PULLREQUESTID = '42';
      process.env.REPO = 'owner/repo';

      const internalRepoId = '12345678-1234-1234-1234-123456789abc';
      let dataProviderBody;

      global.fetch = jest.fn((url, options) => {
        if (url.includes('dataProviders')) {
          dataProviderBody = JSON.parse(options.body);
          return mockFetchResponse(200, {
            data: {
              'ms.vss-work-web.github-link-data-provider': {
                resolvedLinkItems: [{ repoInternalId: internalRepoId }]
              }
            }
          });
        }
        // PATCH work item — success
        return mockFetchResponse(200, { id: 12345 });
      });

      const { run } = await import('../src/link-work-item.js');
      await run();

      expect(dataProviderBody).toBeDefined();
      expect(dataProviderBody.context.properties.workItemId).toBe('12345');
      expect(dataProviderBody.context.properties.urls[0]).toBe('https://github.com/owner/repo/pull/42');
      expect(dataProviderBody.contributionIds[0]).toBe('ms.vss-work-web.github-link-data-provider');
    });

    it('should use application/json-patch+json for work item PATCH', async () => {
      process.env.AZURE_DEVOPS_ORG = 'test-org';
      process.env.AZURE_DEVOPS_PAT = 'azdo-pat';
      process.env.WORKITEMID = '12345';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.PULLREQUESTID = '42';
      process.env.REPO = 'owner/repo';

      const internalRepoId = '12345678-1234-1234-1234-123456789abc';
      let patchOptions;

      global.fetch = jest.fn((url, options) => {
        if (url.includes('dataProviders')) {
          return mockFetchResponse(200, {
            data: {
              'ms.vss-work-web.github-link-data-provider': {
                resolvedLinkItems: [{ repoInternalId: internalRepoId }]
              }
            }
          });
        }
        patchOptions = options;
        return mockFetchResponse(200, { id: 12345 });
      });

      const { run } = await import('../src/link-work-item.js');
      await run();

      expect(patchOptions.method).toBe('PATCH');
      expect(patchOptions.headers['Content-Type']).toBe('application/json-patch+json');
    });

    it('should fail when internal repo ID cannot be resolved', async () => {
      process.env.AZURE_DEVOPS_ORG = 'test-org';
      process.env.AZURE_DEVOPS_PAT = 'azdo-pat';
      process.env.WORKITEMID = '12345';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.PULLREQUESTID = '42';
      process.env.REPO = 'owner/repo';

      global.fetch = jest.fn(() => {
        return mockFetchResponse(200, {
          data: {
            'ms.vss-work-web.github-link-data-provider': {
              resolvedLinkItems: [{ repoInternalId: null }]
            }
          }
        });
      });

      const { run } = await import('../src/link-work-item.js');
      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('Failed to retrieve internalRepoId!');
    });

    it('should handle 401 authorization error', async () => {
      process.env.AZURE_DEVOPS_ORG = 'test-org';
      process.env.AZURE_DEVOPS_PAT = 'invalid-pat';
      process.env.WORKITEMID = '12345';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.PULLREQUESTID = '42';
      process.env.REPO = 'owner/repo';

      global.fetch = jest.fn(() => {
        return Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: () => Promise.resolve({}),
          text: () => Promise.resolve('Unauthorized')
        });
      });

      const { run } = await import('../src/link-work-item.js');
      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('Failed to retrieve internalRepoId!');
    });
  });

  describe('validateWorkItemExists', () => {
    it('should return { exists: true } when work item exists', async () => {
      global.fetch = jest.fn(() => mockFetchResponse(200, { id: 12345, fields: { 'System.Title': 'Test work item' } }));

      const { validateWorkItemExists } = await import('../src/link-work-item.js');
      const result = await validateWorkItemExists('test-org', 'azdo-token', '12345');

      expect(result).toEqual({ exists: true });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/_apis/wit/workitems/12345'),
        expect.any(Object)
      );
    });

    it('should return { exists: false } when work item does not exist (404)', async () => {
      global.fetch = jest.fn(() => mockFetchResponse(404, 'Work item not found'));

      const { validateWorkItemExists } = await import('../src/link-work-item.js');
      const result = await validateWorkItemExists('test-org', 'azdo-token', '99999');

      expect(result).toEqual({ exists: false });
    });

    it('should return { exists: false } when work item API call fails', async () => {
      global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));

      const { validateWorkItemExists } = await import('../src/link-work-item.js');
      const result = await validateWorkItemExists('test-org', 'azdo-token', '12345');

      expect(result).toEqual({ exists: false });
    });

    it('should return authError when PAT has expired (status 401)', async () => {
      global.fetch = jest.fn(() => mockFetchResponse(401, 'Unauthorized'));

      const { validateWorkItemExists } = await import('../src/link-work-item.js');
      const result = await validateWorkItemExists('test-org', 'azdo-token', '12345');

      expect(result).toEqual({ exists: false, authError: true, errorMessage: 'Unauthorized' });
    });

    it('should return authError when PAT has expired (status 403)', async () => {
      global.fetch = jest.fn(() => mockFetchResponse(403, 'Forbidden'));

      const { validateWorkItemExists } = await import('../src/link-work-item.js');
      const result = await validateWorkItemExists('test-org', 'azdo-token', '12345');

      expect(result).toEqual({ exists: false, authError: true, errorMessage: 'Forbidden' });
    });

    it('should return authError when error message indicates expired PAT', async () => {
      global.fetch = jest.fn(() =>
        mockFetchResponse(400, 'Access Denied: The Personal Access Token used has expired.')
      );

      const { validateWorkItemExists } = await import('../src/link-work-item.js');
      const result = await validateWorkItemExists('test-org', 'azdo-token', '12345');

      expect(result).toEqual({
        exists: false,
        authError: true,
        errorMessage: 'Access Denied: The Personal Access Token used has expired.'
      });
    });
  });

  describe('getWorkItemTitle', () => {
    it('should return title and type when work item exists', async () => {
      global.fetch = jest.fn(() =>
        mockFetchResponse(200, {
          id: 12345,
          fields: { 'System.Title': 'Fix login bug', 'System.WorkItemType': 'Bug' }
        })
      );

      const { getWorkItemTitle } = await import('../src/link-work-item.js');
      const result = await getWorkItemTitle('test-org', 'azdo-token', '12345');

      expect(result).toEqual({ title: 'Fix login bug', type: 'Bug' });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/_apis/wit/workitems/12345'),
        expect.any(Object)
      );
    });

    it('should return null when work item is not found', async () => {
      global.fetch = jest.fn(() => mockFetchResponse(200, null));

      const { getWorkItemTitle } = await import('../src/link-work-item.js');
      const result = await getWorkItemTitle('test-org', 'azdo-token', '99999');

      expect(result).toBeNull();
      expect(mockWarning).toHaveBeenCalled();
    });

    it('should return null when work item has no fields', async () => {
      global.fetch = jest.fn(() => mockFetchResponse(200, { id: 12345 }));

      const { getWorkItemTitle } = await import('../src/link-work-item.js');
      const result = await getWorkItemTitle('test-org', 'azdo-token', '12345');

      expect(result).toBeNull();
    });

    it('should return null and warn on API error', async () => {
      global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));

      const { getWorkItemTitle } = await import('../src/link-work-item.js');
      const result = await getWorkItemTitle('test-org', 'azdo-token', '12345');

      expect(result).toBeNull();
      expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('failed to fetch work item 12345 title'));
    });

    it('should return authError when PAT has expired (status 401)', async () => {
      global.fetch = jest.fn(() => mockFetchResponse(401, 'Unauthorized'));

      const { getWorkItemTitle } = await import('../src/link-work-item.js');
      const result = await getWorkItemTitle('test-org', 'azdo-token', '12345');

      expect(result).toEqual({ authError: true, errorMessage: 'Unauthorized' });
      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('authentication error while fetching work item 12345 title')
      );
    });

    it('should return authError when PAT has expired (status 403)', async () => {
      global.fetch = jest.fn(() => mockFetchResponse(403, 'Forbidden'));

      const { getWorkItemTitle } = await import('../src/link-work-item.js');
      const result = await getWorkItemTitle('test-org', 'azdo-token', '12345');

      expect(result).toEqual({ authError: true, errorMessage: 'Forbidden' });
    });

    it('should return authError when error message indicates access denied', async () => {
      global.fetch = jest.fn(() =>
        mockFetchResponse(400, 'Access Denied: The Personal Access Token used has expired.')
      );

      const { getWorkItemTitle } = await import('../src/link-work-item.js');
      const result = await getWorkItemTitle('test-org', 'azdo-token', '12345');

      expect(result).toEqual({
        authError: true,
        errorMessage: 'Access Denied: The Personal Access Token used has expired.'
      });
    });

    it('should handle missing title and type fields gracefully', async () => {
      global.fetch = jest.fn(() => mockFetchResponse(200, { id: 12345, fields: {} }));

      const { getWorkItemTitle } = await import('../src/link-work-item.js');
      const result = await getWorkItemTitle('test-org', 'azdo-token', '12345');

      expect(result).toEqual({ title: '', type: '' });
    });
  });
});
