# Superset Stack V3

- Build with `3` different nodes
- metadata is split and saved in the seperated DB, so this design works

## Arch

```
                       +-----------------------+
                       |    Route53 (DNS)      |
                       +----------+------------+
                                  |
                         +--------v--------+
                         |    ALB (HTTPS)   |
                         +--------+--------+
                                  |
                    +-------------+--------------+
                    |                            |
          +---------v--------+        +----------v--------+
          | Superset Web App |        | Superset Web App  |
          |   (Fargate)      |        |   (Fargate)       |
          +------------------+        +-------------------+
                    |
         +----------v-----------+
         | Amazon RDS (Postgres)|
         +----------------------+
```

## Run

```bash

npm install --save-dev @types/aws-lambda

npm install

cdk bootstrap

# 1st deploy
cdk deploy
```