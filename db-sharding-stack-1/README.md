# DB sharding stack V1

## Run

```bash
```


## Sys Arch

```
                        [Client / Frontend (S3)]
                                |
                                v
                         [API Gateway (REST)]
                                |
                                v
                      [Lambda: Shard Manager]
                                |
                                |---> [DynamoDB: shard_metadata table]
                                |
            +-------------------+--------------------+
            |                                        |
     [RDS Shard 0]                            [RDS Shard 1]
     (e.g. users 0–4999)                    (e.g. users 5000–9999)
```

## Ref
- 

