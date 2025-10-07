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
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = void 0;
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const azdev = __importStar(require("azure-devops-node-api"));
const WorkItemTrackingInterfaces_1 = require("azure-devops-node-api/interfaces/WorkItemTrackingInterfaces");
const node_fetch_1 = __importDefault(require("node-fetch"));
const relArticaftLink = "ArtifactLink";
const relNameGitHubPr = "GitHub Pull Request";
const msGitHubLinkDataProviderLink =
  "ms.vss-work-web.github-link-data-provider";
const dataProviderUrlBase = `https://dev.azure.com/%DEVOPS_ORG%/_apis/Contribution/dataProviders/query?api-version=7.1-preview.1`;
const artifactLinkGitHubPrRegex =
  "\\/GitHub\\/PullRequest\\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})%2F([0-9]*)";
let hasError = false;
let workItem = null;
function run() {
  var _a, _b, _c, _d;
  return __awaiter(this, void 0, void 0, function* () {
    try {
      const repoToken = process.env.REPO_TOKEN;
      const devOpsOrg = process.env.AZURE_DEVOPS_ORG;
      const azToken = process.env.AZURE_DEVOPS_PAT;
      const workItemId = process.env.WORKITEMID;
      const githubHostname = process.env.GITHUB_SERVER_URL;
      const prRequestId = process.env.PULLREQUESTID;
      const dataProviderUrl = dataProviderUrlBase.replace(
        "%DEVOPS_ORG%",
        devOpsOrg
      );
      const repo = process.env.REPO;
      const triggerFromPr = undefined !== prRequestId;

      console.log("Initialize dev ops connection ...");
      let azWorkApi;
      try {
        let orgUrl = `https://dev.azure.com/${devOpsOrg}`;
        let authHandler = azdev.getPersonalAccessTokenHandler(azToken);
        let azWebApi = new azdev.WebApi(orgUrl, authHandler);
        azWorkApi = yield azWebApi.getWorkItemTrackingApi();
      } catch (exception) {
        console.log(`... failed! ${exception}`);
        core.setFailed("Failed connection to dev ops!");
        return;
      }
      console.log("... success!");

      hasError = false;
      if (true) {
        console.log("Retrieving internalRepoId ...");
        try {
          const dataProviderResponse = yield (0, node_fetch_1.default)(
            dataProviderUrl,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${Buffer.from(":" + azToken).toString(
                  "base64"
                )}`,
                Accept: "application/json",
              },
              body: JSON.stringify({
                context: {
                  properties: {
                    workItemId: workItemId,
                    urls: [`${githubHostname}/${repo}/pull/${prRequestId}`],
                  },
                },
                contributionIds: [msGitHubLinkDataProviderLink],
              }),
            }
          );
          if (dataProviderResponse.status === 401) {
            throw new Error(
              "Missing authorization (Linking PRs to cards requires full access for the PAT)."
            );
          }
          const responseData = yield dataProviderResponse.json();
          const internalRepoId =
            (_b =
              responseData.data[msGitHubLinkDataProviderLink]
                .resolvedLinkItems[0].repoInternalId) !== null && _b !== void 0
              ? _b
              : null;
          console.log(internalRepoId);
          console.log("... success!");
          if (null === internalRepoId || internalRepoId.length === 0) {
            throw new Error("Internal repo url couldn't be resolved.");
          }
          const artifactUrl = `vstfs:///GitHub/PullRequest/${internalRepoId}%2F${prRequestId}`;
          try {
            console.log("trying to create the pull request link ...");
            workItem = yield azWorkApi.updateWorkItem(
              {},
              [
                {
                  op: "add",
                  path: "/relations/-",
                  value: {
                    rel: relArticaftLink,
                    url: artifactUrl,
                    attributes: {
                      name: relNameGitHubPr,
                      comment: `Pull Request ${prRequestId}`,
                    },
                  },
                },
              ],
              workItemId,
              undefined,
              undefined,
              undefined,
              undefined,
              WorkItemTrackingInterfaces_1.WorkItemExpand.Relations
            );
            console.log("... success!");
          } catch (exception) {
            const errorMessage = exception.toString();
            if (-1 !== errorMessage.indexOf("already exists")) {
              console.log("... (already exists) ...");
            } else {
              throw exception;
            }
          }
        } catch (exception) {
          hasError = true;
          console.log(`... failed! ${exception}`);

          if (true) {
            core.setFailed(`Failed retrieve internalRepoId!`);
            return;
          }
        }
        if (!hasError) {
          console.log("... process complete!");
        }
      }
    } catch (error) {
      console.error(error);
      core.setFailed("Unknown error" + error);
      throw error;
    }
  });
}
exports.run = run;
run();
