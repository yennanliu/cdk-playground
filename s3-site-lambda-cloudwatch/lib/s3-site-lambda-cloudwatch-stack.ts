import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as path from 'path';
import { Construct } from 'constructs';

export interface S3SiteLambdaCloudwatchStackProps extends StackProps {
  alarmEmail?: string;
}

export class S3SiteLambdaCloudwatchStack extends Stack {
  constructor(scope: Construct, id: string, props?: S3SiteLambdaCloudwatchStackProps) {
    super(scope, id, props);

    // Create an S3 bucket to host the website
    const websiteBucket = new s3.Bucket(this, 'GameWebsiteBucket', {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html',
      publicReadAccess: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Create a Lambda function to handle game API requests
    const gameFunction = new lambda.Function(this, 'GameFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: Duration.seconds(10),
      environment: {
        LOG_LEVEL: 'INFO',
      },
    });

    // Add custom CloudWatch metrics permissions to Lambda
    gameFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );

    // Create API Gateway to expose the Lambda function
    const api = new apigateway.LambdaRestApi(this, 'GameApi', {
      handler: gameFunction,
      proxy: false,
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
    });

    // Add a resource and method for the game API
    const gameResource = api.root.addResource('game');
    gameResource.addMethod('POST');
    
    // Add CORS support
    gameResource.addCorsPreflight({
      allowOrigins: ['*'],
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
    });

    // Deploy the website files to S3
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../frontend'))],
      destinationBucket: websiteBucket,
    });

    // Create CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'GameDashboard', {
      dashboardName: 'GameMetricsDashboard',
    });

    // Add widgets to the dashboard
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Requests',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Count',
            dimensionsMap: {
              ApiName: api.restApiName,
              Stage: 'prod',
            },
            statistic: 'Sum',
            period: Duration.minutes(1),
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'API Latency',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Latency',
            dimensionsMap: {
              ApiName: api.restApiName,
              Stage: 'prod',
            },
            statistic: 'Average',
            period: Duration.minutes(1),
          }),
        ],
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Errors',
            dimensionsMap: {
              FunctionName: gameFunction.functionName,
            },
            statistic: 'Sum',
            period: Duration.minutes(1),
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'Custom Game Metrics',
        left: [
          new cloudwatch.Metric({
            namespace: 'GameMetrics',
            metricName: 'ValidAttempts',
            statistic: 'Sum',
            period: Duration.minutes(1),
          }),
          new cloudwatch.Metric({
            namespace: 'GameMetrics',
            metricName: 'InvalidAttempts',
            statistic: 'Sum',
            period: Duration.minutes(1),
          }),
        ],
      })
    );

    // Create an SNS topic for alarms (if email is provided)
    if (props?.alarmEmail) {
      const alarmTopic = new sns.Topic(this, 'GameAlarmTopic');
      alarmTopic.addSubscription(
        new subscriptions.EmailSubscription(props.alarmEmail)
      );

      // Create an alarm for high error rates
      const errorAlarm = new cloudwatch.Alarm(this, 'HighErrorRateAlarm', {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Errors',
          dimensionsMap: {
            FunctionName: gameFunction.functionName,
          },
          statistic: 'Sum',
          period: Duration.minutes(1),
        }),
        threshold: 5,
        evaluationPeriods: 1,
        alarmDescription: 'Alarm if the error rate is too high',
      });

      errorAlarm.addAlarmAction(new cloudwatch.SnsAction(alarmTopic));
    }

    // Output the website URL and API endpoint
    new CfnOutput(this, 'WebsiteURL', {
      value: websiteBucket.bucketWebsiteUrl,
      description: 'URL for the game website',
    });

    new CfnOutput(this, 'ApiEndpoint', {
      value: `${api.url}game`,
      description: 'URL for the game API',
    });
  }
}
