# Welcome to your CDK TypeScript project

## Deploy

```bash

npm install

# compile TS lambda func code to JS
npx tsc -p tsconfig.lambda.json

cdk deploy
```


## Run

```bash

# test lamdba enpoint

curl https://wdq50vslg5.execute-api.ap-northeast-1.amazonaws.com/prod/timestamp


curl https://wdq50vslg5.execute-api.ap-northeast-1.amazonaws.com/prod/scrape-books
```

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
