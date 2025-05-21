import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import * as path from 'path';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as fs from 'fs';

export class MazeTest2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create an S3 bucket for website hosting
    const websiteBucket = new s3.Bucket(this, 'MazeWebsiteBucket', {
      websiteIndexDocument: 'index.html',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      removalPolicy: RemovalPolicy.DESTROY, // For development purposes
      autoDeleteObjects: true, // For development purposes
    });

    // Add bucket policy to allow public read access
    websiteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [websiteBucket.arnForObjects('*')],
        principals: [new iam.AnyPrincipal()],
      })
    );

    // Create Lambda function
    const mazeHandler = new lambda.Function(this, 'MazeHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'maze-handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda'), {
        bundling: {
          image: lambda.Runtime.NODEJS_18_X.bundlingImage,
          local: {
            tryBundle(outputDir: string) {
              try {
                // Run TypeScript compiler
                require('child_process').execSync('npx tsc', {
                  cwd: path.join(__dirname, '../lambda'),
                  stdio: 'inherit'
                });

                // Copy compiled files and package.json
                fs.copyFileSync(
                  path.join(__dirname, '../lambda/package.json'),
                  path.join(outputDir, 'package.json')
                );
                fs.cpSync(
                  path.join(__dirname, '../lambda/dist'),
                  outputDir,
                  { recursive: true }
                );

                // Install production dependencies
                require('child_process').execSync('npm install --production', {
                  cwd: outputDir,
                  stdio: 'inherit'
                });

                return true;
              } catch (error) {
                console.error('Local bundling failed:', error);
                return false;
              }
            }
          }
        }
      }),
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

    // Create API Gateway
    const api = new apigateway.RestApi(this, 'MazeApi', {
      restApiName: 'Maze Service',
      description: 'This service handles maze generation and solving.',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    const mazeResource = api.root.addResource('maze');
    mazeResource.addMethod('POST', new apigateway.LambdaIntegration(mazeHandler));

    // Deploy the website files to the S3 bucket
    new s3deploy.BucketDeployment(this, 'DeployMazeWebsite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../maze'))],
      destinationBucket: websiteBucket,
    });

    // Output the website URL and API endpoint
    new CfnOutput(this, 'WebsiteURL', {
      value: websiteBucket.bucketWebsiteUrl,
      description: 'The URL of the website',
    });

    new CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'The URL of the API Gateway endpoint',
    });
  }
}
