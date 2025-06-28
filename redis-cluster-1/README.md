# Redis cluster stack -1 

## Run

### CDK

```bash

# cdk

npm install 

cdk bootstrap

cdk deploy
```

### Django app

```bash

cd redis-cluster-1/app

bash bootstrap_django.sh
```

### Docker 

```bash

# compatible version for both mac and AWS ECS cluster

docker buildx build --platform linux/amd64 -t mydjangoapp:latest --load .

#docker buildx build --platform linux/amd64 -t mydjangoapp .


sudo docker build -t mydjangoapp .

sudo docker run -p 80:80 mydjangoapp

# map internal 8080 port to external 8081 port
sudo docker run -p 81:80 mydjangoapp




# deploy to docker hub
sudo docker  tag  mydjangoapp:latest  yennanliu/mydjangoapp:dev-3

sudo docker  push  yennanliu/mydjangoapp:dev-3


# run push docker at local as test
docker run -d -p 80:80 yennanliu/mydjangoapp:dev-3
```

## Cmd

```bash

# docker remove instance, img

sudo docker stop $(docker ps -q) 2>/dev/null
sudo docker rm $(docker ps -a -q) 2>/dev/null

sudo docker rmi -f $(docker images -q) 2>/dev/null

```


## Ref

- https://hub.docker.com/r/yennanliu/mydjangoapp