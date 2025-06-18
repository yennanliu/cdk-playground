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

sudo docker build -t mydjangoapp .

sudo docker run -p 8080:8080 mydjangoapp


# map internal 8080 port to external 8081 port
sudo docker run -p 8081:8080 mydjangoapp




# deploy to docker hub
sudo docker  tag  mydjangoapp:latest  yennanliu/mydjangoapp:dev-1

sudo docker  push  yennanliu/mydjangoapp:dev-1
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