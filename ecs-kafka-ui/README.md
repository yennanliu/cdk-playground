# Kafka UI on AWS ECS

This project deploys the [Kafka UI](https://github.com/provectus/kafka-ui) web interface as a containerized application on AWS ECS using AWS CDK.

## Architecture

This CDK application creates:
- A VPC with public and private subnets
- An ECS cluster using Fargate (serverless)
- A Fargate service running the Kafka UI container
- An Application Load Balancer to expose the service
- Relevant security groups and IAM roles
- CloudWatch Logs for container logs

The implementation uses the official Docker image `provectuslabs/kafka-ui` from Provectus.

## Prerequisites

- Node.js 14.x or later
- AWS CLI configured with appropriate credentials
- AWS CDK installed (`npm install -g aws-cdk`)

## Deployment

1. Install dependencies:
   ```
   npm install
   ```

2. Build the TypeScript code:
   ```
   npm run build
   ```

3. Bootstrap your AWS environment (if you haven't already):
   ```
   cdk bootstrap
   ```

4. Deploy the stack:
   ```
   cdk deploy
   ```
   
   Or deploy a specific stack:
   ```
   cdk deploy EcsKafkaUiDemoStack
   ```

5. After deployment, the CDK will output the URL for accessing the Kafka UI service.

## Configuration

The CDK app supports two modes:

### 1. Demo Mode (Default)

By default, the app is deployed with demo mode enabled (`DYNAMIC_CONFIG_ENABLED=true`), allowing you to configure Kafka clusters through the UI.

### 2. Predefined Clusters Mode

You can also deploy with predefined Kafka clusters by uncommenting and modifying the example in the `bin/ecs-kafka-ui.ts` file:

```typescript
new EcsKafkaUiStack(app, 'EcsKafkaUiProdStack', {
  dynamicConfigEnabled: false,
  kafkaClusters: [
    {
      name: 'production-cluster',
      bootstrapServers: 'kafka-broker1:9092,kafka-broker2:9092,kafka-broker3:9092',
      schemaRegistry: 'http://schema-registry:8081',
      properties: {
        securityProtocol: 'SASL_SSL',
        saslMechanism: 'PLAIN',
      },
    },
    {
      name: 'staging-cluster',
      bootstrapServers: 'kafka-staging:9092',
    },
  ],
});
```

### Available Configuration Options

The `EcsKafkaUiStack` accepts the following properties:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| kafkaClusters | KafkaCluster[] | [] | Kafka clusters to connect to |
| dynamicConfigEnabled | boolean | true | Whether to enable dynamic configuration through UI |
| imageName | string | 'provectuslabs/kafka-ui:latest' | Docker image to use |
| desiredCount | number | 1 | Number of ECS tasks |
| memoryLimitMiB | number | 1024 | Memory limit in MiB |
| cpu | number | 512 | CPU units |

#### KafkaCluster Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| name | string | Yes | Name of the cluster |
| bootstrapServers | string | Yes | Comma-separated list of bootstrap servers |
| schemaRegistry | string | No | Schema registry URL |
| properties | Record<string, string> | No | Additional Kafka properties |

## Security Considerations

For production deployments, consider:

1. Restricting access to the Kafka UI by configuring security groups
2. Setting up authentication (OAUTH, LDAP) - see Kafka UI documentation
3. Using HTTPS with the load balancer

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
