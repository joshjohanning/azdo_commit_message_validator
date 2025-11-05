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
            body: ':x: There is at least one commit (abc1234) in pull request #42'
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
    it('should attempt linking without failing when credentials are present', async () => {
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

      // Should still call linkWorkItem even with empty credentials
      expect(mockLinkWorkItem).toHaveBeenCalled();
    });
  });
});
