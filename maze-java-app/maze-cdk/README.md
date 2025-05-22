# Welcome to your CDK TypeScript project

## CMD

```bash

# build docker img
cd maze-be-1

docker build -t maze-be-1:latest .

# push
docker tag maze-be-1:latest yennanliu/maze-app:latest

docker push yennanliu/maze-app:latest

# (for debug) (pull remote docker img and run)
docker run --rm -it -p 8080:8080 yennanliu/maze-app:latest


# clean
docker rmi -f $(sudo docker images -q)


# cdk
npm install

cdk bootstrap

cdk deploy
```


## Ref

- https://hub.docker.com/r/yennanliu/maze-app/tags
