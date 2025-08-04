// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack, StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as destinations from 'aws-cdk-lib/aws-logs-destinations';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import { StackPropsExt } from './stack-composer';

export interface LambdaLogsProcessorStackProps extends StackPropsExt {
    readonly opensearchDomain: opensearch.Domain;
    readonly opensearchIndex: string;
    readonly logGroupName?: string;
}

export class LambdaLogsProcessorStack extends Stack {
    public readonly logProcessorFunction: lambda.Function;
    public readonly logGroup: logs.LogGroup;

    constructor(scope: Construct, id: string, props: LambdaLogsProcessorStackProps) {
        super(scope, id, props);

        // Create CloudWatch Log Group for testing
        this.logGroup = new logs.LogGroup(this, `${this.stackName}-TestLogGroup`, {
            logGroupName: props.logGroupName || `/aws/lambda/${this.stackName}-test-logs`,
            removalPolicy: RemovalPolicy.DESTROY,
            retention: logs.RetentionDays.ONE_WEEK,
        });

        // Create Lambda execution role
        const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: 'Role for Lambda to process CloudWatch logs and write to OpenSearch',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ]
        });

        // Add permissions to read CloudWatch Logs
        lambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
                'logs:DescribeLogGroups',
                'logs:DescribeLogStreams'
            ],
            resources: [`arn:aws:logs:${this.region}:${this.account}:*`]
        }));

        // Add permissions to write to OpenSearch
        lambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'es:*',
                'opensearch:*'
            ],
            resources: [
                props.opensearchDomain.domainArn,
                `${props.opensearchDomain.domainArn}/*`
            ]
        }));

        // Create Lambda function
        this.logProcessorFunction = new lambda.Function(this, 'LogProcessorFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('lambda/cloudwatch-logs-processor'),
            role: lambdaRole,
            timeout: Duration.minutes(5),
            memorySize: 256,
            environment: {
                OPENSEARCH_ENDPOINT: props.opensearchDomain.domainEndpoint,
                OPENSEARCH_INDEX: props.opensearchIndex,
                AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1'
            },
            description: 'Processes CloudWatch logs and sends them to OpenSearch'
        });

        // Create subscription filter to connect CloudWatch Logs to Lambda
        new logs.SubscriptionFilter(this, 'LogSubscriptionFilter', {
            logGroup: this.logGroup,
            destination: new destinations.LambdaDestination(this.logProcessorFunction),
            filterPattern: logs.FilterPattern.allEvents()
        });

        // Grant Lambda permission to be invoked by CloudWatch Logs
        this.logProcessorFunction.addPermission('AllowCloudWatchLogsInvoke', {
            principal: new iam.ServicePrincipal('logs.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: `arn:aws:logs:${this.region}:${this.account}:log-group:${this.logGroup.logGroupName}:*`
        });
    }
}