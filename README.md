# Azure DevOps Commit/PR Validator and Commit+Pull Request Linker Action

[![GitHub release](https://img.shields.io/github/release/joshjohanning/azdo_commit_message_validator.svg?logo=github&labelColor=333)](https://github.com/joshjohanning/azdo_commit_message_validator/releases)
[![Immutable releases](https://img.shields.io/badge/releases-immutable-blue?labelColor=333)](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/immutable-releases)
[![GitHub marketplace](https://img.shields.io/badge/marketplace-Azure%20DevOps%20Commit%20Validator%20and%20Pull%20Request%20Linker-blue?logo=github&labelColor=333)](https://github.com/marketplace/actions/azure-devops-commit-validator-and-pull-request-linker)
[![CI](https://github.com/joshjohanning/azdo_commit_message_validator/actions/workflows/ci.yml/badge.svg)](https://github.com/joshjohanning/azdo_commit_message_validator/actions/workflows/ci.yml)
[![Publish GitHub Action](https://github.com/joshjohanning/azdo_commit_message_validator/actions/workflows/publish.yml/badge.svg)](https://github.com/joshjohanning/azdo_commit_message_validator/actions/workflows/publish.yml)
![Coverage](./badges/coverage.svg)

This action validates that pull requests and commits contain Azure DevOps work item links (e.g. `AB#123`), and **automatically links the GitHub Pull Request to work items found in commit messages**.

## What's new

Please refer to the [release page](https://github.com/joshjohanning/azdo_commit_message_validator/releases) for the latest release notes.

## Key Features

1. **Validates Pull Requests** - Ensures PR title or body contains an Azure DevOps work item link (e.g. `AB#123`)
2. **Validates Commits** - Ensures each commit in a pull request has an Azure DevOps work item link (e.g. `AB#123`) in the commit message
3. **Automatically Links PRs to Work Items** - When a work item is referenced in a commit message, the action adds a GitHub Pull Request link to that work item in Azure DevOps
   - 🎯 **This is the key differentiator**: By default, Azure DevOps only adds the Pull Request link to work items mentioned directly in the PR title or body, but this action also links work items found in commit messages!
4. **Auto-Tag from Branch** - Optionally extracts work item IDs from the head branch name (e.g. `task/12345/fix-bug`) and adds `AB#12345` to the PR body automatically
5. **Visibility & Tracking** - Work item linkages are added to the job summary for easy visibility

## Action Output

The action provides visibility into work items through the **Job Summary**:

- A summary of all work items found in commits and PR is added to the workflow run's job summary page
- Includes clickable links to commits and displays associated work items
- Shows which work items were **linked** to the PR (when `link-commits-to-pull-request` is enabled) vs. **verified** (when `validate-work-item-exists` is enabled)
- Provides a quick reference of work items associated with the PR

## Usage

This should only be triggered via pull requests.

```yml
name: pr-commit-message-enforcer-and-linker

on:
  pull_request:
    branches: ['main']
    types:
      - opened
      - synchronize
      - reopened
      - edited # can re-run without code changes

jobs:
  pr-commit-message-enforcer-and-linker:
    runs-on: ubuntu-latest
    # Skip runs triggered by azure-boards bot editing the PR body to avoid duplicate workflow runs
    if: github.actor != 'azure-boards[bot]'
    permissions:
      contents: read
      pull-requests: write

    steps:
      - uses: actions/checkout@v6
      - name: Azure DevOps Commit Validator and Pull Request Linker
        uses: joshjohanning/azdo_commit_message_validator@v4
        with:
          check-pull-request: true
          check-commits: true
          fail-if-missing-workitem-commit-link: true
          link-commits-to-pull-request: true
          azure-devops-organization: my-azdo-org
          azure-devops-token: ${{ secrets.AZURE_DEVOPS_PAT }}
```

### Inputs

| Name                                   | Description                                                                                                                                                                                                                                                                                                                                                                                                         | Required | Default               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------- |
| `check-pull-request`                   | Check the pull request for `AB#xxx` (scope configurable via `pull-request-check-scope`)                                                                                                                                                                                                                                                                                                                             | `true`   | `false`               |
| `pull-request-check-scope`             | Only if `check-pull-request=true`, where to look for `AB#` in the PR: `title-or-body`, `body-only`, or `title-only`                                                                                                                                                                                                                                                                                                 | `false`  | `title-or-body`       |
| `check-commits`                        | Check each commit in the pull request for `AB#xxx`                                                                                                                                                                                                                                                                                                                                                                  | `true`   | `true`                |
| `fail-if-missing-workitem-commit-link` | Only if `check-commits=true`, fail the action if a commit in the pull request is missing AB# in every commit message                                                                                                                                                                                                                                                                                                | `false`  | `true`                |
| `link-commits-to-pull-request`         | Only if `check-commits=true`, link the work items found in commits to the pull request                                                                                                                                                                                                                                                                                                                              | `false`  | `true`                |
| `validate-work-item-exists`            | Validate that the work item(s) referenced in commits and PR exist in Azure DevOps (requires `azure-devops-token` and `azure-devops-organization`)                                                                                                                                                                                                                                                                   | `false`  | `true`                |
| `add-work-item-table`                  | Add a "Linked Work Items" table to the PR body showing titles for `AB#xxx` references (original references are preserved). Requires `azure-devops-token` and `azure-devops-organization`                                                                                                                                                                                                                            | `false`  | `false`               |
| `add-work-item-from-branch`            | Automatically extract work item ID(s) from the head branch name and add `AB#xxx` to the PR body if not already present. Only numbers following one of the configured `branch-work-item-prefixes` keywords are extracted. Each ID is always validated against Azure DevOps before being added (regardless of the `validate-work-item-exists` setting). Requires `azure-devops-token` and `azure-devops-organization` | `false`  | `false`               |
| `branch-work-item-prefixes`            | Comma-separated list of keyword prefixes used to identify work item IDs in branch names (e.g. `task/12345`). Only numbers following one of these keywords (separated by `/`, `-`, or `_`) are extracted. Only used when `add-work-item-from-branch` is `true`                                                                                                                                                       | `false`  | `task, bug, bugfix`   |
| `branch-work-item-min-digits`          | Minimum number of digits for a work item ID extracted from a branch name. Set to `1` to match any length. Only used when `add-work-item-from-branch` is `true`                                                                                                                                                                                                                                                      | `false`  | `5`                   |
| `azure-devops-organization`            | The name of the Azure DevOps organization. Required when any of these are enabled: `link-commits-to-pull-request`, `validate-work-item-exists`, `add-work-item-table`, or `add-work-item-from-branch`                                                                                                                                                                                                               | `false`  | `''`                  |
| `azure-devops-token`                   | Azure DevOps PAT (needs to be a `full` PAT). Required when any of these are enabled: `link-commits-to-pull-request`, `validate-work-item-exists`, `add-work-item-table`, or `add-work-item-from-branch`                                                                                                                                                                                                             | `false`  | `''`                  |
| `github-token`                         | The GitHub token that has `contents: read` and `pull-requests: write` access                                                                                                                                                                                                                                                                                                                                        | `true`   | `${{ github.token }}` |
| `comment-on-failure`                   | Comment on the pull request if the action fails                                                                                                                                                                                                                                                                                                                                                                     | `true`   | `true`                |

### Auto-Tag from Branch Name

When `add-work-item-from-branch` is enabled, the action extracts work item IDs from the pull request's head branch name and adds `AB#xxx` tags to the PR body. This is useful when your team's branching convention includes the Azure DevOps work item ID in the branch name.

**How it works:**

1. The action scans the branch name for keyword prefixes (default: `task`, `bug`, `bugfix`) followed by a separator (`/`, `-`, or `_`) and a number
2. The keyword must appear at the **start of the branch** or after a path separator (`/`) — keywords that appear mid-description are ignored
3. Date-shaped numbers (e.g. `2024-01-15`) are automatically excluded
4. Every extracted ID is validated against Azure DevOps before being added to the PR body — IDs that don't exist are skipped with a warning
5. IDs already present in the PR body are not added again

**Branch name examples:**

| Branch Name                   | Extracted IDs | Notes                                                                |
| ----------------------------- | ------------- | -------------------------------------------------------------------- |
| `task/12345/fix-login`        | `12345`       | ✅ Standard convention                                               |
| `bug-67890`                   | `67890`       | ✅ Keyword with `-` separator                                        |
| `users/josh/task/12345/fix`   | `12345`       | ✅ Keyword after path separator                                      |
| `bugfix/2024-01-15-fix-login` | _(none)_      | ⛔ Date pattern excluded                                             |
| `task/12345/fix-bug-67890`    | `12345`       | ⛔ `bug` in description ignored                                      |
| `hotfix/2024-bugfix`          | _(none)_      | ⛔ `hotfix` is not a default prefix                                  |
| `feature/task-manager-ui`     | _(none)_      | ⛔ No number after keyword                                           |
| `release/task-2.0.1`          | _(none)_      | ⛔ Short digits filtered by default `branch-work-item-min-digits: 5` |

**Lowering the minimum digit threshold:**

If your Azure DevOps work item IDs are shorter than 5 digits, set `branch-work-item-min-digits` to a lower value:

```yml
- uses: joshjohanning/azdo_commit_message_validator@v4
  with:
    add-work-item-from-branch: true
    branch-work-item-min-digits: 3
    azure-devops-organization: my-azdo-org
    azure-devops-token: ${{ secrets.AZURE_DEVOPS_PAT }}
```

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
