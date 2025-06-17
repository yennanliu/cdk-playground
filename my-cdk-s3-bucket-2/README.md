# My S3 Bucket V2

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

url=https://xx5twhl26j.execute-api.ap-northeast-1.amazonaws.com/prod/


curl $url/timestamp

curl $url/scrape-books

curl $url/math

#curl  https://xx5twhl26j.execute-api.ap-northeast-1.amazonaws.com/prod/timestamp
```

## Ref