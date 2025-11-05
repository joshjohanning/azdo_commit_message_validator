/**
 * Tests for index.js Azure DevOps Commit Validator
 */

import { jest } from '@jest/globals';

// Mock @actions/core
const mockGetInput = jest.fn();
const mockSetFailed = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();

jest.unstable_mockModule('@actions/core', () => ({
  getInput: mockGetInput,
  setFailed: mockSetFailed,
  info: mockInfo,
  error: mockError
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

// Mock ./main.js
const mockLinkWorkItem = jest.fn();
jest.unstable_mockModule('../src/main.js', () => ({
  run: mockLinkWorkItem
}));

describe('Azure DevOps Commit Validator', () => {
  let mockOctokit;
  let run;

  beforeAll(async () => {
    // Set NODE_ENV to test to prevent auto-execution
    process.env.NODE_ENV = 'test';

    // Import the run function
    const indexModule = await import('../src/index.js');
    run = indexModule.run;
  });

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Setup default mock implementations
    mockGetInput.mockImplementation(name => {
      const defaults = {
        'check-pull-request': 'false',
        'check-commits': 'true',
        'fail-if-missing-workitem-commit-link': 'true',
        'link-commits-to-pull-request': 'false',
        'azure-devops-token': '',
        'azure-devops-organization': '',
        'github-token': 'github-token',
        'comment-on-failure': 'true'
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
          updateComment: jest.fn().mockResolvedValue({ data: { id: 123 } })
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
    mockContext.payload.pull_request = { number: 42 };
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
  });
});
