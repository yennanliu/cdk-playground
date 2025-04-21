import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import { Construct } from 'constructs';

export interface Route53S3SiteStackProps extends StackProps {
  domainName?: string;
}

export class Route53S3SiteStack extends Stack {
  constructor(scope: Construct, id: string, props?: Route53S3SiteStackProps) {
    super(scope, id, props);

    //const domainName = props?.domainName || 'example.com';
    const domainName = props?.domainName || 'yen.dev.com';

    // Create an S3 bucket for static website hosting
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: domainName,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html',
      publicReadAccess: true,
      blockPublicAccess: {
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false
      },
      removalPolicy: props?.env?.account === 'production' ? undefined : RemovalPolicy.DESTROY,
      autoDeleteObjects: props?.env?.account === 'production' ? false : true,
    });

    // Deploy website content to the S3 bucket
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', 'sample-website'))],
      destinationBucket: websiteBucket,
      retainOnDelete: false,
    });

    // Create a Route53 hosted zone for the domain
    const hostedZone = new route53.PublicHostedZone(this, 'HostedZone', {
      zoneName: domainName
    });

    // Create an A record to point the domain to the S3 website
    new route53.ARecord(this, 'SiteAliasRecord', {
      zone: hostedZone,
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(new targets.BucketWebsiteTarget(websiteBucket))
    });

    // Output values
    new CfnOutput(this, 'WebsiteURL', {
      value: websiteBucket.bucketWebsiteUrl,
      description: 'The URL of the website'
    });

    new CfnOutput(this, 'BucketName', {
      value: websiteBucket.bucketName,
      description: 'The name of the S3 bucket'
    });

    new CfnOutput(this, 'DomainName', {
      value: domainName,
      description: 'The domain name for the website'
    });
  }
}
