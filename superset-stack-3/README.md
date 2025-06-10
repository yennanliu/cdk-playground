# Superset Stack V3

- Multiple Superset instances
- split DB infra to the other stack
- other optimization

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