import { Stack, StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { StackPropsExt } from '../stack-composer';

export interface ServiceApiStackProps extends StackPropsExt {
    readonly serviceRegistry: dynamodb.Table;
    readonly onboardingQueue: sqs.Queue;
    readonly opensearchDomainName: string;
}

export class ServiceApiStack extends Stack {
    public readonly api: apigateway.RestApi;
    public readonly apiHandler: lambda.Function;
    
    constructor(scope: Construct, id: string, props: ServiceApiStackProps) {
        super(scope, id, props);

        // Create API Lambda function
        this.apiHandler = new lambda.Function(this, 'ServiceApiHandler', {
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'service_api.handler',
            code: lambda.Code.fromAsset('lambda/service-api'),
            timeout: Duration.minutes(5),
            memorySize: 512,
            environment: {
                SERVICE_REGISTRY_TABLE: props.serviceRegistry.tableName,
                ONBOARDING_QUEUE_URL: props.onboardingQueue.queueUrl,
                STAGE: props.stage,
                OPENSEARCH_DOMAIN: props.opensearchDomainName
            }
        });

        // Grant permissions to Lambda
        props.serviceRegistry.grantReadWriteData(this.apiHandler);
        props.onboardingQueue.grantSendMessages(this.apiHandler);

        // Grant additional permissions for service management
        this.apiHandler.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'logs:DescribeLogGroups',
                'logs:DescribeSubscriptionFilters',
                'ssm:GetParameter',
                'ssm:GetParameters',
                'ssm:PutParameter'
            ],
            resources: ['*']
        }));

        // Create REST API
        this.api = new apigateway.RestApi(this, 'ServiceManagementApi', {
            restApiName: `opensearch-service-management-${props.stage}`,
            description: 'Self-service API for OpenSearch log service onboarding',
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key']
            },
            apiKeySourceType: apigateway.ApiKeySourceType.HEADER
        });

        // Create API integration
        const integration = new apigateway.LambdaIntegration(this.apiHandler, {
            requestTemplates: { 'application/json': '{ "statusCode": "200" }' }
        });

        // API routes
        const services = this.api.root.addResource('services');
        
        // GET /services - List all services
        services.addMethod('GET', integration, {
            methodResponses: [{
                statusCode: '200',
                responseModels: {
                    'application/json': apigateway.Model.EMPTY_MODEL
                }
            }],
            requestParameters: {
                'method.request.querystring.status': false,
                'method.request.querystring.environment': false
            }
        });

        // POST /services - Create/onboard new service
        services.addMethod('POST', integration, {
            methodResponses: [{
                statusCode: '200',
                responseModels: {
                    'application/json': apigateway.Model.EMPTY_MODEL
                }
            }],
            requestModels: {
                'application/json': this.createServiceRequestModel()
            }
        });

        // Service-specific routes
        const service = services.addResource('{serviceName}');
        
        // GET /services/{serviceName} - Get service details
        service.addMethod('GET', integration);
        
        // PUT /services/{serviceName} - Update service configuration
        service.addMethod('PUT', integration);
        
        // DELETE /services/{serviceName} - Remove service
        service.addMethod('DELETE', integration);

        // Service actions
        const actions = service.addResource('actions');
        
        // POST /services/{serviceName}/actions/onboard - Manually trigger onboarding
        const onboard = actions.addResource('onboard');
        onboard.addMethod('POST', integration);
        
        // POST /services/{serviceName}/actions/approve - Approve service for onboarding
        const approve = actions.addResource('approve');
        approve.addMethod('POST', integration);
        
        // POST /services/{serviceName}/actions/reject - Reject service onboarding
        const reject = actions.addResource('reject');
        reject.addMethod('POST', integration);

        // Templates endpoint
        const templates = this.api.root.addResource('templates');
        templates.addMethod('GET', integration); // List available templates
        
        const template = templates.addResource('{templateName}');
        template.addMethod('GET', integration); // Get specific template

        // Health check endpoint
        const health = this.api.root.addResource('health');
        health.addMethod('GET', integration);

        // Create API key for authentication
        const apiKey = this.api.addApiKey('ServiceManagementApiKey', {
            apiKeyName: `opensearch-service-api-${props.stage}`,
            description: 'API key for OpenSearch service management'
        });

        // Create usage plan
        const usagePlan = this.api.addUsagePlan('ServiceManagementUsagePlan', {
            name: `opensearch-service-usage-${props.stage}`,
            description: 'Usage plan for OpenSearch service management API',
            throttle: {
                rateLimit: 100,
                burstLimit: 200
            },
            quota: {
                limit: 10000,
                period: apigateway.Period.MONTH
            }
        });

        usagePlan.addApiKey(apiKey);
        usagePlan.addApiStage({
            stage: this.api.deploymentStage
        });

        // Note: CloudWatch Log Groups are created automatically
        // API Gateway and Lambda will create their own log groups
    }

    private createServiceRequestModel(): apigateway.Model {
        return this.api.addModel('ServiceRequest', {
            contentType: 'application/json',
            modelName: 'ServiceRequest',
            schema: {
                type: apigateway.JsonSchemaType.OBJECT,
                properties: {
                    serviceName: {
                        type: apigateway.JsonSchemaType.STRING,
                        description: 'Name of the service'
                    },
                    serviceType: {
                        type: apigateway.JsonSchemaType.STRING,
                        description: 'Type of service (eks, database, kafka, application, etc.)',
                        enum: ['eks', 'database', 'kafka', 'application', 'lambda', 'ecs', 'rds']
                    },
                    logGroupName: {
                        type: apigateway.JsonSchemaType.STRING,
                        description: 'CloudWatch Log Group name'
                    },
                    indexName: {
                        type: apigateway.JsonSchemaType.STRING,
                        description: 'OpenSearch index name (optional)'
                    },
                    processorType: {
                        type: apigateway.JsonSchemaType.STRING,
                        description: 'Log processor type (optional)'
                    },
                    autoOnboard: {
                        type: apigateway.JsonSchemaType.BOOLEAN,
                        description: 'Whether to automatically onboard the service'
                    },
                    customConfig: {
                        type: apigateway.JsonSchemaType.OBJECT,
                        description: 'Custom configuration parameters'
                    }
                },
                required: ['serviceName', 'serviceType', 'logGroupName']
            }
        });
    }
}