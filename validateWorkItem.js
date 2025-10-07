"use strict";
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
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
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }
    : function (o, v) {
        o["default"] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null)
      for (var k in mod)
        if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k))
          __createBinding(result, mod, k);
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
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWorkItem = void 0;
const core = __importStar(require("@actions/core"));
const azdev = __importStar(require("azure-devops-node-api"));

function validateWorkItem() {
  return __awaiter(this, void 0, void 0, function* () {
    try {
      const devOpsOrg = process.env.AZURE_DEVOPS_ORG;
      const azToken = process.env.AZURE_DEVOPS_PAT;
      const workItemId = process.env.WORKITEMID;

      console.log(`Validating work item ${workItemId} exists...`);

      // Initialize Azure DevOps connection
      let azWorkApi;
      try {
        let orgUrl = `https://dev.azure.com/${devOpsOrg}`;
        let authHandler = azdev.getPersonalAccessTokenHandler(azToken);
        let azWebApi = new azdev.WebApi(orgUrl, authHandler);
        azWorkApi = yield azWebApi.getWorkItemTrackingApi();
      } catch (exception) {
        console.log(`Failed to connect to Azure DevOps: ${exception}`);
        core.setFailed("Failed connection to Azure DevOps!");
        return;
      }

      // Try to get the work item
      try {
        const workItem = yield azWorkApi.getWorkItem(parseInt(workItemId));
        if (workItem && workItem.id) {
          console.log(`... work item ${workItemId} exists!`);
        } else {
          console.log(`... work item ${workItemId} not found!`);
          core.setFailed(`Work item ${workItemId} does not exist in Azure DevOps`);
        }
      } catch (exception) {
        const errorMessage = exception.toString();
        if (errorMessage.includes("404") || errorMessage.includes("does not exist")) {
          console.log(`... work item ${workItemId} not found!`);
          core.setFailed(`Work item ${workItemId} does not exist in Azure DevOps`);
        } else {
          console.log(`Error checking work item: ${exception}`);
          core.setFailed(`Failed to validate work item ${workItemId}: ${exception}`);
        }
      }
    } catch (error) {
      console.error(error);
      core.setFailed("Unknown error validating work item: " + error);
      throw error;
    }
  });
}
exports.validateWorkItem = validateWorkItem;

// Only run if called directly, not when imported
if (require.main === module) {
  validateWorkItem();
}
