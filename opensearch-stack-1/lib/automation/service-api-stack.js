"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceApiStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
class ServiceApiStack extends aws_cdk_lib_1.Stack {
    api;
    apiHandler;
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create API Lambda function
        this.apiHandler = new lambda.Function(this, 'ServiceApiHandler', {
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'service_api.handler',
            code: lambda.Code.fromAsset('lambda/service-api'),
            timeout: aws_cdk_lib_1.Duration.minutes(5),
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
    createServiceRequestModel() {
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
exports.ServiceApiStack = ServiceApiStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZS1hcGktc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJzZXJ2aWNlLWFwaS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDZDQUF5RTtBQUV6RSx1RUFBeUQ7QUFDekQsK0RBQWlEO0FBQ2pELHlEQUEyQztBQVkzQyxNQUFhLGVBQWdCLFNBQVEsbUJBQUs7SUFDdEIsR0FBRyxDQUFxQjtJQUN4QixVQUFVLENBQWtCO0lBRTVDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBMkI7UUFDakUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsNkJBQTZCO1FBQzdCLElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUM3RCxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ25DLE9BQU8sRUFBRSxxQkFBcUI7WUFDOUIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLG9CQUFvQixDQUFDO1lBQ2pELE9BQU8sRUFBRSxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDNUIsVUFBVSxFQUFFLEdBQUc7WUFDZixXQUFXLEVBQUU7Z0JBQ1Qsc0JBQXNCLEVBQUUsS0FBSyxDQUFDLGVBQWUsQ0FBQyxTQUFTO2dCQUN2RCxvQkFBb0IsRUFBRSxLQUFLLENBQUMsZUFBZSxDQUFDLFFBQVE7Z0JBQ3BELEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztnQkFDbEIsaUJBQWlCLEVBQUUsS0FBSyxDQUFDLG9CQUFvQjthQUNoRDtTQUNKLENBQUMsQ0FBQztRQUVILDhCQUE4QjtRQUM5QixLQUFLLENBQUMsZUFBZSxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUMxRCxLQUFLLENB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QztxQkFDNUU7b0JBQ0QsWUFBWSxFQUFFO3dCQUNWLElBQUksRUFBRSxVQUFVLENBQUMsY0FBYyxDQUFDLE1BQU07d0JBQ3RDLFdBQVcsRUFBRSwyQkFBMkI7cUJBQzNDO29CQUNELFNBQVMsRUFBRTt3QkFDUCxJQUFJLEVBQUUsVUFBVSxDQUFDLGNBQWMsQ0FBQyxNQUFNO3dCQUN0QyxXQUFXLEVBQUUsa0NBQWtDO3FCQUNsRDtvQkFDRCxhQUFhLEVBQUU7d0JBQ1gsSUFBSSxFQUFFLFVBQVUsQ0FBQyxjQUFjLENBQUMsTUFBTTt3QkFDdEMsV0FBVyxFQUFFLCtCQUErQjtxQkFDL0M7b0JBQ0QsV0FBVyxFQUFFO3dCQUNULElBQUksRUFBRSxVQUFVLENBQUMsY0FBYyxDQUFDLE9BQU87d0JBQ3ZDLFdBQVcsRUFBRSw4Q0FBOEM7cUJBQzlEO29CQUNELFlBQVksRUFBRTt3QkFDVixJQUFJLEVBQUUsVUFBVSxDQUFDLGNBQWMsQ0FBQyxNQUFNO3dCQUN0QyxXQUFXLEVBQUUsaUNBQWlDO3FCQUNqRDtpQkFDSjtnQkFDRCxRQUFRLEVBQUUsQ0FBQyxhQUFhLEVBQUUsYUFBYSxFQUFFLGNBQWMsQ0FBQzthQUMzRDtTQUNKLENBQUMsQ0FBQztJQUNQLENBQUM7Q0FDSjtBQWxNRCwwQ0FrTUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTdGFjaywgU3RhY2tQcm9wcywgRHVyYXRpb24sIFJlbW92YWxQb2xpY3kgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgc3FzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zcXMnO1xuaW1wb3J0IHsgU3RhY2tQcm9wc0V4dCB9IGZyb20gJy4uL3N0YWNrLWNvbXBvc2VyJztcblxuZXhwb3J0IGludGVyZmFjZSBTZXJ2aWNlQXBpU3RhY2tQcm9wcyBleHRlbmRzIFN0YWNrUHJvcHNFeHQge1xuICAgIHJlYWRvbmx5IHNlcnZpY2VSZWdpc3RyeTogZHluYW1vZGIuVGFibGU7XG4gICAgcmVhZG9ubHkgb25ib2FyZGluZ1F1ZXVlOiBzcXMuUXVldWU7XG4gICAgcmVhZG9ubHkgb3BlbnNlYXJjaERvbWFpbk5hbWU6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIFNlcnZpY2VBcGlTdGFjayBleHRlbmRzIFN0YWNrIHtcbiAgICBwdWJsaWMgcmVhZG9ubHkgYXBpOiBhcGlnYXRld2F5LlJlc3RBcGk7XG4gICAgcHVibGljIHJlYWRvbmx5IGFwaUhhbmRsZXI6IGxhbWJkYS5GdW5jdGlvbjtcbiAgICBcbiAgICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogU2VydmljZUFwaVN0YWNrUHJvcHMpIHtcbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIEFQSSBMYW1iZGEgZnVuY3Rpb25cbiAgICAgICAgdGhpcy5hcGlIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU2VydmljZUFwaUhhbmRsZXInLCB7XG4gICAgICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMSxcbiAgICAgICAgICAgIGhhbmRsZXI6ICdzZXJ2aWNlX2FwaS5oYW5kbGVyJyxcbiAgICAgICAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnbGFtYmRhL3NlcnZpY2UtYXBpJyksXG4gICAgICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICAgICAgICBTRVJWSUNFX1JFR0lTVFJZX1RBQkxFOiBwcm9wcy5zZXJ2aWNlUmVnaXN0cnkudGFibGVOYW1lLFxuICAgICAgICAgICAgICAgIE9OQk9BUkRJTkdfUVVFVUVfVVJMOiBwcm9wcy5vbmJvYXJkaW5nUXVldWUucXVldWVVcmwsXG4gICAgICAgICAgICAgICAgU1RBR0U6IHByb3BzLnN0YWdlLFxuICAgICAgICAgICAgICAgIE9QRU5TRUFSQ0hfRE9NQUlOOiBwcm9wcy5vcGVuc2VhcmNoRG9tYWluTmFtZVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byBMYW1iZGFcbiAgICAgICAgcHJvcHMuc2VydmljZVJlZ2lzdHJ5LmdyYW50UmVhZFdyaXRlRGF0YSh0aGlzLmFwaUhhbmRsZXIpO1xuICAgICAgICBwcm9wcy5vbmJvYXJkaW5nUXVldWUuZ3JhbnRTZW5kTWVzc2FnZXModGhpcy5hcGlIYW5kbGVyKTtcblxuICAgICAgICAvLyBHcmFudCBhZGRpdGlvbmFsIHBlcm1pc3Npb25zIGZvciBzZXJ2aWNlIG1hbmFnZW1lbnRcbiAgICAgICAgdGhpcy5hcGlIYW5kbGVyLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgJ2xvZ3M6RGVzY3JpYmVMb2dHcm91cHMnLFxuICAgICAgICAgICAgICAgICdsb2dzOkRlc2NyaWJlU3Vic2NyaXB0aW9uRmlsdGVycycsXG4gICAgICAgICAgICAgICAgJ3NzbTpHZXRQYXJhbWV0ZXInLFxuICAgICAgICAgICAgICAgICdzc206R2V0UGFyYW1ldGVycycsXG4gICAgICAgICAgICAgICAgJ3NzbTpQdXRQYXJhbWV0ZXInXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIFJFU1QgQVBJXG4gICAgICAgIHRoaXMuYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnU2VydmljZU1hbmFnZW1lbnRBcGknLCB7XG4gICAgICAgICAgICByZXN0QXBpTmFtZTogYG9wZW5zZWFyY2gtc2VydmljZS1tYW5hZ2VtZW50LSR7cHJvcHMuc3RhZ2V9YCxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnU2VsZi1zZXJ2aWNlIEFQSSBmb3IgT3BlblNlYXJjaCBsb2cgc2VydmljZSBvbmJvYXJkaW5nJyxcbiAgICAgICAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xuICAgICAgICAgICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLFxuICAgICAgICAgICAgICAgIGFsbG93TWV0aG9kczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9NRVRIT0RTLFxuICAgICAgICAgICAgICAgIGFsbG93SGVhZGVyczogWydDb250ZW50LVR5cGUnLCAnWC1BbXotRGF0ZScsICdBdXRob3JpemF0aW9uJywgJ1gtQXBpLUtleSddXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYXBpS2V5U291cmNlVHlwZTogYXBpZ2F0ZXdheS5BcGlLZXlTb3VyY2VUeXBlLkhFQURFUlxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBDcmVhdGUgQVBJIGludGVncmF0aW9uXG4gICAgICAgIGNvbnN0IGludGVncmF0aW9uID0gbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24odGhpcy5hcGlIYW5kbGVyLCB7XG4gICAgICAgICAgICByZXF1ZXN0VGVtcGxhdGVzOiB7ICdhcHBsaWNhdGlvbi9qc29uJzogJ3sgXCJzdGF0dXNDb2RlXCI6IFwiMjAwXCIgfScgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBBUEkgcm91dGVzXG4gICAgICAgIGNvbnN0IHNlcnZpY2VzID0gdGhpcy5hcGkucm9vdC5hZGRSZXNvdXJjZSgnc2VydmljZXMnKTtcbiAgICAgICAgXG4gICAgICAgIC8vIEdFVCAvc2VydmljZXMgLSBMaXN0IGFsbCBzZXJ2aWNlc1xuICAgICAgICBzZXJ2aWNlcy5hZGRNZXRob2QoJ0dFVCcsIGludGVncmF0aW9uLCB7XG4gICAgICAgICAgICBtZXRob2RSZXNwb25zZXM6IFt7XG4gICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogJzIwMCcsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2VNb2RlbHM6IHtcbiAgICAgICAgICAgICAgICAgICAgJ2FwcGxpY2F0aW9uL2pzb24nOiBhcGlnYXRld2F5Lk1vZGVsLkVNUFRZX01PREVMXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfV0sXG4gICAgICAgICAgICByZXF1ZXN0UGFyYW1ldGVyczoge1xuICAgICAgICAgICAgICAgICdtZXRob2QucmVxdWVzdC5xdWVyeXN0cmluZy5zdGF0dXMnOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAnbWV0aG9kLnJlcXVlc3QucXVlcnlzdHJpbmcuZW52aXJvbm1lbnQnOiBmYWxzZVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBQT1NUIC9zZXJ2aWNlcyAtIENyZWF0ZS9vbmJvYXJkIG5ldyBzZXJ2aWNlXG4gICAgICAgIHNlcnZpY2VzLmFkZE1ldGhvZCgnUE9TVCcsIGludGVncmF0aW9uLCB7XG4gICAgICAgICAgICBtZXRob2RSZXNwb25zZXM6IFt7XG4gICAgICAgICAgICAgICAgc3RhdHVzQ29kZTogJzIwMCcsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2VNb2RlbHM6IHtcbiAgICAgICAgICAgICAgICAgICAgJ2FwcGxpY2F0aW9uL2pzb24nOiBhcGlnYXRld2F5Lk1vZGVsLkVNUFRZX01PREVMXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfV0sXG4gICAgICAgICAgICByZXF1ZXN0TW9kZWxzOiB7XG4gICAgICAgICAgICAgICAgJ2FwcGxpY2F0aW9uL2pzb24nOiB0aGlzLmNyZWF0ZVNlcnZpY2VSZXF1ZXN0TW9kZWwoKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBTZXJ2aWNlLXNwZWNpZmljIHJvdXRlc1xuICAgICAgICBjb25zdCBzZXJ2aWNlID0gc2VydmljZXMuYWRkUmVzb3VyY2UoJ3tzZXJ2aWNlTmFtZX0nKTtcbiAgICAgICAgXG4gICAgICAgIC8vIEdFVCAvc2VydmljZXMve3NlcnZpY2VOYW1lfSAtIEdldCBzZXJ2aWNlIGRldGFpbHNcbiAgICAgICAgc2VydmljZS5hZGRNZXRob2QoJ0dFVCcsIGludGVncmF0aW9uKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFBVVCAvc2VydmljZXMve3NlcnZpY2VOYW1lfSAtIFVwZGF0ZSBzZXJ2aWNlIGNvbmZpZ3VyYXRpb25cbiAgICAgICAgc2VydmljZS5hZGRNZXRob2QoJ1BVVCcsIGludGVncmF0aW9uKTtcbiAgICAgICAgXG4gICAgICAgIC8vIERFTEVURSAvc2VydmljZXMve3NlcnZpY2VOYW1lfSAtIFJlbW92ZSBzZXJ2aWNlXG4gICAgICAgIHNlcnZpY2UuYWRkTWV0aG9kKCdERUxFVEUnLCBpbnRlZ3JhdGlvbik7XG5cbiAgICAgICAgLy8gU2VydmljZSBhY3Rpb25zXG4gICAgICAgIGNvbnN0IGFjdGlvbnMgPSBzZXJ2aWNlLmFkZFJlc291cmNlKCdhY3Rpb25zJyk7XG4gICAgICAgIFxuICAgICAgICAvLyBQT1NUIC9zZXJ2aWNlcy97c2VydmljZU5hbWV9L2FjdGlvbnMvb25ib2FyZCAtIE1hbnVhbGx5IHRyaWdnZXIgb25ib2FyZGluZ1xuICAgICAgICBjb25zdCBvbmJvYXJkID0gYWN0aW9ucy5hZGRSZXNvdXJjZSgnb25ib2FyZCcpO1xuICAgICAgICBvbmJvYXJkLmFkZE1ldGhvZCgnUE9TVCcsIGludGVncmF0aW9uKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFBPU1QgL3NlcnZpY2VzL3tzZXJ2aWNlTmFtZX0vYWN0aW9ucy9hcHByb3ZlIC0gQXBwcm92ZSBzZXJ2aWNlIGZvciBvbmJvYXJkaW5nXG4gICAgICAgIGNvbnN0IGFwcHJvdmUgPSBhY3Rpb25zLmFkZFJlc291cmNlKCdhcHByb3ZlJyk7XG4gICAgICAgIGFwcHJvdmUuYWRkTWV0aG9kKCdQT1NUJywgaW50ZWdyYXRpb24pO1xuICAgICAgICBcbiAgICAgICAgLy8gUE9TVCAvc2VydmljZXMve3NlcnZpY2VOYW1lfS9hY3Rpb25zL3JlamVjdCAtIFJlamVjdCBzZXJ2aWNlIG9uYm9hcmRpbmdcbiAgICAgICAgY29uc3QgcmVqZWN0ID0gYWN0aW9ucy5hZGRSZXNvdXJjZSgncmVqZWN0Jyk7XG4gICAgICAgIHJlamVjdC5hZGRNZXRob2QoJ1BPU1QnLCBpbnRlZ3JhdGlvbik7XG5cbiAgICAgICAgLy8gVGVtcGxhdGVzIGVuZHBvaW50XG4gICAgICAgIGNvbnN0IHRlbXBsYXRlcyA9IHRoaXMuYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ3RlbXBsYXRlcycpO1xuICAgICAgICB0ZW1wbGF0ZXMuYWRkTWV0aG9kKCdHRVQnLCBpbnRlZ3JhdGlvbik7IC8vIExpc3QgYXZhaWxhYmxlIHRlbXBsYXRlc1xuICAgICAgICBcbiAgICAgICAgY29uc3QgdGVtcGxhdGUgPSB0ZW1wbGF0ZXMuYWRkUmVzb3VyY2UoJ3t0ZW1wbGF0ZU5hbWV9Jyk7XG4gICAgICAgIHRlbXBsYXRlLmFkZE1ldGhvZCgnR0VUJywgaW50ZWdyYXRpb24pOyAvLyBHZXQgc3BlY2lmaWMgdGVtcGxhdGVcblxuICAgICAgICAvLyBIZWFsdGggY2hlY2sgZW5kcG9pbnRcbiAgICAgICAgY29uc3QgaGVhbHRoID0gdGhpcy5hcGkucm9vdC5hZGRSZXNvdXJjZSgnaGVhbHRoJyk7XG4gICAgICAgIGhlYWx0aC5hZGRNZXRob2QoJ0dFVCcsIGludGVncmF0aW9uKTtcblxuICAgICAgICAvLyBDcmVhdGUgQVBJIGtleSBmb3IgYXV0aGVudGljYXRpb25cbiAgICAgICAgY29uc3QgYXBpS2V5ID0gdGhpcy5hcGkuYWRkQXBpS2V5KCdTZXJ2aWNlTWFuYWdlbWVudEFwaUtleScsIHtcbiAgICAgICAgICAgIGFwaUtleU5hbWU6IGBvcGVuc2VhcmNoLXNlcnZpY2UtYXBpLSR7cHJvcHMuc3RhZ2V9YCxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIGtleSBmb3IgT3BlblNlYXJjaCBzZXJ2aWNlIG1hbmFnZW1lbnQnXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSB1c2FnZSBwbGFuXG4gICAgICAgIGNvbnN0IHVzYWdlUGxhbiA9IHRoaXMuYXBpLmFkZFVzYWdlUGxhbignU2VydmljZU1hbmFnZW1lbnRVc2FnZVBsYW4nLCB7XG4gICAgICAgICAgICBuYW1lOiBgb3BlbnNlYXJjaC1zZXJ2aWNlLXVzYWdlLSR7cHJvcHMuc3RhZ2V9YCxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnVXNhZ2UgcGxhbiBmb3IgT3BlblNlYXJjaCBzZXJ2aWNlIG1hbmFnZW1lbnQgQVBJJyxcbiAgICAgICAgICAgIHRocm90dGxlOiB7XG4gICAgICAgICAgICAgICAgcmF0ZUxpbWl0OiAxMDAsXG4gICAgICAgICAgICAgICAgYnVyc3RMaW1pdDogMjAwXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcXVvdGE6IHtcbiAgICAgICAgICAgICAgICBsaW1pdDogMTAwMDAsXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBhcGlnYXRld2F5LlBlcmlvZC5NT05USFxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICB1c2FnZVBsYW4uYWRkQXBpS2V5KGFwaUtleSk7XG4gICAgICAgIHVzYWdlUGxhbi5hZGRBcGlTdGFnZSh7XG4gICAgICAgICAgICBzdGFnZTogdGhpcy5hcGkuZGVwbG95bWVudFN0YWdlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIE5vdGU6IENsb3VkV2F0Y2ggTG9nIEdyb3VwcyBhcmUgY3JlYXRlZCBhdXRvbWF0aWNhbGx5XG4gICAgICAgIC8vIEFQSSBHYXRld2F5IGFuZCBMYW1iZGEgd2lsbCBjcmVhdGUgdGhlaXIgb3duIGxvZyBncm91cHNcbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZVNlcnZpY2VSZXF1ZXN0TW9kZWwoKTogYXBpZ2F0ZXdheS5Nb2RlbCB7XG4gICAgICAgIHJldHVybiB0aGlzLmFwaS5hZGRNb2RlbCgnU2VydmljZVJlcXVlc3QnLCB7XG4gICAgICAgICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgbW9kZWxOYW1lOiAnU2VydmljZVJlcXVlc3QnLFxuICAgICAgICAgICAgc2NoZW1hOiB7XG4gICAgICAgICAgICAgICAgdHlwZTogYXBpZ2F0ZXdheS5Kc29uU2NoZW1hVHlwZS5PQkpFQ1QsXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgICAgICBzZXJ2aWNlTmFtZToge1xuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogYXBpZ2F0ZXdheS5Kc29uU2NoZW1hVHlwZS5TVFJJTkcsXG4gICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ05hbWUgb2YgdGhlIHNlcnZpY2UnXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHNlcnZpY2VUeXBlOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFUeXBlLlNUUklORyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnVHlwZSBvZiBzZXJ2aWNlIChla3MsIGRhdGFiYXNlLCBrYWZrYSwgYXBwbGljYXRpb24sIGV0Yy4pJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGVudW06IFsnZWtzJywgJ2RhdGFiYXNlJywgJ2thZmthJywgJ2FwcGxpY2F0aW9uJywgJ2xhbWJkYScsICdlY3MnLCAncmRzJ11cbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgbG9nR3JvdXBOYW1lOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFUeXBlLlNUUklORyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRXYXRjaCBMb2cgR3JvdXAgbmFtZSdcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgaW5kZXhOYW1lOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFUeXBlLlNUUklORyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnT3BlblNlYXJjaCBpbmRleCBuYW1lIChvcHRpb25hbCknXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHByb2Nlc3NvclR5cGU6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6IGFwaWdhdGV3YXkuSnNvblNjaGVtYVR5cGUuU1RSSU5HLFxuICAgICAgICAgICAgICAgICAgICAgICAgZGVzY3JpcHRpb246ICdMb2cgcHJvY2Vzc29yIHR5cGUgKG9wdGlvbmFsKSdcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgYXV0b09uYm9hcmQ6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6IGFwaWdhdGV3YXkuSnNvblNjaGVtYVR5cGUuQk9PTEVBTixcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnV2hldGhlciB0byBhdXRvbWF0aWNhbGx5IG9uYm9hcmQgdGhlIHNlcnZpY2UnXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGN1c3RvbUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogYXBpZ2F0ZXdheS5Kc29uU2NoZW1hVHlwZS5PQkpFQ1QsXG4gICAgICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0N1c3RvbSBjb25maWd1cmF0aW9uIHBhcmFtZXRlcnMnXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHJlcXVpcmVkOiBbJ3NlcnZpY2VOYW1lJywgJ3NlcnZpY2VUeXBlJywgJ2xvZ0dyb3VwTmFtZSddXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cbn0iXX0=