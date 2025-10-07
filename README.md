# Azure DevOps Commit/PR Validator and Pull Request Linker Action

This is an action to be ran in a pull request to make sure either that one or both of the following scenarios are met:

1. Pull request title or body contains an Azure DevOps work item link (e.g. `AB#123`)
2. Each commit in a pull request has an Azure DevOps work item link (e.g. `AB#123`) in the commit message
   - Optionally, add a GitHub Pull Request link to the work item in Azure DevOps
   - By default, Azure DevOps only adds the Pull Request link to work items mentioned directly in the PR title or body

## Usage

This should only be triggered via pull requests.

```yml
name: pr-commit-message-enforcer-and-linker

on:
  pull_request:
    branches: ["main"]
    types:
      - opened
      - synchronize
      - reopened
      - edited # can re-run without code changes

jobs:
  pr-commit-message-enforcer-and-linker:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write

    steps:
      - uses: actions/checkout@v4
      - name: Azure DevOps Commit Validator and Pull Request Linker
        uses: joshjohanning/azdo_commit_message_validator@v2
        with:
          check-pull-request: true
          check-commits: true
          fail-if-missing-workitem-commit-link: true
          link-commits-to-pull-request: true
          verify-work-items-exist: true # Optional: validate work items actually exist
          azure-devops-organization: my-azdo-org
          azure-devops-token: ${{ secrets.AZURE_DEVOPS_PAT }}
```

### Inputs

| Name                                   | Description                                                                                                                    | Required | Default               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------- |
| `check-pull-request`                   | Check the pull request body and title for `AB#xxx`                                                                             | `true`   | `true`                |
| `check-commits`                        | Check each commit in the pull request for `AB#xxx`                                                                             | `true`   | `true`                |
| `fail-if-missing-workitem-commit-link` | Only if `check-commits=true`, fail the action if a commit in the pull request is missing AB# in every commit message           | `false`  | `true`                |
| `link-commits-to-pull-request`         | Only if `check-commits=true`, link the work items found in commits to the pull request                                         | `false`  | `true`                |
| `verify-work-items-exist`              | Validate that work items referenced in commits/PRs actually exist in Azure DevOps (requires `azure-devops-token` and `azure-devops-organization`) | `false`  | `false`               |
| `azure-devops-organization`            | Only required if `link-commits-to-pull-request=true` or `verify-work-items-exist=true`, the name of the Azure DevOps organization | `false`  | `''`                  |
| `azure-devops-token`                   | Only required if `link-commits-to-pull-request=true` or `verify-work-items-exist=true`, Azure DevOps PAT used to link work item to PR (needs to be a `full` PAT) | `false`  | `''`                  |
| `github-token`                         | The GitHub token that has contents-read and pull_request-write access                                                          | `true`   | `${{ github.token }}` |

## Setup

### Runner Software Requirements

Required software installed on runner:

- `bash` (tested with `ubuntu-latest` runner)
- [`gh` (GitHub CLI)](https://cli.github.com/)
- [`jq`](https://jqlang.github.io/jq/download/)
- `grep`
- `cut`

## Screenshots

### Failing pull request, including comment back to the pull request showing why it failed

<img width="917" alt="image" src="https://github.com/joshjohanning/azdo_commit_message_validator/assets/19912012/383358aa-748e-4666-be52-2ae6e371530e">

<img width="868" alt="image" src="https://github.com/joshjohanning/azdo_commit_message_validator/assets/19912012/2dbc0775-7810-4ba3-98e0-b49391c63e7e">

### Failing commit

<img width="1033" alt="image" src="https://user-images.githubusercontent.com/19912012/182519049-3bd1281d-985c-41ea-b35c-c3cd35994d48.png">

### Adding Pull Request link in Azure DevOps to work item linked to a commit in a pull request

<img width="290" alt="image" src="https://user-images.githubusercontent.com/19912012/182518941-4c7d5bad-b19f-456a-b3bd-504b3ab2f45d.png">

### Validating the logs and creating pull requests

<img width="713" alt="image" src="https://user-images.githubusercontent.com/19912012/182616583-70ef5ac4-c669-40df-8fa4-60b15ab1f58f.png">

## How the commit / pull request linking in Azure DevOps works

If the `check-commits: true` the action will look at each commit in the pull request and check for `AB#123` in the commit message.

The action loops through each commit and:

1. Makes sure it has `AB#123` in the commit message
2. If it does, and if `link-commits-to-pull-request: true`, add a GitHub Pull Request link to the work item in Azure DevOps

Adding the link to the GitHub Pull Request was the tricky part.

If you use an API to look at the links of a work item with a GitHub pull request link, you will see:

```json
      "attributes": {
        "authorizedDate": "2022-08-02T18:45:03.567Z",
        "id": 3916078,
        "name": "GitHub Pull Request",
        "resourceCreatedDate": "2022-08-02T18:45:03.567Z",
        "resourceModifiedDate": "2022-08-02T18:45:03.567Z",
        "revisedDate": "9999-01-01T00:00:00Z"
      },
      "rel": "Artifact Link",
      "url": "vstfs:///GitHub/PullRequest/62f33e8a-c421-441d-88e1-06c46c4ffbbb%2f7"
```

Note the `url` field - `vstfs:///GitHub/PullRequest/62f33e8a-c421-441d-88e1-06c46c4ffbbb%2f7`

Creating a [new link is (relatively) easy with the API](https://docs.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1&tabs=HTTP#add-a-link), but you can't just use the regular GitHub pull request link. They use a garbled GUID that isn't the GUID or ID of the repo in GitHub.

The GUID can be found using an (undocumented) API:

```
POST https://dev.azure.com/%DEVOPS_ORG%/_apis/Contribution/dataProviders/query?api-version=7.1-preview.1
```

See this [thread](https://developercommunity.visualstudio.com/t/artifact-uri-format-in-external-link-of-work-items/964448#T-N988703) for slightly more info.

Found the javascript sample [here](https://github.com/dc-ag/azure-devops-pr-notification/blob/fcb9cd24ffbcc2dbe81a7500a3d5577213afa7e3/lib/main.js). Other samples are [here](https://github.com/search?q=%22vstfs%3A%2F%2F%2FGitHub%22&type=code).
