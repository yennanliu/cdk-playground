# Route53 S3 Static Website

This project creates an AWS CDK stack that sets up a static website hosted on S3 and connected to a custom domain via Route53.

## Architecture

The stack includes:

1. An S3 bucket configured for static website hosting
2. A Route53 public hosted zone for your domain
3. An A record that points your domain to the S3 website

## Prerequisites

- AWS CLI installed and configured
- Node.js 14.x or later
- AWS CDK v2 installed globally (`npm install -g aws-cdk`)
- A domain name that you own (to set up in Route53)

## Installation

```bash
# Install dependencies
npm install
```

## Configuration

Update the stack configuration in `bin/route53-s3-site.ts`:

```typescript
new Route53S3SiteStack(app, 'Route53S3SiteStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  domainName: 'your-domain.com', // Replace with your actual domain
});
```

## Deployment

```bash
# Synthesize the CloudFormation template
cdk synth

# Deploy the stack
cdk deploy
```

## Important Notes

1. **DNS Configuration**: After deployment, you'll need to update your domain's name servers at your domain registrar to point to the name servers provided by the AWS Route53 hosted zone.

2. **S3 Website Content**: Upload your website files to the S3 bucket created by this stack. Sample files are provided in the `sample-website` directory.

3. **Cost Considerations**: This stack creates resources that may incur AWS charges:
   - Route53 Hosted Zone (~$0.50/month)
   - S3 Bucket (storage and request charges)

## Cleanup

To avoid incurring future charges, delete the stack when you're done:

```bash
cdk destroy
```

Note that this will not automatically delete the Route53 hosted zone, as it may be in use by other resources. You'll need to delete it manually from the AWS Management Console if desired.
