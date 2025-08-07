# Opensearch Stack 1

## Run

```bash

npm install

cdk bootstrap

# deploy

cdk deploy --all

cdk deploy --all --stage dev

cdk deploy --all --stage dev \
    --context podLogGroupName="/aws/eks/EksCluster3394B24C-ed22b92ec4764ec592ea533328f9e9da/application"
"
```