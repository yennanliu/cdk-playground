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

docker build -t mydjangoapp .

docker run -p 8080:8080 mydjangoapp
```