# azdo_commit_message_validator

This is an action to be ran in a pull request to make sure that all commits have a `AB#123` in the commit message.

<img width="1033" alt="image" src="https://user-images.githubusercontent.com/19912012/182519049-3bd1281d-985c-41ea-b35c-c3cd35994d48.png">

It also automatically links pull request to all of the Azure DevOps work item(s).

<img width="290" alt="image" src="https://user-images.githubusercontent.com/19912012/182518941-4c7d5bad-b19f-456a-b3bd-504b3ab2f45d.png">

Screenshot of validating the logs and creating pull requests:

<img width="713" alt="image" src="https://user-images.githubusercontent.com/19912012/182616583-70ef5ac4-c669-40df-8fa4-60b15ab1f58f.png">

## Usage

```yml
on:
  pull_request:
    branches: [ "main" ]

jobs:
  pr-commit-message-enforcer-and-linker:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v3
    - name: Azure DevOps Commit Validator and Pull Request Linker
      uses: joshjohanning/azdo_commit_message_validator@v1
      with:
        azure-devops-organization: myorg # The name of the Azure DevOps organization
        azure-devops-token: ${{ secrets.AZURE_DEVOPS_PAT }} # "Azure DevOps Personal Access Token (needs to be a full PAT)
        fail-if-missing-workitem-commit-link: true # Fail the action if a commit in the pull request is missing AB# in the commit message
        link-commits-to-pull-request: true # Link the work items found in commits to the pull request
```

## Setup

1. Create a repository secret titled `AZURE_DEVOPS_PAT` - it needs to be a full PAT
2. Pass the Azure DevOps organization to the `azure-devops-organization` input parameter

## How this works

The action loops through each commit and:
1. makes sure it has `AB#123` in the commit message
2. if yes, add a GitHub Pull Request link to the work item in Azure DevOps

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
