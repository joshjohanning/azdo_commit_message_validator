// Mock @actions/core before importing validateWorkItem
jest.mock("@actions/core");
const core = require("@actions/core");

// Mock azure-devops-node-api
jest.mock("azure-devops-node-api");
const azdev = require("azure-devops-node-api");

describe("Work Item Validator", () => {
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear all mocks
    jest.clearAllMocks();
    jest.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    jest.clearAllTimers();
  });

  describe("Work item validation", () => {
    it("should export a validateWorkItem function", () => {
      const validateModule = require("../validateWorkItem");
      expect(validateModule.validateWorkItem).toBeDefined();
      expect(typeof validateModule.validateWorkItem).toBe("function");
    });

    it("should validate that a work item exists", async () => {
      // Set up Azure DevOps API mocks
      const mockWorkItemTrackingApi = {
        getWorkItem: jest.fn().mockResolvedValue({
          id: 12345,
          fields: {
            "System.Title": "Test Work Item",
          },
        }),
      };

      const mockWebApi = {
        getWorkItemTrackingApi: jest
          .fn()
          .mockResolvedValue(mockWorkItemTrackingApi),
      };

      const azdev = require("azure-devops-node-api");
      azdev.WebApi = jest.fn(() => mockWebApi);
      azdev.getPersonalAccessTokenHandler = jest.fn(() => ({}));

      // Set up environment variables
      process.env.AZURE_DEVOPS_ORG = "test-org";
      process.env.AZURE_DEVOPS_PAT = "azdo-pat";
      process.env.WORKITEMID = "12345";

      const core = require("@actions/core");
      const { validateWorkItem } = require("../validateWorkItem");
      await validateWorkItem();

      // Should not fail when work item exists
      expect(core.setFailed).not.toHaveBeenCalled();
      expect(mockWorkItemTrackingApi.getWorkItem).toHaveBeenCalledWith(12345);
    });

    it("should fail when work item does not exist", async () => {
      // Set up Azure DevOps API mocks
      const mockWorkItemTrackingApi = {
        getWorkItem: jest.fn().mockRejectedValue(
          new Error("TF401232: Work item 99999 does not exist, or you do not have permissions to read it.")
        ),
      };

      const mockWebApi = {
        getWorkItemTrackingApi: jest
          .fn()
          .mockResolvedValue(mockWorkItemTrackingApi),
      };

      const azdev = require("azure-devops-node-api");
      azdev.WebApi = jest.fn(() => mockWebApi);
      azdev.getPersonalAccessTokenHandler = jest.fn(() => ({}));

      // Set up environment variables
      process.env.AZURE_DEVOPS_ORG = "test-org";
      process.env.AZURE_DEVOPS_PAT = "azdo-pat";
      process.env.WORKITEMID = "99999";

      const core = require("@actions/core");
      const { validateWorkItem } = require("../validateWorkItem");
      await validateWorkItem();

      // Should fail when work item doesn't exist
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining("does not exist")
      );
      expect(mockWorkItemTrackingApi.getWorkItem).toHaveBeenCalledWith(99999);
    });

    it("should fail when Azure DevOps connection fails", async () => {
      // Set up Azure DevOps API mocks to fail
      const azdev = require("azure-devops-node-api");
      azdev.WebApi = jest.fn(() => {
        throw new Error("Connection failed");
      });
      azdev.getPersonalAccessTokenHandler = jest.fn(() => ({}));

      // Set up environment variables
      process.env.AZURE_DEVOPS_ORG = "test-org";
      process.env.AZURE_DEVOPS_PAT = "invalid-pat";
      process.env.WORKITEMID = "12345";

      const core = require("@actions/core");
      const { validateWorkItem } = require("../validateWorkItem");
      await validateWorkItem();

      // Should fail when connection fails
      expect(core.setFailed).toHaveBeenCalledWith(
        "Failed connection to Azure DevOps!"
      );
    });

    it("should handle null work item response", async () => {
      // Set up Azure DevOps API mocks
      const mockWorkItemTrackingApi = {
        getWorkItem: jest.fn().mockResolvedValue(null),
      };

      const mockWebApi = {
        getWorkItemTrackingApi: jest
          .fn()
          .mockResolvedValue(mockWorkItemTrackingApi),
      };

      const azdev = require("azure-devops-node-api");
      azdev.WebApi = jest.fn(() => mockWebApi);
      azdev.getPersonalAccessTokenHandler = jest.fn(() => ({}));

      // Set up environment variables
      process.env.AZURE_DEVOPS_ORG = "test-org";
      process.env.AZURE_DEVOPS_PAT = "azdo-pat";
      process.env.WORKITEMID = "12345";

      const core = require("@actions/core");
      const { validateWorkItem } = require("../validateWorkItem");
      await validateWorkItem();

      // Should fail when work item is null
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining("does not exist")
      );
    });
  });
});
