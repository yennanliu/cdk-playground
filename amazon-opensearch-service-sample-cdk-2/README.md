# OpenSearch Service Domain CDK

This repo contains an IaC CDK solution for deploying an OpenSearch Service Domain. Users have the ability to easily deploy their Domain using default values or provide [configuration options](#Configuration-Options) for a more customized setup. The goal of this repo is not to become a one-size-fits-all solution for users. Supporting this would be unrealistic, and likely conflicting at times, when considering the needs of many users. Rather this code base should be viewed as a starting point for users to use and add to individually as their custom use case requires.

### Run

- Deploy

```bash
npm install

export CDK_DEPLOYMENT_STAGE=dev

cdk bootstrap

# OPENSEARCH_2_15
# NOTE !! use the new `domainName` in every CDK deploy
# TODO: fix above since we should ONLY update the same domain if one is existed 

export CDK_DEPLOYMENT_STAGE=dev


cdk deploy "*" --c domainName="os-service-domain-29" --c dataNodeType="r6g.large.search" --c dataNodeCount=1
```

-  Test opensearch

- Create index

```bash
# create `cloudwatch-logs` idnex
PUT /cloudwatch-logs
{
  "mappings": {
    "properties": {
      "timestamp": {
        "type": "date"
      },
      "message": {
        "type": "text"
      }
    }
  }
}

# insert fake data
PUT /cloudwatch-logs/_doc/1
{
  "timestamp": "2025-08-02",
  "message": "Sample log: Application started successfully",
  "logStream": "app-logs",
  "logGroup": "/aws/application"
}


# get all exising indices
GET /_cat/indices?v


# query data under `cloudwatch-logs` index
GET /cloudwatch-logs/_search
{
  "size": 1000,
  "query": {
    "match_all": {}
  }
}
```

```bash

curl -XGET -u 'master-user:master-user-password' 'domain-endpoint/movies/_search?q=mars&pretty=true'

curl -XGET -u 'admin:i:ONo0nN9%JcdFzXe1Ga24_&ME?+7;$A' 'https://search-os-service-domain-5-zixlxqr2g42cvlyn5ca7c22ltu.ap-northeast-1.es.amazonaws.com/cloudwatch-logs/_search?q=mars&pretty=true'
```

### Getting Started

If this is your first time using CDK in this region, will need to `cdk bootstrap` to setup required CDK resources for deployment

Also ensure you have configured the desired [AWS credentials](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_prerequisites), as these will dictate the region and account used for deployment

A `CDK_DEPLOYMENT_STAGE` environment variable should also be set to assist in naming resources and preventing collisions. Typically, this would be set to values such as `dev`, `gamma`, `Wave1`, `PROD` and will be used to distinguish AWS resources for a given region and deployment stage. For example the CloudFormation stack may be named like `OSServiceDomain-dev-us-east-1`. This stage environment variable should only be used for the disambiguation of user resources.

### Deploying your CDK
Before deploying your CDK you should fill in any desired context parameters that will dictate the composition of your OpenSearch Service Domain

This can be accomplished by providing these options in a `cdk.context.json` file

As well as by passing the context options you want to change as options in the CDK CLI
```
cdk deploy "*" --c domainName="os-service-domain" --c engineVersion="OS_1_3_6" --c dataNodeType="r6g.large.search" --c dataNodeCount=1
```
* Note that these context parameters can also be passed to `cdk synth` and `cdk bootstrap` commands to simulate similar scenarios

Depending on your use-case, you may choose to provide options from both the `cdk.context.json` and the CDK CLI, in which case it is important to know the precedence level for context values. The below order shows these levels with values being passed by the CDK CLI having the most importance
1. CDK CLI passed context values (highest precedence)
2. Created `cdk.context.json` in the same directory as this README
3. Existing `default-values.json` in the same directory as this README

##### Default Values
These values are presets configured by this CDK, typically to enable foundational security mechanisms that most Domains should use and which may not be enabled in the default Domain [construct](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_opensearchservice.Domain.html). The list of these defaults can be found in the table below as well as in the `default-values.json` file in the same directory as this README.

### Stack Breakdown
This CDK has been structured to allow multiple stacks to be deployed out-of-the-box, which allows an easy entrance door for users to get started and add additional stacks as they need. Each of these stacks are deployed independently in CloudFormation, with only the Domain stack being required.

#### Domain Stack (OSServiceDomainCDKStack-STAGE-REGION)
This is the core required stack of this CDK which is responsible for deploying the OpenSearch Service Domain and associated resources such as CloudWatch log groups for Domain logging.

#### Network Stack (OSServiceNetworkCDKStack-STAGE-REGION)
This is an additional stack that will be used when the Domain is configured to be placed inside a VPC and will contain resources related to the networking of this VPC such as Security Groups and Subnets.


### Configuration Options

The available configuration options are listed below. The vast majority of these options do not need to be provided, with only `domainName` and `engineVersion` being required. All non-required options can be provided as an empty string `""` or simply not included, and in each of these cases the option will be allocated with the CDK Domain default value (assuming that a default value is not set for the option)

Users are encouraged to customize the deployment by changing the CDK TypeScript as needed. The configuration-by-context option that is depicted here is primarily provided for testing/development purposes, and users may find it easier to adjust the TS here rather than say wrangling a complex JSON object through a context option

Additional context on some of these options, can also be found in the Domain construct [documentation](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_opensearchservice.Domain.html)

**It should be noted that limited testing has been conducted solely in the us-east-1 region, and some items like instance-type examples might be biased**

| Name                                            | Required | Type         | Example                                                                                                                                                                                                                        | Default Value       | Description                                                                                                                                                                                                                                                  |
|-------------------------------------------------|----------|--------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------|:-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| engineVersion                                   | true     | string       | "OS_1.3"                                                                                                                                                                                                                       | "OS_2.5"            | The Elasticsearch/OpenSearch version that your domain will leverage. In the format of `OS_x.y` or `ES_x.y`                                                                                                                                                   |
| domainName                                      | true     | string       | "os-service-domain"                                                                                                                                                                                                            | "os-service-domain" | Name to use for the OpenSearch Service Domain                                                                                                                                                                                                                |
| dataNodeType                                    | false    | string       | "r6g.large.search"                                                                                                                                                                                                             |                     | The instance type for your data nodes. Supported values can be found [here](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/supported-instance-types.html)                                                                              |
| dataNodeCount                                   | false    | number       | 1                                                                                                                                                                                                                              |                     | The number of data nodes to use in the OpenSearch Service Domain                                                                                                                                                                                             |
| dedicatedManagerNodeType                        | false    | string       | "r6g.large.search"                                                                                                                                                                                                             |                     | The instance type for your manager nodes. Supported values can be found [here](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/supported-instance-types.html)                                                                           |
| dedicatedManagerNodeCount                       | false    | number       | 3                                                                                                                                                                                                                              |                     | The number of manager nodes to use in the OpenSearch Service Domain                                                                                                                                                                                          |
| warmNodeType                                    | false    | string       | "ultrawarm1.medium.search"                                                                                                                                                                                                     |                     | The instance type for your warm nodes. Supported values can be found [here](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/limits.html#limits-ultrawarm)                                                                               |
| warmNodeCount                                   | false    | number       | 3                                                                                                                                                                                                                              |                     | The number of warm nodes to use in the OpenSearch Service Domain                                                                                                                                                                                             |
| accessPolicies                                  | false    | JSON         | `{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam::123456789123:user/test-user"},"Action":"es:ESHttp*","Resource":"arn:aws:es:us-east-1:123456789123:domain/cdk-os-service-domain/*"}]}` |                     | Domain access policies                                                                                                                                                                                                                                       |
| useUnsignedBasicAuth                            | false    | boolean      | false                                                                                                                                                                                                                          | false               | Configures the domain so that unsigned basic auth is enabled                                                                                                                                                                                                 |
| fineGrainedManagerUserARN                       | false    | string       | `"arn:aws:iam::123456789123:user/test-user"`                                                                                                                                                                                   |                     | The IAM User ARN of the manager user. <br/>Fine grained access control also requires nodeToNodeEncryptionEnabled and encryptionAtRestEnabled to be enabled. <br/> Either fineGrainedMasterUserARN or fineGrainedMasterUserName can be enabled, but not both. |
| fineGrainedManagerUserName                      | false    | string       | "admin"                                                                                                                                                                                                                        |                     | Username for the manager user. Not needed if providing fineGrainedManagerUserARN                                                                                                                                                                             |
| fineGrainedManagerUser<br />SecretManagerKeyARN | false    | string       | `"arn:aws:secretsmanager:us-east-1:123456789123:secret:master-user-os-pass-123abc"`                                                                                                                                            |                     | Password for the manager user, in the form of an AWS Secrets Manager key                                                                                                                                                                                     |
| enforceHTTPS                                    | false    | boolean      | true                                                                                                                                                                                                                           | true                | Require that all traffic to the domain arrive over HTTPS                                                                                                                                                                                                     |
| tlsSecurityPolicy                               | false    | string       | "TLS_1_2"                                                                                                                                                                                                                      | "TLS_1_2"           | The minimum TLS version required for traffic to the domain                                                                                                                                                                                                   |
| ebsEnabled                                      | false    | boolean      | true                                                                                                                                                                                                                           |                     | Specify whether Amazon EBS volumes are attached to data nodes. Some instance types (i.e. r6gd) require that EBS be disabled                                                                                                                                  |
| ebsIops                                         | false    | number       | 4000                                                                                                                                                                                                                           |                     | The number of I/O operations per second (IOPS) that the volume supports                                                                                                                                                                                      |
| ebsVolumeSize                                   | false    | number       | 15                                                                                                                                                                                                                             |                     | The size (in GiB) of the EBS volume for each data node                                                                                                                                                                                                       |
| ebsVolumeType                                   | false    | string       | "GP3"                                                                                                                                                                                                                          |                     | The EBS volume type to use with the Amazon OpenSearch Service domain. Supported values can be found [here](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.EbsDeviceVolumeType.html)                                                         |
| encryptionAtRestEnabled                         | false    | boolean      | true                                                                                                                                                                                                                           | true                | Enable Domain to encrypt data at rest                                                                                                                                                                                                                        |
| encryptionAtRestKmsKeyARN                       | false    | string       | `"arn:aws:kms:us-east-1:123456789123:key/abc123de-4888-4fa7-a508-3811e2d49fc3"`                                                                                                                                                |                     | Supply the KMS key to use for encryption at rest. If encryptionAtRestEnabled is enabled and this value is not provided, the default KMS key for OpenSearch Service will be used                                                                              |
| loggingAppLogEnabled                            | false    | boolean      | true                                                                                                                                                                                                                           |                     | Specify if Amazon OpenSearch Service application logging should be set up                                                                                                                                                                                    |
| loggingAppLogGroupARN                           | false    | string       | `"arn:aws:logs:us-east-1:123456789123:log-group:test-log-group:*"`                                                                                                                                                             |                     | Supply the CloudWatch log group to use for application logging. If not provided and application logs are enabled, a CloudWatch log group will be created                                                                                                     |
| loggingAuditLogEnabled                          | false    | boolean      | true                                                                                                                                                                                                                           |                     | Specify if Amazon OpenSearch Service audit logging should be set up. Requires fine-grained access control to be used.                                                                                                                                        |
| loggingAuditLogGroupARN                         | false    | string       | `"arn:aws:logs:us-east-1:123456789123:log-group:test-log-group:*"`                                                                                                                                                             |                     | Supply the CloudWatch log group to use for audit logging. If not provided and audit logs are enabled, a CloudWatch log group will be created                                                                                                                 |
| nodeToNodeEncryptionEnabled                     | false    | boolean      | true                                                                                                                                                                                                                           | true                | Specify if node to node encryption should be enabled                                                                                                                                                                                                         |
| vpcEnabled                                      | false    | boolean      | true                                                                                                                                                                                                                           |                     | Enable Domain to be placed inside of a VPC. If a `vpcId` is not provided a new VPC will be created                                                                                                                                                           |
| vpcId                                           | false    | string       | "vpc-123456789abcdefgh"                                                                                                                                                                                                        |                     | Specify an existing VPC to place the domain inside of                                                                                                                                                                                                        |
| vpcSubnetIds                                    | false    | string array | ["subnet-123456789abcdefgh", "subnet-223456789abcdefgh"]                                                                                                                                                                       |                     | Specify the subnet IDs of an existing VPC to place the Domain in. Requires `vpcId` to be specified                                                                                                                                                           |
| vpcSecurityGroupIds                             | false    | string array | ["sg-123456789abcdefgh", "sg-223456789abcdefgh"]                                                                                                                                                                               |                     | Specify the Security Groups that will be associated with the VPC endpoints for the Domain. Requires `vpcId` to be specified                                                                                                                                  |
| availabilityZoneCount                           | false    | number       | 1                                                                                                                                                                                                                              |                     | The number of Availability Zones for the Domain to use. If not specified a single AZ is used. If specified the Domain CDK construct requires at least 2 AZs                                                                                                  |
| openAccessPolicyEnabled                         | false    | boolean      | false                                                                                                                                                                                                                          |                     | Applies an open access policy to the Domain. **NOTE**: This setting should only be used for Domains placed within a VPC, and is applicable to many use cases where access controlled by Security Groups on the VPC is sufficient.                            |
| domainRemovalPolicy                             | false    | string       | "RETAIN"                                                                                                                                                                                                                       |                     | Policy to apply when the domain is removed from the CloudFormation stack                                                                                                                                                                                     |


A template `cdk.context.json` to be used to fill in these values is below:
```
{
  "engineVersion": "",
  "domainName": "",
  "dataNodeType": "",
  "dataNodeCount": "",
  "dedicatedManagerNodeType": "",
  "dedicatedManagerNodeCount": "",
  "warmNodeType": "",
  "warmNodeCount": "",
  "accessPolicies": "",
  "useUnsignedBasicAuth": "",
  "fineGrainedManagerUserARN": "",
  "fineGrainedManagerUserName": "",
  "fineGrainedManagerUserSecretManagerKeyARN": "",
  "enforceHTTPS": "",
  "tlsSecurityPolicy": "",
  "ebsEnabled": "",
  "ebsIops": "",
  "ebsVolumeSize": "",
  "ebsVolumeType": "",
  "encryptionAtRestEnabled": "",
  "encryptionAtRestKmsKeyARN": "",
  "loggingAppLogEnabled": "",
  "loggingAppLogGroupARN": "",
  "loggingAuditLogEnabled": "",
  "loggingAuditLogGroupARN": "",
  "nodeToNodeEncryptionEnabled": "",
  "vpcEnabled": "",
  "vpcId": "",
  "vpcSubnetIds": "",
  "vpcSecurityGroupIds": "",
  "availabilityZoneCount": "",
  "openAccessPolicyEnabled": "",
  "domainRemovalPolicy": ""
}

```
Some configuration options available in other solutions (listed below) which enable/disable specific features do not exist in the current native CDK Domain construct. These options are inferred based on the presence or absence of related fields (i.e. if dedicatedMasterNodeCount is set to 1 it is inferred that dedicated master nodes should be enabled). These options are normally disabled by default, allowing for this inference.
```
"dedicatedMasterNodeEnabled": "X",
"warmNodeEnabled": "X",
"fineGrainedAccessControlEnabled": "X",
"internalUserDatabaseEnabled": "X"
```

### Tearing down CDK
To remove all the CDK stack(s) which get created during deployment we can execute
```
cdk destroy "*"
```
Or to remove an individual stack we can execute
```
cdk destroy opensearchDomainStack
```
Note that the default retention policy for the OpenSearch Domain is to RETAIN this resource when the stack is deleted, and in order to delete the Domain on stack deletion the `domainRemovalPolicy` would need to be set to `DESTROY`. Otherwise, the Domain can be manually deleted through the AWS console or through other means such as the AWS CLI.

### Useful CDK commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk ls`          list all stacks in the app
* `cdk deploy "*"`  deploy all stacks to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
