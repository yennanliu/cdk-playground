# cdk-playground


## Prerequisite

- Install aws CLI
- Install node, npm
- Install aws-cdk
- Config aws CLI


## Run

```bash
#-----------------------------
# PART 1
#-----------------------------

# init project
cdk init sample-app --language typescript

# show all CDK
cdk list # or : cdk list --long

# (ONLY first time) install the bootstrap stack into an environment, save needed pkg in S3
cdk bootstrap

# Synthesizes and prints the CloudFormation : template for this stack 
cdk synth # or : cdk synthesize

# diff
cdk diff

# deploy
cdk deploy

# deploy
# which will assess whether a hotswap deployment can be performed instead of a CloudFormation deployment. If possible, the CDK CLI will use AWS service APIs to directly make the changes; otherwise it will fall back to performing a full CloudFormation deployment.
cdk deploy --hotswap

# sync
#  except that instead of being a one-shot operation, it monitors your code and assets for changes and attempts to perform a deployment automatically when a change is detected.
cdk watch

# destroy CDK
cdk destroy CdkWorkshopStack
```

## Ref
- https://github.com/aws-samples/aws-cdk-examples
- https://github.com/yennanliu/CDKPoc