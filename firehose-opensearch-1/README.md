# Firehose OpenSearch CDK Project

This project creates a modular AWS CDK application that sets up a Kinesis Firehose delivery stream to Amazon OpenSearch Service, based on the structure from [amazon-opensearch-service-sample-cdk-2](https://github.com/yennanliu/cdk-playground/tree/main/amazon-opensearch-service-sample-cdk-2).

## Architecture

The project implements a modular CDK architecture with the following components:

```
📁 lib/
├── 📁 constructs/
│   ├── 📄 opensearch.ts     # OpenSearch domain configuration
│   ├── 📄 firehose.ts       # Kinesis Firehose delivery stream
│   ├── 📄 network.ts        # VPC and networking resources
│   └── 📄 iam.ts           # IAM roles and policies
└── 📄 firehose-opensearch-1-stack.ts  # Main stack orchestration
```

## Components

### 🔍 OpenSearch Construct (`lib/constructs/opensearch.ts`)
- Configures Amazon OpenSearch Service domain
- Supports both VPC and public deployment modes
- Includes security settings, encryption, and fine-grained access control
- Provides helper methods for granting access

### 🚀 Firehose Construct (`lib/constructs/firehose.ts`)
- Sets up Kinesis Firehose delivery stream
- Configures delivery to OpenSearch with backup to S3
- Includes CloudWatch logging and error handling
- Configurable buffering and retry settings

### 🌐 Network Construct (`lib/constructs/network.ts`)
- Creates VPC with public and private subnets
- Sets up security groups for OpenSearch and Firehose
- Configures VPC endpoints for AWS services
- Optional - only created when VPC mode is enabled

### 🔐 IAM Construct (`lib/constructs/iam.ts`)
- Creates roles for data producers and consumers
- Sets up OpenSearch admin role
- Provides cross-account access policies
- Includes CloudWatch permissions for monitoring

## Configuration

### Context Configuration (`cdk.context.json`)

```json
{
  "domainName": "my-opensearch-domain",
  "deliveryStreamName": "my-firehose-stream", 
  "indexName": "application-logs",
  "enableVpc": false,
  "environment": "dev",
  "owner": "data-team",
  "removalPolicy": "DESTROY"
}
```

### Environment Variables

```bash
export CDK_DEFAULT_ACCOUNT="123456789012"
export CDK_DEFAULT_REGION="us-east-1"
```

## Deployment

### Prerequisites
- AWS CLI configured with appropriate permissions
- Node.js and npm installed
- AWS CDK CLI installed: `npm install -g aws-cdk`

### Deploy the stack

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Bootstrap CDK (first time only):**
   ```bash
   cdk bootstrap
   ```

3. **Deploy with default settings:**
   ```bash
   cdk deploy
   ```

4. **Deploy with custom configuration:**
   ```bash
   cdk deploy --context domainName=my-custom-domain \
              --context enableVpc=true \
              --context environment=prod
   ```

5. **Deploy with VPC enabled:**
   ```bash
   cdk deploy --context enableVpc=true
   ```

### Deployment Examples

#### Basic deployment (no VPC):
```bash
cdk deploy FirehoseOpensearch1Stack
```

#### Production deployment with VPC:
```bash
cdk deploy --context enableVpc=true \
           --context environment=prod \
           --context removalPolicy=RETAIN \
           --context domainName=prod-search-domain
```

#### Development deployment:
```bash
cdk deploy --context enableVpc=false \
           --context environment=dev \
           --context indexName=dev-logs
```

## Usage

### Sending Data to Firehose

After deployment, you can send data to the Firehose delivery stream:

```javascript
// Using AWS SDK v3
import { FirehoseClient, PutRecordCommand } from "@aws-sdk/client-firehose";

const client = new FirehoseClient({ region: "us-east-1" });

const command = new PutRecordCommand({
  DeliveryStreamName: "firehose-opensearch-stream",
  Record: {
    Data: JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      message: "Application log message",
      service: "my-app"
    })
  }
});

await client.send(command);
```

### Accessing OpenSearch

1. **Get the domain endpoint from CDK outputs:**
   ```bash
   aws cloudformation describe-stacks \
     --stack-name FirehoseOpensearch1Stack \
     --query 'Stacks[0].Outputs[?OutputKey==`OpenSearchDomainEndpoint`].OutputValue' \
     --output text
   ```

2. **Access OpenSearch Dashboards:**
   ```
   https://<domain-endpoint>/_dashboards/
   ```

### IAM Roles

The stack creates several IAM roles:

- **DataProducerRole**: For applications sending data to Firehose
- **DataConsumerRole**: For applications reading from OpenSearch  
- **OpenSearchAdminRole**: For administrative access to OpenSearch

## Monitoring

### CloudWatch Logs
- Firehose delivery logs: `/aws/kinesisfirehose/<stream-name>`
- OpenSearch logs: Available in CloudWatch

### CloudWatch Metrics
- Firehose delivery metrics
- OpenSearch cluster metrics
- S3 backup metrics

## Security Features

- **Encryption**: Data encrypted in transit and at rest
- **Fine-grained access control**: OpenSearch FGAC enabled
- **VPC isolation**: Optional VPC deployment
- **IAM policies**: Least privilege access
- **Security groups**: Network-level security

## Cost Optimization

- **S3 backup**: Compressed backup with lifecycle policies
- **OpenSearch**: Right-sized instances with zone awareness
- **VPC endpoints**: Reduce NAT gateway costs when using VPC
- **Removal policy**: DESTROY by default for cost savings in dev

## Troubleshooting

### Common Issues

1. **OpenSearch domain creation fails**:
   - Check service limits
   - Verify instance types are available in your region

2. **Firehose delivery fails**:
   - Check IAM permissions
   - Verify OpenSearch domain accessibility
   - Review CloudWatch logs

3. **VPC deployment issues**:
   - Ensure sufficient IP addresses
   - Check subnet configuration

### Useful Commands

```bash
# View stack resources
cdk list

# Show differences
cdk diff

# Synthesize CloudFormation template
cdk synth

# Destroy stack
cdk destroy
```

## Customization

### Adding Custom Constructs

1. Create new construct in `lib/constructs/`
2. Import and use in the main stack
3. Add configuration options to the stack props

### Example: Adding Lambda Processor

```typescript
// lib/constructs/lambda-processor.ts
export class LambdaProcessorConstruct extends Construct {
  // Implementation
}

// lib/firehose-opensearch-1-stack.ts
import { LambdaProcessorConstruct } from './constructs/lambda-processor';

// In constructor:
const processor = new LambdaProcessorConstruct(this, 'Processor', {
  // configuration
});
```

## Contributing

1. Follow the modular structure established
2. Add proper TypeScript types
3. Include comprehensive error handling
4. Update documentation for new features
5. Test in both VPC and non-VPC modes

## References

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/)
- [Amazon Kinesis Data Firehose](https://docs.aws.amazon.com/firehose/)
- [Reference Project](https://github.com/yennanliu/cdk-playground/tree/main/amazon-opensearch-service-sample-cdk-2)