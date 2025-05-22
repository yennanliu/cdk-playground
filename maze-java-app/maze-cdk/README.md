# Welcome to your CDK TypeScript project

## CMD

```bash

# build docker img
cd maze-be-1

sudo docker build -t maze-be-1:latest .

# push
sudo docker tag maze-be-1:latest yennanliu/maze-app:latest

sudo docker push yennanliu/maze-app:latest

# (for debug) (pull remote docker img and run)
sudo docker run --rm -it -p 8080:8080 yennanliu/maze-app:latest

# clean
sudo docker rmi -f $(sudo docker images -q)


# cdk
npm install

cdk bootstrap

cdk deploy
```

You should explore the contents of this project. It demonstrates a CDK app with an instance of a stack (`MazeCdkStack`)
which contains an Amazon SQS queue that is subscribed to an Amazon SNS topic.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
