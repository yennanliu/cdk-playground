# Git Bucket with ECS - V1

- a simplest stack run git bucket at AWS
- no file system setting (save inside docker container)
- no DB (save in default h2 DB)
- small instance, resources
- as init POC

## Build

```bash

npm install

cdk bootstrap

cdk deploy
```

## Run

- default login credentials for GitBucket:

- Username: root
- Password: root
