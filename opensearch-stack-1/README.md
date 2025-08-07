# Opensearch Stack 1

## Run

```bash

npm install

cdk bootstrap

# deploy

cdk deploy --all

# use default eks, pod cloudwatch log group
cdk deploy --all --stage dev

# send pods cloudwatch log to opensearch ONLY
cdk deploy --all --stage dev \
    -c podLogGroupName="/aws/eks/EksCluster3394B24C-ed22b92ec4764ec592ea533328f9e9da/application"


# send both eks, pods cloudwatch log to opensearch
cdk deploy --all --stage dev \
    -c domainName="opensearch-domain-dev-2" \
    -c eksLogGroupName="/aws/eks/EksCluster3394B24C-ed22b92ec4764ec592ea533328f9e9da/cluster" \
    -c podLogGroupName="/aws/eks/EksCluster3394B24C-ed22b92ec4764ec592ea533328f9e9da/application"


```

