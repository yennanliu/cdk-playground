import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StorageStack } from './storage-stack';
import { ApiStack } from './api-stack';

export class ImgRecogApp1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create storage stack
    const storageStack = new StorageStack(this, 'StorageStack');

    // Create API stack
    const apiStack = new ApiStack(this, 'ApiStack', {
      imageBucket: storageStack.imageBucket,
      resultsTable: storageStack.resultsTable,
    });

    // Outputs
    new CfnOutput(this, 'ApiEndpoint', {
      value: apiStack.api.url,
      description: 'API Gateway endpoint URL',
    });

    new CfnOutput(this, 'ImageBucketName', {
      value: storageStack.imageBucket.bucketName,
      description: 'S3 bucket name for images',
    });

    new CfnOutput(this, 'ResultsTableName', {
      value: storageStack.resultsTable.tableName,
      description: 'DynamoDB table name for results',
    });
  }
}
