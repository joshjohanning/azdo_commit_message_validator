/**
 * Tests for index.js Azure DevOps Commit Validator
 */

import { jest } from '@jest/globals';

// Mock @actions/core
const mockGetInput = jest.fn();
const mockSetFailed = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();
const mockWarning = jest.fn();
const mockSummary = {
  addRaw: jest.fn().mockReturnThis(),
  write: jest.fn().mockResolvedValue(undefined)
};

jest.unstable_mockModule('@actions/core', () => ({
  getInput: mockGetInput,
  setFailed: mockSetFailed,
  info: mockInfo,
  error: mockError,
  warning: mockWarning,
  summary: mockSummary
}));

// Mock @actions/github
const mockGetOctokit = jest.fn();
const mockContext = {
  payload: {
    pull_request: {
      number: 42
    }
  },
  repo: {
    owner: 'test-owner',
    repo: 'test-repo'
  },
  serverUrl: 'https://github.com'
};

jest.unstable_mockModule('@actions/github', () => ({
  getOctokit: mockGetOctokit,
  context: mockContext
}));

// Mock ./link-work-item.js
const mockLinkWorkItem = jest.fn();
const mockValidateWorkItemExists = jest.fn();
const mockGetWorkItemTitle = jest.fn();
jest.unstable_mockModule('../src/link-work-item.js', () => ({
  run: mockLinkWorkItem,
  validateWorkItemExists: mockValidateWorkItemExists,
  getWorkItemTitle: mockGetWorkItemTitle
}));

describe('Azure DevOps Commit Validator', () => {
  let mockOctokit;
  let run;
  let COMMENT_MARKERS;
  let extractWorkItemIdsFromBranch;

  beforeAll(async () => {
    // Set NODE_ENV to test to prevent auto-execution
    process.env.NODE_ENV = 'test';

    // Import the run function and COMMENT_MARKERS after mocks are set up
    const indexModule = await import('../src/index.js');
    run = indexModule.run;
    COMMENT_MARKERS = indexModule.COMMENT_MARKERS;
    extractWorkItemIdsFromBranch = indexModule.extractWorkItemIdsFromBranch;
  });

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Reset summary mock
    mockSummary.addRaw.mockClear().mockReturnThis();
    mockSummary.write.mockClear().mockResolvedValue(undefined);

    // Setup default mock implementations
    mockGetInput.mockImplementation(name => {
      const defaults = {
        'check-pull-request': 'false',
        'pull-request-check-scope': 'title-or-body',
        'check-commits': 'true',
        'fail-if-missing-workitem-commit-link': 'true',
        'link-commits-to-pull-request': 'false',
        'azure-devops-token': '',
        'azure-devops-organization': '',
        'github-token': 'github-token',
        'comment-on-failure': 'true',
        'validate-work-item-exists': 'false',
        'append-work-item-title': 'false',
        'add-ab-tag-from-branch': 'false'
      };
      return defaults[name] || '';
    });

    // Setup mock Octokit
    mockOctokit = {
      rest: {
        pulls: {
          listCommits: jest.fn().mockResolvedValue({ data: [] }),
          get: jest.fn().mockResolvedValue({
            data: {
              title: 'Test PR',
              body: 'Test body'
            }
          }),
          listComments: jest.fn().mockResolvedValue({ data: [] }),
          createComment: jest.fn().mockResolvedValue({ data: { id: 123 } }),
          updateComment: jest.fn().mockResolvedValue({ data: { id: 123 } }),
          update: jest.fn().mockResolvedValue({ data: {} })
        },
        issues: {
          createComment: jest.fn().mockResolvedValue({ data: { id: 123 } }),
          updateComment: jest.fn().mockResolvedValue({ data: { id: 123 } }),
          listComments: jest.fn().mockResolvedValue({ data: [] })
        }
      },
      paginate: jest.fn().mockImplementation(async method => {
        // For paginate, just return the data from the mocked method
        const result = await method();
        return result.data || [];
      })
    };

    mockGetOctokit.mockReturnValue(mockOctokit);
    mockContext.payload.pull_request = { number: 42, head: { ref: 'feature/test-branch' } };

    // Default mock for validateWorkItemExists (returns true by default)
    mockValidateWorkItemExists.mockResolvedValue(true);

    // Default mock for getWorkItemTitle
    mockGetWorkItemTitle.mockResolvedValue({ title: 'Test Work Item', type: 'User Story' });
  });

  describe('Input validation', () => {
    it('should fail if not run on a pull request', async () => {
      // Temporarily override context to have no pull request
      const originalPR = mockContext.payload.pull_request;
      mockContext.payload.pull_request = undefined;

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('This action can only be run on pull requests');

      // Restore context
      mockContext.payload.pull_request = originalPR;
    });

    it('should fail if both check-commits and check-pull-request are false', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'false';
        if (name === 'github-token') return 'github-token';
        return 'false';
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(
        "At least one of 'check-commits' or 'check-pull-request' must be set to true. Both are currently set to false."
      );
    });

    it('should pass when only check-commits is enabled', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'github-token') return 'github-token';
        if (name === 'fail-if-missing-workitem-commit-link') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: []
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should pass when only check-pull-request is enabled', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'Test PR AB#123',
          body: 'Test body'
        }
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should pass when both checks are enabled', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'fail-if-missing-workitem-commit-link') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: []
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'Test PR AB#123',
          body: 'Test body'
        }
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should fail when link-commits-to-pull-request is true but azure-devops-organization is missing', async () => {
      mockGetInput.mockImplementation(name => {
        const defaults = {
          'check-pull-request': 'false',
          'check-commits': 'true',
          'fail-if-missing-workitem-commit-link': 'true',
          'link-commits-to-pull-request': 'true',
          'azure-devops-token': 'test-token',
          'azure-devops-organization': '', // Missing org
          'github-token': 'github-token',
          'comment-on-failure': 'true',
          'validate-work-item-exists': 'false'
        };
        return defaults[name] || '';
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(
        'The following input is required when link-commits-to-pull-request is enabled: azure-devops-organization'
      );
    });

    it('should fail when link-commits-to-pull-request is true but azure-devops-token is missing', async () => {
      mockGetInput.mockImplementation(name => {
        const defaults = {
          'check-pull-request': 'false',
          'check-commits': 'true',
          'fail-if-missing-workitem-commit-link': 'true',
          'link-commits-to-pull-request': 'true',
          'azure-devops-token': '', // Missing token
          'azure-devops-organization': 'test-org',
          'github-token': 'github-token',
          'comment-on-failure': 'true',
          'validate-work-item-exists': 'false'
        };
        return defaults[name] || '';
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(
        'The following input is required when link-commits-to-pull-request is enabled: azure-devops-token'
      );
    });

    it('should pass when link-commits-to-pull-request is false and validate-work-item-exists is false even if azure-devops config is missing', async () => {
      mockGetInput.mockImplementation(name => {
        const defaults = {
          'check-pull-request': 'false',
          'check-commits': 'true',
          'fail-if-missing-workitem-commit-link': 'true',
          'link-commits-to-pull-request': 'false', // Linking disabled
          'azure-devops-token': '',
          'azure-devops-organization': '',
          'github-token': 'github-token',
          'comment-on-failure': 'true',
          'validate-work-item-exists': 'false' // Validation disabled
        };
        return defaults[name] || '';
      });

      mockOctokit.paginate.mockResolvedValueOnce([
        {
          sha: '1234567890abcdef',
          commit: { message: 'Fix: AB#123' }
        }
      ]);

      await run();

      // Should not call setFailed for missing Azure DevOps config since both features are disabled
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should fail when validate-work-item-exists is true but azure-devops credentials are missing', async () => {
      mockGetInput.mockImplementation(name => {
        const defaults = {
          'check-pull-request': 'false',
          'check-commits': 'true',
          'fail-if-missing-workitem-commit-link': 'true',
          'link-commits-to-pull-request': 'false', // Linking disabled
          'azure-devops-token': '',
          'azure-devops-organization': '',
          'github-token': 'github-token',
          'comment-on-failure': 'true',
          'validate-work-item-exists': 'true' // Validation enabled but no credentials
        };
        return defaults[name] || '';
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(
        'The following inputs are required when validate-work-item-exists is enabled: azure-devops-organization, azure-devops-token'
      );
    });

    it('should fail when both link-commits-to-pull-request and validate-work-item-exists are true but credentials are missing', async () => {
      mockGetInput.mockImplementation(name => {
        const defaults = {
          'check-pull-request': 'false',
          'check-commits': 'true',
          'fail-if-missing-workitem-commit-link': 'true',
          'link-commits-to-pull-request': 'true', // Linking enabled
          'azure-devops-token': '',
          'azure-devops-organization': '',
          'github-token': 'github-token',
          'comment-on-failure': 'true',
          'validate-work-item-exists': 'true' // Validation also enabled
        };
        return defaults[name] || '';
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(
        'The following inputs are required when link-commits-to-pull-request or validate-work-item-exists are enabled: azure-devops-organization, azure-devops-token'
      );
    });
  });

  describe('Commit validation', () => {
    it('should pass when all commits have work item links', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false'; // Don't check PR
        if (name === 'fail-if-missing-workitem-commit-link') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false'; // Don't comment
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature AB#12345'
            }
          },
          {
            sha: 'def456',
            commit: {
              message: 'fix: bug fix AB#67890'
            }
          }
        ]
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should fail when commit is missing work item link', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false'; // Don't check PR
        if (name === 'fail-if-missing-workitem-commit-link') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature without work item'
            }
          }
        ]
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
    });

    it('should not fail when failIfMissingWorkitemCommitLink is false', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false'; // Don't check PR
        if (name === 'fail-if-missing-workitem-commit-link') return 'false';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false'; // Don't comment
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature without work item'
            }
          }
        ]
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should link work items when enabled', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false'; // Don't check PR
        if (name === 'link-commits-to-pull-request') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'test-org';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false'; // Don't comment
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature AB#12345'
            }
          }
        ]
      });

      mockLinkWorkItem.mockResolvedValue(undefined);

      await run();

      expect(mockLinkWorkItem).toHaveBeenCalled();
      expect(mockSetFailed).not.toHaveBeenCalled();
      // Verify job summary was written with work item info
      expect(mockSummary.addRaw).toHaveBeenCalledWith(expect.stringContaining('AB#12345'));
      expect(mockSummary.write).toHaveBeenCalled();
    });

    it('should handle duplicate work items', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false'; // Don't check PR
        if (name === 'link-commits-to-pull-request') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'test-org';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false'; // Don't comment
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature AB#12345'
            }
          },
          {
            sha: 'def456',
            commit: {
              message: 'fix: bug fix AB#12345'
            }
          }
        ]
      });

      mockLinkWorkItem.mockResolvedValue(undefined);

      await run();

      // Should only link once for duplicate work item
      expect(mockLinkWorkItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('Pull request validation', () => {
    it('should pass when PR has work item in title', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false'; // Don't check commits
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false'; // Don't comment
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature AB#12345',
          body: 'This is a test PR'
        }
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      // Verify job summary was written with work item info
      expect(mockSummary.addRaw).toHaveBeenCalledWith(expect.stringContaining('AB#12345'));
      expect(mockSummary.write).toHaveBeenCalled();
    });

    it('should pass when PR has work item in body', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false'; // Don't check commits
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false'; // Don't comment
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature',
          body: 'This PR implements AB#12345'
        }
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      // Verify job summary was written with work item info
      expect(mockSummary.addRaw).toHaveBeenCalledWith(expect.stringContaining('AB#12345'));
      expect(mockSummary.write).toHaveBeenCalled();
    });

    it('should fail when PR has no work item link', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false'; // Don't check commits
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature',
          body: 'This is a test PR without work item'
        }
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
    });

    it('should update existing failure comment when PR passes', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false'; // Don't check commits
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature AB#12345',
          body: 'This is a test PR'
        }
      });

      mockOctokit.rest.issues.listComments = jest.fn().mockResolvedValue({
        data: [
          {
            id: 999,
            body: ':x: This pull request is not linked to a work item.'
          }
        ]
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          comment_id: 999
        })
      );
    });

    it('should pass when valid work item appears in both commit and PR', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [{ sha: 'abc123', commit: { message: 'fix: resolve issue AB#12345' } }]
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'fix: resolve issue AB#12345',
          body: 'This PR fixes AB#12345'
        }
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      // Verify job summary was written and work item appears only once
      expect(mockSummary.addRaw).toHaveBeenCalled();
      expect(mockSummary.write).toHaveBeenCalled();
      // Work item AB#12345 should be in the summary from commit (where it was found first)
      const summaryCallArg = mockSummary.addRaw.mock.calls.find(call => call[0].includes('AB#12345'));
      expect(summaryCallArg).toBeDefined();
    });
  });

  describe('Pull request check scope', () => {
    it('should pass with body-only scope when work item is in body', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'pull-request-check-scope') return 'body-only';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature',
          body: 'This PR implements AB#12345'
        }
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should fail with body-only scope when work item is only in title', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'pull-request-check-scope') return 'body-only';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature AB#12345',
          body: 'This is a test PR'
        }
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
    });

    it('should pass with title-only scope when work item is in title', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'pull-request-check-scope') return 'title-only';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature AB#12345',
          body: 'This is a test PR'
        }
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should fail with title-only scope when work item is only in body', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'pull-request-check-scope') return 'title-only';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature',
          body: 'This PR implements AB#12345'
        }
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
    });

    it('should pass with title-or-body scope (default) when work item is in either', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'pull-request-check-scope') return 'title-or-body';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature AB#12345',
          body: 'This is a test PR'
        }
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should warn and use default scope with invalid pull-request-check-scope value', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'pull-request-check-scope') return 'invalid-value';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature AB#12345',
          body: 'Test body'
        }
      });

      await run();

      expect(mockWarning).toHaveBeenCalledWith(
        expect.stringContaining("Invalid value 'invalid-value' for 'pull-request-check-scope'")
      );
      // Should still pass because it falls back to title-or-body and title has AB#
      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should include scope-aware message in failure comment with body-only scope', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'pull-request-check-scope') return 'body-only';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature AB#12345',
          body: 'This is a test PR without work item in body'
        }
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('Please update the body to include a work item')
        })
      );
    });
  });

  describe('Append work item title', () => {
    it('should append work item title to AB# in PR body when enabled', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        if (name === 'validate-work-item-exists') return 'false';
        if (name === 'append-work-item-title') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'my-org';
        return '';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature',
          body: 'This PR implements AB#12345'
        }
      });

      mockGetWorkItemTitle.mockResolvedValue({ title: 'Fix login bug', type: 'Bug' });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockGetWorkItemTitle).toHaveBeenCalledWith('my-org', 'azdo-token', '12345');
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'This PR implements AB#12345 - Fix login bug'
        })
      );
    });

    it('should not update PR body when work item already has title appended', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        if (name === 'validate-work-item-exists') return 'false';
        if (name === 'append-work-item-title') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'my-org';
        return '';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature',
          body: 'This PR implements AB#12345 - Fix login bug'
        }
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockGetWorkItemTitle).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.update).not.toHaveBeenCalled();
    });

    it('should not append when append-work-item-title is false', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        if (name === 'validate-work-item-exists') return 'false';
        if (name === 'append-work-item-title') return 'false';
        return '';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature',
          body: 'This PR implements AB#12345'
        }
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockGetWorkItemTitle).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.update).not.toHaveBeenCalled();
    });

    it('should handle multiple work items in PR body', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        if (name === 'validate-work-item-exists') return 'false';
        if (name === 'append-work-item-title') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'my-org';
        return '';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature',
          body: 'This PR implements AB#111 and AB#222'
        }
      });

      mockGetWorkItemTitle
        .mockResolvedValueOnce({ title: 'First item', type: 'User Story' })
        .mockResolvedValueOnce({ title: 'Second item', type: 'Bug' });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockGetWorkItemTitle).toHaveBeenCalledTimes(2);
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'This PR implements AB#111 - First item and AB#222 - Second item'
        })
      );
    });

    it('should gracefully handle when getWorkItemTitle returns null', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        if (name === 'validate-work-item-exists') return 'false';
        if (name === 'append-work-item-title') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'my-org';
        return '';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature',
          body: 'This PR implements AB#12345'
        }
      });

      mockGetWorkItemTitle.mockResolvedValue(null);

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.update).not.toHaveBeenCalled();
    });

    it('should require azure-devops-token and azure-devops-organization when enabled', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        if (name === 'validate-work-item-exists') return 'false';
        if (name === 'append-work-item-title') return 'true';
        if (name === 'azure-devops-token') return '';
        if (name === 'azure-devops-organization') return '';
        return '';
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('append-work-item-title'));
    });

    it('should append title with validate-work-item-exists also enabled', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        if (name === 'validate-work-item-exists') return 'true';
        if (name === 'append-work-item-title') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'my-org';
        return '';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature',
          body: 'This PR implements AB#12345'
        }
      });

      mockValidateWorkItemExists.mockResolvedValue(true);
      mockGetWorkItemTitle.mockResolvedValue({ title: 'Fix login bug', type: 'Bug' });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockValidateWorkItemExists).toHaveBeenCalled();
      expect(mockGetWorkItemTitle).toHaveBeenCalledWith('my-org', 'azdo-token', '12345');
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'This PR implements AB#12345 - Fix login bug'
        })
      );
    });
  });

  describe('Comment management', () => {
    it('should not comment when comment-on-failure is false', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature',
          body: 'This is a test PR without work item'
        }
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should handle errors gracefully', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'github-token') return 'github-token';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockRejectedValue(new Error('API Error'));

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Action failed with error'));
    });

    it('should handle linkWorkItem failures', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'link-commits-to-pull-request') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'test-org';
        if (name === 'github-token') return 'github-token';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature AB#12345'
            }
          }
        ]
      });

      mockLinkWorkItem.mockRejectedValue(new Error('Linking failed'));

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Action failed with error'));
    });
  });

  describe('Edge cases - Work item formats', () => {
    it('should handle lowercase ab# format', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature ab#12345'
            }
          }
        ]
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should handle multiple work items in single commit', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'link-commits-to-pull-request') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'test-org';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature AB#12345 AB#67890'
            }
          }
        ]
      });

      mockLinkWorkItem.mockResolvedValue(undefined);

      await run();

      expect(mockLinkWorkItem).toHaveBeenCalledTimes(2);
    });

    it('should handle mixed case Ab# format', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature Ab#99999'
            }
          }
        ]
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases - Empty/null data', () => {
    it('should handle PR with null body', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature AB#12345',
          body: null
        }
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should handle PR with null title', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: null,
          body: 'This PR implements AB#12345'
        }
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should handle PR with empty strings', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: '',
          body: ''
        }
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
    });
  });

  describe('Edge cases - Mixed scenarios', () => {
    it('should handle mixed valid and invalid commits (first one invalid)', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'fail-if-missing-workitem-commit-link') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: no work item'
            }
          },
          {
            sha: 'def456',
            commit: {
              message: 'fix: with work item AB#12345'
            }
          }
        ]
      });

      await run();

      // Should fail on first invalid commit
      expect(mockSetFailed).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
    });

    it('should handle both check-commits and check-pull-request enabled', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature AB#12345'
            }
          }
        ]
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature AB#12345',
          body: 'This is a test PR'
        }
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should pass commits but fail PR check', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature AB#12345'
            }
          }
        ]
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature',
          body: 'No work item here'
        }
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
    });
  });

  describe('Edge cases - Comment management', () => {
    it('should update existing commit failure comment', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'fail-if-missing-workitem-commit-link') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: no work item'
            }
          }
        ]
      });

      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 888,
            body: `${COMMENT_MARKERS.COMMITS_NOT_LINKED}\n:x: There is 1 commit (\`abc1234\`) in pull request #42 not linked to a work item. Please amend the commit message to include a work item reference (\`AB#xxx\`) and re-run the failed job to continue.`
          }
        ]
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          comment_id: 888
        })
      );
      // Verify we're updating, not creating a new comment
      expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
    });

    it('should update comment from 4 invalid commits to 1 invalid commit', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'fail-if-missing-workitem-commit-link') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: no work item'
            }
          }
        ]
      });

      // Existing comment has 4 commits in dropdown format
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 999,
            body: `${COMMENT_MARKERS.COMMITS_NOT_LINKED}\n:x: There are 4 commits in pull request #42 not linked to work items. Please amend the commit messages to include a work item reference (\`AB#xxx\`) and re-run the failed job to continue.\n\n<details>\n<summary>View all 4 commits missing work items</summary>\n\n- \`abc1234\` - commit 1\n- \`def5678\` - commit 2\n- \`ghi9012\` - commit 3\n- \`jkl3456\` - commit 4\n</details>`
          }
        ]
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          comment_id: 999,
          body: expect.stringContaining('There is 1 commit')
        })
      );
      // Should now be inline format, not dropdown - check that the commit list dropdown is removed
      const updateCall = mockOctokit.rest.issues.updateComment.mock.calls[0][0];
      expect(updateCall.body).not.toContain('View all 4 commits');
      expect(updateCall.body).not.toContain('View all'); // No "View all X commits" text
      expect(updateCall.body).toContain('Workflow run details'); // But workflow details should still be there
      expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
    });

    it('should update comment from 1 invalid commit to 4 invalid commits', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'fail-if-missing-workitem-commit-link') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'commit1abc',
            commit: {
              message: 'feat: first commit without work item'
            }
          },
          {
            sha: 'commit2def',
            commit: {
              message: 'fix: second commit without work item'
            }
          },
          {
            sha: 'commit3ghi',
            commit: {
              message: 'chore: third commit without work item'
            }
          },
          {
            sha: 'commit4jkl',
            commit: {
              message: 'docs: fourth commit without work item'
            }
          }
        ]
      });

      // Existing comment has 1 commit in inline format
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 777,
            body: `${COMMENT_MARKERS.COMMITS_NOT_LINKED}\n:x: There is 1 commit (\`abc1234\`) in pull request #42 not linked to a work item. Please amend the commit message to include a work item reference (\`AB#xxx\`) and re-run the failed job to continue.`
          }
        ]
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          comment_id: 777,
          body: expect.stringContaining('There are 4 commits')
        })
      );
      // Should now have dropdown format
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('<details>')
        })
      );
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('View all 4 commits missing work items')
        })
      );
      expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
    });

    it('should update comment when 4 invalid commits change to different 4 invalid commits', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'fail-if-missing-workitem-commit-link') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'new1abc123',
            commit: {
              message: 'refactor: new commit 1'
            }
          },
          {
            sha: 'new2def456',
            commit: {
              message: 'test: new commit 2'
            }
          },
          {
            sha: 'new3ghi789',
            commit: {
              message: 'style: new commit 3'
            }
          },
          {
            sha: 'new4jkl012',
            commit: {
              message: 'perf: new commit 4'
            }
          }
        ]
      });

      // Existing comment has different 4 commits
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 666,
            body: `${COMMENT_MARKERS.COMMITS_NOT_LINKED}\n:x: There are 4 commits in pull request #42 not linked to work items. Please amend the commit messages to include a work item reference (\`AB#xxx\`) and re-run the failed job to continue.\n\n<details>\n<summary>View all 4 commits missing work items</summary>\n\n- \`old1abc\` - old commit 1\n- \`old2def\` - old commit 2\n- \`old3ghi\` - old commit 3\n- \`old4jkl\` - old commit 4\n</details>`
          }
        ]
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          comment_id: 666,
          body: expect.stringContaining('There are 4 commits')
        })
      );
      // Should have updated commit SHAs
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('new1abc')
        })
      );
      expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
    });

    it('should update comment with old text format', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'fail-if-missing-workitem-commit-link') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: no work item'
            }
          }
        ]
      });

      // Old comment with HTML marker but older text format
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 555,
            body: `${COMMENT_MARKERS.COMMITS_NOT_LINKED}\n:x: There is at least one commit in pull request #42 not linked to a work item. The commit should be amended.`
          }
        ]
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
      // Should still find and update the comment using the search text
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          comment_id: 555
        })
      );
      // Should update to new format
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('There is 1 commit')
        })
      );
      expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
    });

    it('should update existing commit failure comment to success when all commits are fixed', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'fail-if-missing-workitem-commit-link') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      // All commits now have work items
      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: fixed commit AB#12345'
            }
          },
          {
            sha: 'def456',
            commit: {
              message: 'fix: another commit AB#67890'
            }
          }
        ]
      });

      // Existing failure comment exists with HTML marker
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 444,
            body: `${COMMENT_MARKERS.COMMITS_NOT_LINKED}\n:x: There are 2 commits in pull request #42 not linked to work items. Please amend the commit messages to include a work item reference (\`AB#xxx\`) and re-run the failed job to continue.`
          }
        ]
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      // Should update the existing comment to success
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          comment_id: 444,
          body: expect.stringContaining(
            ':white_check_mark: All commits in this pull request are now linked to work items.'
          )
        })
      );
      expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
    });

    it('should handle multiple work items in PR title and body', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature AB#12345',
          body: 'This PR also relates to AB#67890 and AB#99999'
        }
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('should handle duplicate work items across PR title and body', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature AB#12345',
          body: 'This PR implements AB#12345'
        }
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases - No commits scenario', () => {
    it('should handle PR with no commits', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'github-token') return 'github-token';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: []
      });

      await run();

      // Should not fail with empty commits
      expect(mockSetFailed).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases - Work item linking with missing credentials', () => {
    it('should fail when linking is enabled but credentials are missing', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'link-commits-to-pull-request') return 'true';
        if (name === 'azure-devops-token') return '';
        if (name === 'azure-devops-organization') return '';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature AB#12345'
            }
          }
        ]
      });

      mockLinkWorkItem.mockResolvedValue(undefined);

      await run();

      // Should fail due to missing Azure DevOps organization and token
      expect(mockSetFailed).toHaveBeenCalledWith(
        'The following inputs are required when link-commits-to-pull-request is enabled: azure-devops-organization, azure-devops-token'
      );
      // Should not call linkWorkItem since validation failed
      expect(mockLinkWorkItem).not.toHaveBeenCalled();
    });
  });

  describe('Work item validation', () => {
    it('should fail when work item does not exist in Azure DevOps', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'validate-work-item-exists') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'test-org';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature AB#99999'
            }
          }
        ]
      });

      // Mock work item validation to return false (work item doesn't exist)
      mockValidateWorkItemExists.mockResolvedValue(false);

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
      expect(mockValidateWorkItemExists).toHaveBeenCalledWith('test-org', 'azdo-token', '99999');
    });

    it('should pass when work item exists in Azure DevOps', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'validate-work-item-exists') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'test-org';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature AB#12345'
            }
          }
        ]
      });

      // Mock work item validation to return true (work item exists)
      mockValidateWorkItemExists.mockResolvedValue(true);

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockValidateWorkItemExists).toHaveBeenCalledWith('test-org', 'azdo-token', '12345');
    });

    it('should update existing invalid work item comment to success when work items are fixed', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'validate-work-item-exists') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'test-org';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature AB#12345'
            }
          }
        ]
      });

      // Existing invalid work item comment
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 555,
            body: `${COMMENT_MARKERS.INVALID_WORK_ITEMS}\n:x: There is 1 work item (AB#99999) in pull request #42 that does not exist in Azure DevOps.`
          }
        ]
      });

      // Mock work item validation to return true (work item now exists)
      mockValidateWorkItemExists.mockResolvedValue(true);

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      // Should update the existing comment to success
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          comment_id: 555,
          body: expect.stringContaining(
            ':white_check_mark: All work items referenced in this pull request now exist in Azure DevOps.'
          )
        })
      );
      expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
    });

    it('should skip validation when validate-work-item-exists is false', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'validate-work-item-exists') return 'false';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'false';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123',
            commit: {
              message: 'feat: add feature AB#99999'
            }
          }
        ]
      });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockValidateWorkItemExists).not.toHaveBeenCalled();
    });

    it('should show commit info in dropdown for multiple invalid work items', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'validate-work-item-exists') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'test-org';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123def456',
            commit: {
              message: 'feat: add feature AB#99999'
            }
          },
          {
            sha: 'def456ghi789',
            commit: {
              message: 'fix: bug fix AB#88888'
            }
          }
        ]
      });

      // Mock both work items as invalid
      mockValidateWorkItemExists.mockResolvedValue(false);

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();

      // Verify the comment includes commit info in dropdown
      const commentCall = mockOctokit.rest.issues.createComment.mock.calls[0][0];
      expect(commentCall.body).toContain('View all 2 invalid work items');
      expect(commentCall.body).toContain('`AB#99999` (commit [`abc123d`]');
      expect(commentCall.body).toContain('`AB#88888` (commit [`def456g`]');
    });

    it('should show "in PR title/body" for work items from PR validation', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'false';
        if (name === 'check-pull-request') return 'true';
        if (name === 'validate-work-item-exists') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'test-org';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature AB#99999',
          body: 'This PR implements AB#88888'
        }
      });

      // Mock both work items as invalid
      mockValidateWorkItemExists.mockResolvedValue(false);

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();

      // Verify the comment includes "in PR title/body" for both work items
      const commentCall = mockOctokit.rest.issues.createComment.mock.calls[0][0];
      expect(commentCall.body).toContain('View all 2 invalid work items');
      expect(commentCall.body).toContain('`AB#99999` (in PR title/body)');
      expect(commentCall.body).toContain('`AB#88888` (in PR title/body)');
    });

    it('should show commit info when work item is found in both commit and PR validation', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'true';
        if (name === 'validate-work-item-exists') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'test-org';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      // Commit has 2 work items, both valid in commit check but invalid in existence check
      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123def456',
            commit: {
              message: 'feat: add feature AB#99999 AB#88888'
            }
          }
        ]
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature',
          body: 'This PR implements AB#99999 and AB#88888'
        }
      });

      // Mock both work items as invalid
      mockValidateWorkItemExists.mockResolvedValue(false);

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();

      // Commit validation runs first and finds 2 invalid work items
      const commentCall = mockOctokit.rest.issues.createComment.mock.calls[0][0];

      // Should show 2 work items in dropdown, both from commits since commit validation runs first
      expect(commentCall.body).toContain('There are 2 work items');
      expect(commentCall.body).toContain('View all 2 invalid work items');
      // Both from commits
      expect(commentCall.body).toContain('`AB#99999` (commit [`abc123d`]');
      expect(commentCall.body).toContain('`AB#88888` (commit [`abc123d`]');
    });

    it('should update existing comment when invalid work items change (1 to 2)', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'false';
        if (name === 'validate-work-item-exists') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'test-org';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123def456',
            commit: {
              message: 'feat: add feature AB#99999 AB#88888'
            }
          }
        ]
      });

      // Existing comment has 1 invalid work item
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 777,
            body: `${COMMENT_MARKERS.INVALID_WORK_ITEMS}\n:x: There is 1 work item (\`AB#99999\`) in pull request #42 that does not exist in Azure DevOps.`
          }
        ]
      });

      // Mock both work items as invalid
      mockValidateWorkItemExists.mockResolvedValue(false);

      await run();

      expect(mockSetFailed).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          comment_id: 777,
          body: expect.stringContaining('There are 2 work items')
        })
      );
      // Should now have dropdown format with both work items
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('View all 2 invalid work items')
        })
      );
      expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
    });

    it('should combine invalid work items from both commits and PR title/body into ONE comment', async () => {
      mockGetInput.mockImplementation(name => {
        if (name === 'check-commits') return 'true';
        if (name === 'check-pull-request') return 'true';
        if (name === 'validate-work-item-exists') return 'true';
        if (name === 'azure-devops-token') return 'azdo-token';
        if (name === 'azure-devops-organization') return 'test-org';
        if (name === 'github-token') return 'github-token';
        if (name === 'comment-on-failure') return 'true';
        return 'false';
      });

      // Commit has invalid work item AB#555558
      mockOctokit.rest.pulls.listCommits.mockResolvedValue({
        data: [
          {
            sha: 'abc123def456',
            commit: {
              message: 'feat: add feature AB#555558'
            }
          }
        ]
      });

      // PR body has invalid work item AB#55555555
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          title: 'feat: new feature',
          body: 'Related to AB#55555555'
        }
      });

      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: []
      });

      // Mock both work items as invalid
      mockValidateWorkItemExists.mockResolvedValue(false);

      await run();

      expect(mockSetFailed).toHaveBeenCalled();

      // Should create ONE comment with both invalid work items
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.issues.updateComment).not.toHaveBeenCalled();

      const commentCall = mockOctokit.rest.issues.createComment.mock.calls[0][0];
      expect(commentCall.body).toContain('There are 2 work items');
      expect(commentCall.body).toContain('AB#555558');
      expect(commentCall.body).toContain('AB#55555555');
      // Should show which came from commit vs PR body
      expect(commentCall.body).toContain('`AB#555558` (commit [`abc123d`]');
      expect(commentCall.body).toContain('`AB#55555555` (in PR title/body)');
    });
  });

  describe('GitHub token permissions', () => {
    it('should provide helpful error message when GITHUB_TOKEN lacks pull-requests write permission', async () => {
      // Mock PR data
      mockContext.payload.pull_request = {
        number: 123
      };

      // Mock commits without AB# pattern
      mockOctokit.paginate.mockResolvedValueOnce([
        {
          sha: 'abc1234567890',
          commit: { message: 'Fix bug without work item' }
        }
      ]);

      // Mock listComments to succeed
      mockOctokit.paginate.mockResolvedValueOnce([]);

      // Mock createComment to fail with 403 permission error
      const permissionError = new Error('Resource not accessible by integration');
      permissionError.status = 403;
      mockOctokit.rest.issues.createComment.mockRejectedValueOnce(permissionError);

      // Mock inputs
      mockGetInput.mockImplementation(input => {
        const inputs = {
          'check-commits': 'true',
          'check-pull-request': 'false',
          'fail-if-missing-workitem-commit-link': 'true',
          'link-commits-to-pull-request': 'false',
          'comment-on-failure': 'true',
          'validate-work-item-exists': 'false',
          'github-token': 'fake-token',
          'azure-devops-token': '',
          'azure-devops-organization': ''
        };
        return inputs[input] || '';
      });

      await run();

      // Should set a helpful error message about missing permissions
      expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('pull-requests: write'));
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('GITHUB_TOKEN does not have sufficient permissions')
      );
    });
  });

  describe('extractWorkItemIdsFromBranch', () => {
    it('should extract work item ID from task/12345/make-it-better', () => {
      expect(extractWorkItemIdsFromBranch('task/12345/make-it-better')).toEqual(['12345']);
    });

    it('should extract work item ID from task/12345-make-it-better', () => {
      expect(extractWorkItemIdsFromBranch('task/12345-make-it-better')).toEqual(['12345']);
    });

    it('should extract work item ID from task/12345', () => {
      expect(extractWorkItemIdsFromBranch('task/12345')).toEqual(['12345']);
    });

    it('should extract work item ID from task-12345', () => {
      expect(extractWorkItemIdsFromBranch('task-12345')).toEqual(['12345']);
    });

    it('should extract work item ID from 12345-make-it-better', () => {
      expect(extractWorkItemIdsFromBranch('12345-make-it-better')).toEqual(['12345']);
    });

    it('should extract work item ID from 12345make-it-better', () => {
      expect(extractWorkItemIdsFromBranch('12345make-it-better')).toEqual(['12345']);
    });

    it('should extract work item ID from 12345', () => {
      expect(extractWorkItemIdsFromBranch('12345')).toEqual(['12345']);
    });

    it('should extract work item ID from feature_12345_description', () => {
      expect(extractWorkItemIdsFromBranch('feature_12345_description')).toEqual(['12345']);
    });

    it('should return unique IDs when branch contains duplicates', () => {
      expect(extractWorkItemIdsFromBranch('fix/12345/12345-again')).toEqual(['12345']);
    });

    it('should extract multiple different work item IDs', () => {
      expect(extractWorkItemIdsFromBranch('fix/12345/67890-combined')).toEqual(['12345', '67890']);
    });

    it('should return empty array for branch with no numbers', () => {
      expect(extractWorkItemIdsFromBranch('feature/add-new-stuff')).toEqual([]);
    });

    it('should return empty array for null/empty input', () => {
      expect(extractWorkItemIdsFromBranch('')).toEqual([]);
      expect(extractWorkItemIdsFromBranch(null)).toEqual([]);
      expect(extractWorkItemIdsFromBranch(undefined)).toEqual([]);
    });
  });

  describe('Add AB# tag from branch', () => {
    it('should add AB# tag to PR body when work item found in branch name', async () => {
      mockContext.payload.pull_request = { number: 42, head: { ref: 'task/12345/make-it-better' } };

      mockGetInput.mockImplementation(name => {
        const inputs = {
          'check-commits': 'true',
          'check-pull-request': 'false',
          'fail-if-missing-workitem-commit-link': 'false',
          'link-commits-to-pull-request': 'false',
          'comment-on-failure': 'false',
          'validate-work-item-exists': 'false',
          'append-work-item-title': 'false',
          'add-ab-tag-from-branch': 'true',
          'github-token': 'github-token',
          'azure-devops-token': '',
          'azure-devops-organization': ''
        };
        return inputs[name] || '';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { title: 'My PR', body: 'Some description' }
      });

      mockOctokit.paginate.mockResolvedValueOnce([]); // commits

      await run();

      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('AB#12345')
        })
      );
    });

    it('should not add AB# tag when it already exists in PR body', async () => {
      mockContext.payload.pull_request = { number: 42, head: { ref: 'task/12345/make-it-better' } };

      mockGetInput.mockImplementation(name => {
        const inputs = {
          'check-commits': 'true',
          'check-pull-request': 'false',
          'fail-if-missing-workitem-commit-link': 'false',
          'link-commits-to-pull-request': 'false',
          'comment-on-failure': 'false',
          'validate-work-item-exists': 'false',
          'append-work-item-title': 'false',
          'add-ab-tag-from-branch': 'true',
          'github-token': 'github-token',
          'azure-devops-token': '',
          'azure-devops-organization': ''
        };
        return inputs[name] || '';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { title: 'My PR', body: 'Fix AB#12345 bug' }
      });

      mockOctokit.paginate.mockResolvedValueOnce([]); // commits

      await run();

      // Should NOT call update since AB#12345 is already in the body
      expect(mockOctokit.rest.pulls.update).not.toHaveBeenCalled();
    });

    it('should not update PR when no work item IDs found in branch', async () => {
      mockContext.payload.pull_request = { number: 42, head: { ref: 'feature/add-new-stuff' } };

      mockGetInput.mockImplementation(name => {
        const inputs = {
          'check-commits': 'true',
          'check-pull-request': 'false',
          'fail-if-missing-workitem-commit-link': 'false',
          'link-commits-to-pull-request': 'false',
          'comment-on-failure': 'false',
          'validate-work-item-exists': 'false',
          'append-work-item-title': 'false',
          'add-ab-tag-from-branch': 'true',
          'github-token': 'github-token',
          'azure-devops-token': '',
          'azure-devops-organization': ''
        };
        return inputs[name] || '';
      });

      mockOctokit.paginate.mockResolvedValueOnce([]); // commits

      await run();

      // Should NOT call pulls.get or pulls.update since no IDs found
      expect(mockOctokit.rest.pulls.update).not.toHaveBeenCalled();
    });

    it('should not run when add-ab-tag-from-branch is false', async () => {
      mockContext.payload.pull_request = { number: 42, head: { ref: 'task/12345/make-it-better' } };

      mockGetInput.mockImplementation(name => {
        const inputs = {
          'check-commits': 'true',
          'check-pull-request': 'false',
          'fail-if-missing-workitem-commit-link': 'false',
          'link-commits-to-pull-request': 'false',
          'comment-on-failure': 'false',
          'validate-work-item-exists': 'false',
          'append-work-item-title': 'false',
          'add-ab-tag-from-branch': 'false',
          'github-token': 'github-token',
          'azure-devops-token': '',
          'azure-devops-organization': ''
        };
        return inputs[name] || '';
      });

      mockOctokit.paginate.mockResolvedValueOnce([]); // commits

      await run();

      // Should NOT call pulls.update since feature is disabled
      expect(mockOctokit.rest.pulls.update).not.toHaveBeenCalled();
    });

    it('should handle empty PR body when adding AB# tag', async () => {
      mockContext.payload.pull_request = { number: 42, head: { ref: 'task/12345/fix' } };

      mockGetInput.mockImplementation(name => {
        const inputs = {
          'check-commits': 'true',
          'check-pull-request': 'false',
          'fail-if-missing-workitem-commit-link': 'false',
          'link-commits-to-pull-request': 'false',
          'comment-on-failure': 'false',
          'validate-work-item-exists': 'false',
          'append-work-item-title': 'false',
          'add-ab-tag-from-branch': 'true',
          'github-token': 'github-token',
          'azure-devops-token': '',
          'azure-devops-organization': ''
        };
        return inputs[name] || '';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { title: 'My PR', body: '' }
      });

      mockOctokit.paginate.mockResolvedValueOnce([]); // commits

      await run();

      // Should set body to just the AB# tag (no leading newlines)
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'AB#12345'
        })
      );
    });

    it('should add multiple AB# tags from branch with multiple IDs', async () => {
      mockContext.payload.pull_request = { number: 42, head: { ref: 'fix/12345/67890-combined' } };

      mockGetInput.mockImplementation(name => {
        const inputs = {
          'check-commits': 'true',
          'check-pull-request': 'false',
          'fail-if-missing-workitem-commit-link': 'false',
          'link-commits-to-pull-request': 'false',
          'comment-on-failure': 'false',
          'validate-work-item-exists': 'false',
          'append-work-item-title': 'false',
          'add-ab-tag-from-branch': 'true',
          'github-token': 'github-token',
          'azure-devops-token': '',
          'azure-devops-organization': ''
        };
        return inputs[name] || '';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { title: 'My PR', body: 'Description' }
      });

      mockOctokit.paginate.mockResolvedValueOnce([]); // commits

      await run();

      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('AB#12345')
        })
      );
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('AB#67890')
        })
      );
    });

    it('should only add missing AB# tags when some already exist in body', async () => {
      mockContext.payload.pull_request = { number: 42, head: { ref: 'fix/12345/67890-combined' } };

      mockGetInput.mockImplementation(name => {
        const inputs = {
          'check-commits': 'true',
          'check-pull-request': 'false',
          'fail-if-missing-workitem-commit-link': 'false',
          'link-commits-to-pull-request': 'false',
          'comment-on-failure': 'false',
          'validate-work-item-exists': 'false',
          'append-work-item-title': 'false',
          'add-ab-tag-from-branch': 'true',
          'github-token': 'github-token',
          'azure-devops-token': '',
          'azure-devops-organization': ''
        };
        return inputs[name] || '';
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { title: 'My PR', body: 'Fixes AB#12345' }
      });

      mockOctokit.paginate.mockResolvedValueOnce([]); // commits

      await run();

      // Should only add AB#67890 since AB#12345 already exists
      const updateCall = mockOctokit.rest.pulls.update.mock.calls[0][0];
      expect(updateCall.body).toContain('AB#67890');
      expect(updateCall.body).toContain('Fixes AB#12345'); // original body preserved
    });
  });
});
