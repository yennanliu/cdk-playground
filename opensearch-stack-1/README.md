# Opensearch Stack 1

## Run

```bash

npm install

cdk bootstrap

# deploy

cdk deploy --all

cdk deploy --all --stage dev

cdk deploy --all --stage dev \
    --context podLogGroupName="/aws/eks/EksCluster3394B24C-ec2cbedced464f24bf3f9d1c4b112048/application"
```