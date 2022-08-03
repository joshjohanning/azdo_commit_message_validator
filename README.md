# azdo_commit_message_validator

This is an action to be ran in a pull request to make sure that all commits have a `AB#123` in the commit message.

<img width="1033" alt="image" src="https://user-images.githubusercontent.com/19912012/182519049-3bd1281d-985c-41ea-b35c-c3cd35994d48.png">

It also automatically links pull request to all of the Azure DevOps work item(s).

<img width="290" alt="image" src="https://user-images.githubusercontent.com/19912012/182518941-4c7d5bad-b19f-456a-b3bd-504b3ab2f45d.png">

## Setup

1. Create a repository secret titled `AZURE_DEVOPS_PAT`
2. Update the org name in the `action.yml` file under `env`
