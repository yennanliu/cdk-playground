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
exports.OpenSearchDomainStack = void 0;
const aws_opensearchservice_1 = require("aws-cdk-lib/aws-opensearchservice");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const cr = __importStar(require("aws-cdk-lib/custom-resources"));
const iam_roles_1 = require("./constructs/iam-roles");
const path = __importStar(require("path"));
class OpenSearchDomainStack extends aws_cdk_lib_1.Stack {
    domainEndpoint;
    domain;
    firehoseRole;
    cloudwatchLogsRole;
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create shared IAM roles using the reusable construct
        const loggingRoles = new iam_roles_1.LoggingRoles(this, 'LoggingRoles', {
            region: this.region,
            account: this.account
        });
        this.firehoseRole = loggingRoles.firehoseRole;
        this.cloudwatchLogsRole = loggingRoles.cloudWatchLogsRole;
        // Map objects from props
        const zoneAwarenessConfig = props.availabilityZoneCount && props.availabilityZoneCount >= 2 ?
            { enabled: true, availabilityZoneCount: props.availabilityZoneCount } : undefined;
        // Create domain with security disabled
        const domain = new aws_opensearchservice_1.Domain(this, 'Domain', {
            version: props.version,
            domainName: props.domainName,
            enforceHttps: true,
            nodeToNodeEncryption: true,
            encryptionAtRest: {
                enabled: true
            },
            capacity: {
                dataNodeInstanceType: props.dataNodeInstanceType,
                dataNodes: props.dataNodes,
                masterNodeInstanceType: props.dedicatedManagerNodeType,
                masterNodes: props.dedicatedManagerNodeCount,
                warmInstanceType: props.warmInstanceType,
                warmNodes: props.warmNodes,
                multiAzWithStandbyEnabled: false
            },
            ebs: {
                enabled: props.ebsEnabled,
                iops: props.ebsIops,
                volumeSize: props.ebsVolumeSize,
                volumeType: props.ebsVolumeType
            },
            vpc: props.vpc,
            vpcSubnets: props.vpcSubnets,
            securityGroups: props.vpcSecurityGroups,
            zoneAwareness: zoneAwarenessConfig,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY
        });
        // Get the underlying CfnDomain to customize its behavior
        const cfnDomain = domain.node.defaultChild;
        // Enable advanced security options (FGAC) with master user and map IAM role
        cfnDomain.addPropertyOverride('AdvancedSecurityOptions', {
            Enabled: true,
            InternalUserDatabaseEnabled: true,
            MasterUserOptions: {
                MasterUserName: 'admin',
                MasterUserPassword: 'Admin@OpenSearch123!' // You should change this password
            }
        });
        // Add role mapping for Firehose role
        const roleMapping = {
            'backend_roles': [this.firehoseRole.roleArn],
            'hosts': [],
            'users': [],
            'reserved': false
        };
        // Add security configuration for the all_access role
        cfnDomain.addPropertyOverride('AdvancedOptions', {
            'rest.action.multi.allow_explicit_index': 'true'
        });
        // Master user options are handled in AdvancedSecurityOptions
        // Security groups are handled by the Domain construct
        // Add comprehensive access policy for Firehose role, service, and authenticated users
        cfnDomain.addPropertyOverride('AccessPolicies', {
            Version: '2012-10-17',
            Statement: [
                {
                    Sid: 'AllowFirehoseRoleAccess',
                    Effect: 'Allow',
                    Principal: {
                        AWS: this.firehoseRole.roleArn
                    },
                    Action: [
                        'es:*',
                        'opensearch:*'
                    ],
                    Resource: `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`
                },
                {
                    Sid: 'AllowFirehoseServiceAccess',
                    Effect: 'Allow',
                    Principal: {
                        Service: 'firehose.amazonaws.com'
                    },
                    Action: [
                        'es:*',
                        'opensearch:*'
                    ],
                    Resource: `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`
                },
                {
                    Sid: 'AllowAllAccess',
                    Effect: 'Allow',
                    Principal: {
                        AWS: '*'
                    },
                    Action: [
                        'es:*',
                        'opensearch:*'
                    ],
                    Resource: `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`
                }
            ]
        });
        cfnDomain.cfnOptions.updateReplacePolicy = aws_cdk_lib_1.CfnDeletionPolicy.DELETE;
        cfnDomain.cfnOptions.deletionPolicy = aws_cdk_lib_1.CfnDeletionPolicy.DELETE;
        this.domainEndpoint = domain.domainEndpoint;
        this.domain = domain;
        // Create Lambda function for OpenSearch role mapping
        const roleMappingLambda = new lambda.Function(this, 'OpenSearchRoleMappingLambda', {
            runtime: lambda.Runtime.PYTHON_3_9,
            handler: 'opensearch-role-mapper.lambda_handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
            timeout: aws_cdk_lib_1.Duration.minutes(10),
            description: 'Configures OpenSearch role mapping for Firehose integration',
            environment: {
                LOG_LEVEL: 'INFO'
            }
        });
        // Create Lambda function for OpenSearch index management
        const indexManagerLambda = new lambda.Function(this, 'OpenSearchIndexManagerLambda', {
            runtime: lambda.Runtime.PYTHON_3_9,
            handler: 'opensearch-index-manager.lambda_handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
            timeout: aws_cdk_lib_1.Duration.minutes(10),
            description: 'Manages OpenSearch indices and templates for eks-logs and pod-logs',
            environment: {
                LOG_LEVEL: 'INFO',
                DOMAIN_ENDPOINT: domain.domainEndpoint,
                MASTER_USER: 'admin',
                MASTER_PASSWORD: 'Admin@OpenSearch123!'
            }
        });
        // Grant the Lambda permissions to be invoked by CloudFormation custom resources
        roleMappingLambda.addPermission('AllowCustomResourceInvoke', {
            principal: new iam.ServicePrincipal('cloudformation.amazonaws.com'),
            action: 'lambda:InvokeFunction'
        });
        indexManagerLambda.addPermission('AllowCustomResourceInvoke', {
            principal: new iam.ServicePrincipal('cloudformation.amazonaws.com'),
            action: 'lambda:InvokeFunction'
        });
        // Grant Lambda functions OpenSearch access permissions
        roleMappingLambda.addToRolePolicy(new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
            actions: [
                'es:*',
                'opensearch:*'
            ],
            resources: [
                `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}`,
                `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`,
                `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}`,
                `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}/*`
            ]
        }));
        indexManagerLambda.addToRolePolicy(new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
            actions: [
                'es:*',
                'opensearch:*'
            ],
            resources: [
                `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}`,
                `arn:aws:es:${this.region}:${this.account}:domain/${props.domainName}/*`,
                `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}`,
                `arn:aws:opensearch:${this.region}:${this.account}:domain/${props.domainName}/*`
            ]
        }));
        // Grant Lambda functions basic execution permissions
        roleMappingLambda.addToRolePolicy(new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents'
            ],
            resources: [`arn:aws:logs:${this.region}:${this.account}:*`]
        }));
        indexManagerLambda.addToRolePolicy(new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents'
            ],
            resources: [`arn:aws:logs:${this.region}:${this.account}:*`]
        }));
        // Create CustomResource provider for role mapping
        const roleMappingProvider = new cr.Provider(this, 'OpenSearchRoleMappingProvider', {
            onEventHandler: roleMappingLambda
        });
        // Create CustomResource to invoke the Lambda
        const roleMappingResource = new aws_cdk_lib_1.CustomResource(this, 'OpenSearchRoleMapping', {
            serviceToken: roleMappingProvider.serviceToken,
            properties: {
                domainEndpoint: domain.domainEndpoint,
                firehoseRoleArn: this.firehoseRole.roleArn,
                masterUser: 'admin',
                masterPassword: 'Admin@OpenSearch123!' // In production, use Secrets Manager
            }
        });
        // Ensure the custom resource runs after the domain is created
        roleMappingResource.node.addDependency(domain);
        // Create CustomResource provider for index templates
        const indexTemplateProvider = new cr.Provider(this, 'OpenSearchIndexTemplateProvider', {
            onEventHandler: indexManagerLambda
        });
        // Create CustomResource for index templates
        const indexTemplateManagerResource = new aws_cdk_lib_1.CustomResource(this, 'OpenSearchIndexTemplateManager', {
            serviceToken: indexTemplateProvider.serviceToken,
            properties: {
                operation: 'create_templates',
                domainEndpoint: domain.domainEndpoint,
                masterUser: 'admin',
                masterPassword: 'Admin@OpenSearch123!'
            }
        });
        // Create CustomResource provider for index creation
        const indexCreatorProvider = new cr.Provider(this, 'OpenSearchIndexCreatorProvider', {
            onEventHandler: indexManagerLambda
        });
        // Create CustomResource for initial indices
        const indexCreatorResource = new aws_cdk_lib_1.CustomResource(this, 'OpenSearchIndexCreator', {
            serviceToken: indexCreatorProvider.serviceToken,
            properties: {
                operation: 'create_indices',
                domainEndpoint: domain.domainEndpoint,
                masterUser: 'admin',
                masterPassword: 'Admin@OpenSearch123!'
            }
        });
        // Ensure the index template manager runs after role mapping is complete
        indexTemplateManagerResource.node.addDependency(roleMappingResource);
        // Ensure the index creator runs after templates are created
        indexCreatorResource.node.addDependency(indexTemplateManagerResource);
        // Export the Firehose role ARN and name for use by other stacks
        new aws_cdk_lib_1.CfnOutput(this, 'FirehoseRoleArn', {
            value: this.firehoseRole.roleArn,
            exportName: `${this.stackName}-FirehoseRoleArn`,
            description: 'ARN of the Firehose role for OpenSearch access'
        });
        new aws_cdk_lib_1.CfnOutput(this, 'FirehoseRoleName', {
            value: this.firehoseRole.roleName,
            exportName: `${this.stackName}-FirehoseRoleName`,
            description: 'Name of the Firehose role for OpenSearch access'
        });
        new aws_cdk_lib_1.CfnOutput(this, 'OpenSearchRoleMappingStatus', {
            value: roleMappingResource.getAtt('body').toString(),
            description: 'Status of OpenSearch role mapping configuration'
        });
        new aws_cdk_lib_1.CfnOutput(this, 'OpenSearchIndexTemplateStatus', {
            value: indexTemplateManagerResource.getAtt('body').toString(),
            description: 'Status of OpenSearch index template creation for eks-logs and pod-logs'
        });
        new aws_cdk_lib_1.CfnOutput(this, 'OpenSearchIndexCreationStatus', {
            value: indexCreatorResource.getAtt('body').toString(),
            description: 'Status of OpenSearch index creation for eks-logs and pod-logs'
        });
        // Export the CloudWatch Logs role ARN and name for use by other stacks
        new aws_cdk_lib_1.CfnOutput(this, 'CloudWatchLogsRoleArn', {
            value: this.cloudwatchLogsRole.roleArn,
            exportName: `${this.stackName}-CloudWatchLogsRoleArn`,
            description: 'ARN of the CloudWatch Logs role for Firehose access'
        });
        new aws_cdk_lib_1.CfnOutput(this, 'CloudWatchLogsRoleName', {
            value: this.cloudwatchLogsRole.roleName,
            exportName: `${this.stackName}-CloudWatchLogsRoleName`,
            description: 'Name of the CloudWatch Logs role for Firehose access'
        });
    }
}
exports.OpenSearchDomainStack = OpenSearchDomainStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3BlbnNlYXJjaC1kb21haW4tc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJvcGVuc2VhcmNoLWRvbWFpbi1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVBLDZFQUF3RztBQUN4Ryw2Q0FBeUc7QUFDekcseURBQTJDO0FBQzNDLGlEQUE0RDtBQUM1RCwrREFBaUQ7QUFDakQsaUVBQW1EO0FBR25ELHNEQUFvRDtBQUNwRCwyQ0FBNkI7QUE0QjdCLE1BQWEscUJBQXNCLFNBQVEsbUJBQUs7SUFDOUIsY0FBYyxDQUFTO0lBQ3ZCLE1BQU0sQ0FBUztJQUNmLFlBQVksQ0FBVztJQUN2QixrQkFBa0IsQ0FBVztJQUU3QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWlDO1FBQ3pFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLHVEQUF1RDtRQUN2RCxNQUFNLFlBQVksR0FBRyxJQUFJLHdCQUFZLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUMxRCxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDbkIsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO1NBQ3RCLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxDQUFDLFlBQVksQ0FBQztRQUM5QyxJQUFJLENBQUMsa0JBQWtCLEdBQUcsWUFBWSxDQUFDLGtCQUFrQixDQUFDO1FBRTFELHlCQUF5QjtRQUN6QixNQUFNLG1CQUFtQixHQUFrQyxLQUFLLENBQUMscUJBQXFCLElBQUksS0FBSyxDQUFDLHFCQUFxQixJQUFJLENBQUMsQ0FBQyxDQUFDO1lBQ3hILEVBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxxQkFBcUIsRUFBRSxLQUFLLENBQUMscUJBQXFCLEVBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO1FBRXBGLHVDQUF1QztRQUN2QyxNQUFNLE1BQU0s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RUFBRSxzREFBc0Q7U0FDcEUsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBN1RELHNEQTZUQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7Q29uc3RydWN0fSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHtFYnNEZXZpY2VWb2x1bWVUeXBlLCBJU2VjdXJpdHlHcm91cCwgSVZwYywgU3VibmV0U2VsZWN0aW9ufSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWVjMlwiO1xuaW1wb3J0IHtDZm5Eb21haW4sIERvbWFpbiwgRW5naW5lVmVyc2lvbiwgWm9uZUF3YXJlbmVzc0NvbmZpZ30gZnJvbSBcImF3cy1jZGstbGliL2F3cy1vcGVuc2VhcmNoc2VydmljZVwiO1xuaW1wb3J0IHtDZm5EZWxldGlvblBvbGljeSwgUmVtb3ZhbFBvbGljeSwgU3RhY2ssIENmbk91dHB1dCwgRHVyYXRpb24sIEN1c3RvbVJlc291cmNlfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCAqIGFzIGlhbSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xuaW1wb3J0IHtQb2xpY3lTdGF0ZW1lbnQsIEVmZmVjdH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYVwiO1xuaW1wb3J0ICogYXMgY3IgZnJvbSBcImF3cy1jZGstbGliL2N1c3RvbS1yZXNvdXJjZXNcIjtcbmltcG9ydCB7QXdzQ3VzdG9tUmVzb3VyY2UsIEF3c0N1c3RvbVJlc291cmNlUG9saWN5LCBQaHlzaWNhbFJlc291cmNlSWR9IGZyb20gXCJhd3MtY2RrLWxpYi9jdXN0b20tcmVzb3VyY2VzXCI7XG5pbXBvcnQge1N0YWNrUHJvcHNFeHR9IGZyb20gXCIuL3N0YWNrLWNvbXBvc2VyXCI7XG5pbXBvcnQge0xvZ2dpbmdSb2xlc30gZnJvbSBcIi4vY29uc3RydWN0cy9pYW0tcm9sZXNcIjtcbmltcG9ydCAqIGFzIHBhdGggZnJvbSBcInBhdGhcIjtcblxuZXhwb3J0IGludGVyZmFjZSBPcGVuU2VhcmNoRG9tYWluU3RhY2tQcm9wcyBleHRlbmRzIFN0YWNrUHJvcHNFeHQge1xuICByZWFkb25seSB2ZXJzaW9uOiBFbmdpbmVWZXJzaW9uLFxuICByZWFkb25seSBkb21haW5OYW1lOiBzdHJpbmcsXG4gIHJlYWRvbmx5IGRhdGFOb2RlSW5zdGFuY2VUeXBlPzogc3RyaW5nLFxuICByZWFkb25seSBkYXRhTm9kZXM/OiBudW1iZXIsXG4gIHJlYWRvbmx5IGRlZGljYXRlZE1hbmFnZXJOb2RlVHlwZT86IHN0cmluZyxcbiAgcmVhZG9ubHkgZGVkaWNhdGVkTWFuYWdlck5vZGVDb3VudD86IG51bWJlcixcbiAgcmVhZG9ubHkgd2FybUluc3RhbmNlVHlwZT86IHN0cmluZyxcbiAgcmVhZG9ubHkgd2FybU5vZGVzPzogbnVtYmVyXG4gIHJlYWRvbmx5IGVic0VuYWJsZWQ/OiBib29sZWFuLFxuICByZWFkb25seSBlYnNJb3BzPzogbnVtYmVyLFxuICByZWFkb25seSBlYnNWb2x1bWVTaXplPzogbnVtYmVyLFxuICByZWFkb25seSBlYnNWb2x1bWVUeXBlPzogRWJzRGV2aWNlVm9sdW1lVHlwZSxcbiAgcmVhZG9ubHkgdnBjPzogSVZwYyxcbiAgcmVhZG9ubHkgdnBjU3VibmV0cz86IFN1Ym5ldFNlbGVjdGlvbltdLFxuICByZWFkb25seSB2cGNTZWN1cml0eUdyb3Vwcz86IElTZWN1cml0eUdyb3VwW10sXG4gIHJlYWRvbmx5IGF2YWlsYWJpbGl0eVpvbmVDb3VudD86IG51bWJlcixcbiAgcmVhZG9ubHkgYWNjZXNzUG9saWNpZXM/OiBQb2xpY3lTdGF0ZW1lbnRbXSxcbiAgcmVhZG9ubHkgdXNlVW5zaWduZWRCYXNpY0F1dGg/OiBib29sZWFuLFxuICByZWFkb25seSBmaW5lR3JhaW5lZE1hbmFnZXJVc2VyQVJOPzogc3RyaW5nLFxuICByZWFkb25seSBmaW5lR3JhaW5lZE1hbmFnZXJVc2VyTmFtZT86IHN0cmluZyxcbiAgcmVhZG9ubHkgZmluZUdyYWluZWRNYW5hZ2VyVXNlclNlY3JldE1hbmFnZXJLZXlBUk4/OiBzdHJpbmcsXG4gIHJlYWRvbmx5IGVuZm9yY2VIVFRQUz86IGJvb2xlYW4sXG4gIHJlYWRvbmx5IGVuY3J5cHRpb25BdFJlc3RFbmFibGVkPzogYm9vbGVhblxufVxuXG5leHBvcnQgY2xhc3MgT3BlblNlYXJjaERvbWFpblN0YWNrIGV4dGVuZHMgU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgZG9tYWluRW5kcG9pbnQ6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IGRvbWFpbjogRG9tYWluO1xuICBwdWJsaWMgcmVhZG9ubHkgZmlyZWhvc2VSb2xlOiBpYW0uUm9sZTtcbiAgcHVibGljIHJlYWRvbmx5IGNsb3Vkd2F0Y2hMb2dzUm9sZTogaWFtLlJvbGU7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IE9wZW5TZWFyY2hEb21haW5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBDcmVhdGUgc2hhcmVkIElBTSByb2xlcyB1c2luZyB0aGUgcmV1c2FibGUgY29uc3RydWN0XG4gICAgY29uc3QgbG9nZ2luZ1JvbGVzID0gbmV3IExvZ2dpbmdSb2xlcyh0aGlzLCAnTG9nZ2luZ1JvbGVzJywge1xuICAgICAgcmVnaW9uOiB0aGlzLnJlZ2lvbixcbiAgICAgIGFjY291bnQ6IHRoaXMuYWNjb3VudFxuICAgIH0pO1xuXG4gICAgdGhpcy5maXJlaG9zZVJvbGUgPSBsb2dnaW5nUm9sZXMuZmlyZWhvc2VSb2xlO1xuICAgIHRoaXMuY2xvdWR3YXRjaExvZ3NSb2xlID0gbG9nZ2luZ1JvbGVzLmNsb3VkV2F0Y2hMb2dzUm9sZTtcblxuICAgIC8vIE1hcCBvYmplY3RzIGZyb20gcHJvcHNcbiAgICBjb25zdCB6b25lQXdhcmVuZXNzQ29uZmlnOiBab25lQXdhcmVuZXNzQ29uZmlnfHVuZGVmaW5lZCA9IHByb3BzLmF2YWlsYWJpbGl0eVpvbmVDb3VudCAmJiBwcm9wcy5hdmFpbGFiaWxpdHlab25lQ291bnQgPj0gMiA/XG4gICAgICAgIHtlbmFibGVkOiB0cnVlLCBhdmFpbGFiaWxpdHlab25lQ291bnQ6IHByb3BzLmF2YWlsYWJpbGl0eVpvbmVDb3VudH0gOiB1bmRlZmluZWQ7XG5cbiAgICAvLyBDcmVhdGUgZG9tYWluIHdpdGggc2VjdXJpdHkgZGlzYWJsZWRcbiAgICBjb25zdCBkb21haW4gPSBuZXcgRG9tYWluKHRoaXMsICdEb21haW4nLCB7XG4gICAgICB2ZXJzaW9uOiBwcm9wcy52ZXJzaW9uLFxuICAgICAgZG9tYWluTmFtZTogcHJvcHMuZG9tYWluTmFtZSxcbiAgICAgIGVuZm9yY2VIdHRwczogdHJ1ZSxcbiAgICAgIG5vZGVUb05vZGVFbmNyeXB0aW9uOiB0cnVlLFxuICAgICAgZW5jcnlwdGlvbkF0UmVzdDoge1xuICAgICAgICBlbmFibGVkOiB0cnVlXG4gICAgICB9LFxuICAgICAgY2FwYWNpdHk6IHtcbiAgICAgICAgZGF0YU5vZGVJbnN0YW5jZVR5cGU6IHByb3BzLmRhdGFOb2RlSW5zdGFuY2VUeXBlLFxuICAgICAgICBkYXRhTm9kZXM6IHByb3BzLmRhdGFOb2RlcyxcbiAgICAgICAgbWFzdGVyTm9kZUluc3RhbmNlVHlwZTogcHJvcHMuZGVkaWNhdGVkTWFuYWdlck5vZGVUeXBlLFxuICAgICAgICBtYXN0ZXJOb2RlczogcHJvcHMuZGVkaWNhdGVkTWFuYWdlck5vZGVDb3VudCxcbiAgICAgICAgd2FybUluc3RhbmNlVHlwZTogcHJvcHMud2FybUluc3RhbmNlVHlwZSxcbiAgICAgICAgd2FybU5vZGVzOiBwcm9wcy53YXJtTm9kZXMsXG4gICAgICAgIG11bHRpQXpXaXRoU3RhbmRieUVuYWJsZWQ6IGZhbHNlXG4gICAgICB9LFxuICAgICAgZWJzOiB7XG4gICAgICAgIGVuYWJsZWQ6IHByb3BzLmVic0VuYWJsZWQsXG4gICAgICAgIGlvcHM6IHByb3BzLmVic0lvcHMsXG4gICAgICAgIHZvbHVtZVNpemU6IHByb3BzLmVic1ZvbHVtZVNpemUsXG4gICAgICAgIHZvbHVtZVR5cGU6IHByb3BzLmVic1ZvbHVtZVR5cGVcbiAgICAgIH0sXG4gICAgICB2cGM6IHByb3BzLnZwYyxcbiAgICAgIHZwY1N1Ym5ldHM6IHByb3BzLnZwY1N1Ym5ldHMsXG4gICAgICBzZWN1cml0eUdyb3VwczogcHJvcHMudnBjU2VjdXJpdHlHcm91cHMsXG4gICAgICB6b25lQXdhcmVuZXNzOiB6b25lQXdhcmVuZXNzQ29uZmlnLFxuICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgfSk7XG5cbiAgICAvLyBHZXQgdGhlIHVuZGVybHlpbmcgQ2ZuRG9tYWluIHRvIGN1c3RvbWl6ZSBpdHMgYmVoYXZpb3JcbiAgICBjb25zdCBjZm5Eb21haW4gPSBkb21haW4ubm9kZS5kZWZhdWx0Q2hpbGQgYXMgQ2ZuRG9tYWluO1xuICAgIFxuICAgIC8vIEVuYWJsZSBhZHZhbmNlZCBzZWN1cml0eSBvcHRpb25zIChGR0FDKSB3aXRoIG1hc3RlciB1c2VyIGFuZCBtYXAgSUFNIHJvbGVcbiAgICBjZm5Eb21haW4uYWRkUHJvcGVydHlPdmVycmlkZSgnQWR2YW5jZWRTZWN1cml0eU9wdGlvbnMnLCB7XG4gICAgICBFbmFibGVkOiB0cnVlLFxuICAgICAgSW50ZXJuYWxVc2VyRGF0YWJhc2VFbmFibGVkOiB0cnVlLFxuICAgICAgTWFzdGVyVXNlck9wdGlvbnM6IHtcbiAgICAgICAgTWFzdGVyVXNlck5hbWU6ICdhZG1pbicsXG4gICAgICAgIE1hc3RlclVzZXJQYXNzd29yZDogJ0FkbWluQE9wZW5TZWFyY2gxMjMhJyAvLyBZb3Ugc2hvdWxkIGNoYW5nZSB0aGlzIHBhc3N3b3JkXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBBZGQgcm9sZSBtYXBwaW5nIGZvciBGaXJlaG9zZSByb2xlXG4gICAgY29uc3Qgcm9sZU1hcHBpbmcgPSB7XG4gICAgICAnYmFja2VuZF9yb2xlcyc6IFt0aGlzLmZpcmVob3NlUm9sZS5yb2xlQXJuXSxcbiAgICAgICdob3N0cyc6IFtdLFxuICAgICAgJ3VzZXJzJzogW10sXG4gICAgICAncmVzZXJ2ZWQnOiBmYWxzZVxuICAgIH07XG5cbiAgICAvLyBBZGQgc2VjdXJpdHkgY29uZmlndXJhdGlvbiBmb3IgdGhlIGFsbF9hY2Nlc3Mgcm9sZVxuICAgIGNmbkRvbWFpbi5hZGRQcm9wZXJ0eU92ZXJyaWRlKCdBZHZhbmNlZE9wdGlvbnMnLCB7XG4gICAgICAncmVzdC5hY3Rpb24ubXVsdGkuYWxsb3dfZXhwbGljaXRfaW5kZXgnOiAndHJ1ZSdcbiAgICB9KTtcblxuICAgIC8vIE1hc3RlciB1c2VyIG9wdGlvbnMgYXJlIGhhbmRsZWQgaW4gQWR2YW5jZWRTZWN1cml0eU9wdGlvbnNcblxuICAgIC8vIFNlY3VyaXR5IGdyb3VwcyBhcmUgaGFuZGxlZCBieSB0aGUgRG9tYWluIGNvbnN0cnVjdFxuICAgIC8vIEFkZCBjb21wcmVoZW5zaXZlIGFjY2VzcyBwb2xpY3kgZm9yIEZpcmVob3NlIHJvbGUsIHNlcnZpY2UsIGFuZCBhdXRoZW50aWNhdGVkIHVzZXJzXG4gICAgY2ZuRG9tYWluLmFkZFByb3BlcnR5T3ZlcnJpZGUoJ0FjY2Vzc1BvbGljaWVzJywge1xuICAgICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxuICAgICAgU3RhdGVtZW50OiBbXG4gICAgICAgIHtcbiAgICAgICAgICBTaWQ6ICdBbGxvd0ZpcmVob3NlUm9sZUFjY2VzcycsXG4gICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgICAgIFByaW5jaXBhbDoge1xuICAgICAgICAgICAgQVdTOiB0aGlzLmZpcmVob3NlUm9sZS5yb2xlQXJuXG4gICAgICAgICAgfSxcbiAgICAgICAgICBBY3Rpb246IFtcbiAgICAgICAgICAgICdlczoqJyxcbiAgICAgICAgICAgICdvcGVuc2VhcmNoOionXG4gICAgICAgICAgXSxcbiAgICAgICAgICBSZXNvdXJjZTogYGFybjphd3M6ZXM6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmRvbWFpbi8ke3Byb3BzLmRvbWFpbk5hbWV9LypgXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBTaWQ6ICdBbGxvd0ZpcmVob3NlU2VydmljZUFjY2VzcycsXG4gICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgICAgIFByaW5jaXBhbDoge1xuICAgICAgICAgICAgU2VydmljZTogJ2ZpcmVob3NlLmFtYXpvbmF3cy5jb20nXG4gICAgICAgICAgfSxcbiAgICAgICAgICBBY3Rpb246IFtcbiAgICAgICAgICAgICdlczoqJyxcbiAgICAgICAgICAgICdvcGVuc2VhcmNoOionXG4gICAgICAgICAgXSxcbiAgICAgICAgICBSZXNvdXJjZTogYGFybjphd3M6ZXM6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmRvbWFpbi8ke3Byb3BzLmRvbWFpbk5hbWV9LypgXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBTaWQ6ICdBbGxvd0FsbEFjY2VzcycsXG4gICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgICAgIFByaW5jaXBhbDoge1xuICAgICAgICAgICAgQVdTOiAnKidcbiAgICAgICAgICB9LFxuICAgICAgICAgIEFjdGlvbjogW1xuICAgICAgICAgICAgJ2VzOionLFxuICAgICAgICAgICAgJ29wZW5zZWFyY2g6KidcbiAgICAgICAgICBdLFxuICAgICAgICAgIFJlc291cmNlOiBgYXJuOmF3czplczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06ZG9tYWluLyR7cHJvcHMuZG9tYWluTmFtZX0vKmBcbiAgICAgICAgfVxuICAgICAgXVxuICAgIH0pO1xuICAgIFxuICAgIGNmbkRvbWFpbi5jZm5PcHRpb25zLnVwZGF0ZVJlcGxhY2VQb2xpY3kgPSBDZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XG4gICAgY2ZuRG9tYWluLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBDZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XG5cbiAgICB0aGlzLmRvbWFpbkVuZHBvaW50ID0gZG9tYWluLmRvbWFpbkVuZHBvaW50O1xuICAgIHRoaXMuZG9tYWluID0gZG9tYWluO1xuXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBmdW5jdGlvbiBmb3IgT3BlblNlYXJjaCByb2xlIG1hcHBpbmdcbiAgICBjb25zdCByb2xlTWFwcGluZ0xhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ09wZW5TZWFyY2hSb2xlTWFwcGluZ0xhbWJkYScsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzksXG4gICAgICBoYW5kbGVyOiAnb3BlbnNlYXJjaC1yb2xlLW1hcHBlci5sYW1iZGFfaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2xhbWJkYScpKSxcbiAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLm1pbnV0ZXMoMTApLFxuICAgICAgZGVzY3JpcHRpb246ICdDb25maWd1cmVzIE9wZW5TZWFyY2ggcm9sZSBtYXBwaW5nIGZvciBGaXJlaG9zZSBpbnRlZ3JhdGlvbicsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBMT0dfTEVWRUw6ICdJTkZPJ1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBmdW5jdGlvbiBmb3IgT3BlblNlYXJjaCBpbmRleCBtYW5hZ2VtZW50XG4gICAgY29uc3QgaW5kZXhNYW5hZ2VyTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnT3BlblNlYXJjaEluZGV4TWFuYWdlckxhbWJkYScsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzksXG4gICAgICBoYW5kbGVyOiAnb3BlbnNlYXJjaC1pbmRleC1tYW5hZ2VyLmxhbWJkYV9oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vbGFtYmRhJykpLFxuICAgICAgdGltZW91dDogRHVyYXRpb24ubWludXRlcygxMCksXG4gICAgICBkZXNjcmlwdGlvbjogJ01hbmFnZXMgT3BlblNlYXJjaCBpbmRpY2VzIGFuZCB0ZW1wbGF0ZXMgZm9yIGVrcy1sb2dzIGFuZCBwb2QtbG9ncycsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBMT0dfTEVWRUw6ICdJTkZPJyxcbiAgICAgICAgRE9NQUlOX0VORFBPSU5UOiBkb21haW4uZG9tYWluRW5kcG9pbnQsXG4gICAgICAgIE1BU1RFUl9VU0VSOiAnYWRtaW4nLFxuICAgICAgICBNQVNURVJfUEFTU1dPUkQ6ICdBZG1pbkBPcGVuU2VhcmNoMTIzISdcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIEdyYW50IHRoZSBMYW1iZGEgcGVybWlzc2lvbnMgdG8gYmUgaW52b2tlZCBieSBDbG91ZEZvcm1hdGlvbiBjdXN0b20gcmVzb3VyY2VzXG4gICAgcm9sZU1hcHBpbmdMYW1iZGEuYWRkUGVybWlzc2lvbignQWxsb3dDdXN0b21SZXNvdXJjZUludm9rZScsIHtcbiAgICAgIHByaW5jaXBhbDogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdjbG91ZGZvcm1hdGlvbi5hbWF6b25hd3MuY29tJyksXG4gICAgICBhY3Rpb246ICdsYW1iZGE6SW52b2tlRnVuY3Rpb24nXG4gICAgfSk7XG5cbiAgICBpbmRleE1hbmFnZXJMYW1iZGEuYWRkUGVybWlzc2lvbignQWxsb3dDdXN0b21SZXNvdXJjZUludm9rZScsIHtcbiAgICAgIHByaW5jaXBhbDogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdjbG91ZGZvcm1hdGlvbi5hbWF6b25hd3MuY29tJyksXG4gICAgICBhY3Rpb246ICdsYW1iZGE6SW52b2tlRnVuY3Rpb24nXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBMYW1iZGEgZnVuY3Rpb25zIE9wZW5TZWFyY2ggYWNjZXNzIHBlcm1pc3Npb25zXG4gICAgcm9sZU1hcHBpbmdMYW1iZGEuYWRkVG9Sb2xlUG9saWN5KG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdlczoqJyxcbiAgICAgICAgJ29wZW5zZWFyY2g6KidcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6ZXM6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmRvbWFpbi8ke3Byb3BzLmRvbWFpbk5hbWV9YCxcbiAgICAgICAgYGFybjphd3M6ZXM6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmRvbWFpbi8ke3Byb3BzLmRvbWFpbk5hbWV9LypgLFxuICAgICAgICBgYXJuOmF3czpvcGVuc2VhcmNoOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpkb21haW4vJHtwcm9wcy5kb21haW5OYW1lfWAsXG4gICAgICAgIGBhcm46YXdzOm9wZW5zZWFyY2g6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmRvbWFpbi8ke3Byb3BzLmRvbWFpbk5hbWV9LypgXG4gICAgICBdXG4gICAgfSkpO1xuXG4gICAgaW5kZXhNYW5hZ2VyTGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnZXM6KicsXG4gICAgICAgICdvcGVuc2VhcmNoOionXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIGBhcm46YXdzOmVzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpkb21haW4vJHtwcm9wcy5kb21haW5OYW1lfWAsXG4gICAgICAgIGBhcm46YXdzOmVzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpkb21haW4vJHtwcm9wcy5kb21haW5OYW1lfS8qYCxcbiAgICAgICAgYGFybjphd3M6b3BlbnNlYXJjaDoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06ZG9tYWluLyR7cHJvcHMuZG9tYWluTmFtZX1gLFxuICAgICAgICBgYXJuOmF3czpvcGVuc2VhcmNoOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpkb21haW4vJHtwcm9wcy5kb21haW5OYW1lfS8qYFxuICAgICAgXVxuICAgIH0pKTtcblxuICAgIC8vIEdyYW50IExhbWJkYSBmdW5jdGlvbnMgYmFzaWMgZXhlY3V0aW9uIHBlcm1pc3Npb25zXG4gICAgcm9sZU1hcHBpbmdMYW1iZGEuYWRkVG9Sb2xlUG9saWN5KG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcbiAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJywgXG4gICAgICAgICdsb2dzOlB1dExvZ0V2ZW50cydcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fToqYF1cbiAgICB9KSk7XG5cbiAgICBpbmRleE1hbmFnZXJMYW1iZGEuYWRkVG9Sb2xlUG9saWN5KG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcbiAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJyxcbiAgICAgICAgJ2xvZ3M6UHV0TG9nRXZlbnRzJ1xuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OipgXVxuICAgIH0pKTtcblxuICAgIC8vIENyZWF0ZSBDdXN0b21SZXNvdXJjZSBwcm92aWRlciBmb3Igcm9sZSBtYXBwaW5nXG4gICAgY29uc3Qgcm9sZU1hcHBpbmdQcm92aWRlciA9IG5ldyBjci5Qcm92aWRlcih0aGlzLCAnT3BlblNlYXJjaFJvbGVNYXBwaW5nUHJvdmlkZXInLCB7XG4gICAgICBvbkV2ZW50SGFuZGxlcjogcm9sZU1hcHBpbmdMYW1iZGFcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBDdXN0b21SZXNvdXJjZSB0byBpbnZva2UgdGhlIExhbWJkYVxuICAgIGNvbnN0IHJvbGVNYXBwaW5nUmVzb3VyY2UgPSBuZXcgQ3VzdG9tUmVzb3VyY2UodGhpcywgJ09wZW5TZWFyY2hSb2xlTWFwcGluZycsIHtcbiAgICAgIHNlcnZpY2VUb2tlbjogcm9sZU1hcHBpbmdQcm92aWRlci5zZXJ2aWNlVG9rZW4sXG4gICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgIGRvbWFpbkVuZHBvaW50OiBkb21haW4uZG9tYWluRW5kcG9pbnQsXG4gICAgICAgIGZpcmVob3NlUm9sZUFybjogdGhpcy5maXJlaG9zZVJvbGUucm9sZUFybixcbiAgICAgICAgbWFzdGVyVXNlcjogJ2FkbWluJyxcbiAgICAgICAgbWFzdGVyUGFzc3dvcmQ6ICdBZG1pbkBPcGVuU2VhcmNoMTIzIScgLy8gSW4gcHJvZHVjdGlvbiwgdXNlIFNlY3JldHMgTWFuYWdlclxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gRW5zdXJlIHRoZSBjdXN0b20gcmVzb3VyY2UgcnVucyBhZnRlciB0aGUgZG9tYWluIGlzIGNyZWF0ZWRcbiAgICByb2xlTWFwcGluZ1Jlc291cmNlLm5vZGUuYWRkRGVwZW5kZW5jeShkb21haW4pO1xuXG4gICAgLy8gQ3JlYXRlIEN1c3RvbVJlc291cmNlIHByb3ZpZGVyIGZvciBpbmRleCB0ZW1wbGF0ZXNcbiAgICBjb25zdCBpbmRleFRlbXBsYXRlUHJvdmlkZXIgPSBuZXcgY3IuUHJvdmlkZXIodGhpcywgJ09wZW5TZWFyY2hJbmRleFRlbXBsYXRlUHJvdmlkZXInLCB7XG4gICAgICBvbkV2ZW50SGFuZGxlcjogaW5kZXhNYW5hZ2VyTGFtYmRhXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgQ3VzdG9tUmVzb3VyY2UgZm9yIGluZGV4IHRlbXBsYXRlc1xuICAgIGNvbnN0IGluZGV4VGVtcGxhdGVNYW5hZ2VyUmVzb3VyY2UgPSBuZXcgQ3VzdG9tUmVzb3VyY2UodGhpcywgJ09wZW5TZWFyY2hJbmRleFRlbXBsYXRlTWFuYWdlcicsIHtcbiAgICAgIHNlcnZpY2VUb2tlbjogaW5kZXhUZW1wbGF0ZVByb3ZpZGVyLnNlcnZpY2VUb2tlbixcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlX3RlbXBsYXRlcycsXG4gICAgICAgIGRvbWFpbkVuZHBvaW50OiBkb21haW4uZG9tYWluRW5kcG9pbnQsXG4gICAgICAgIG1hc3RlclVzZXI6ICdhZG1pbicsXG4gICAgICAgIG1hc3RlclBhc3N3b3JkOiAnQWRtaW5AT3BlblNlYXJjaDEyMyEnXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgQ3VzdG9tUmVzb3VyY2UgcHJvdmlkZXIgZm9yIGluZGV4IGNyZWF0aW9uXG4gICAgY29uc3QgaW5kZXhDcmVhdG9yUHJvdmlkZXIgPSBuZXcgY3IuUHJvdmlkZXIodGhpcywgJ09wZW5TZWFyY2hJbmRleENyZWF0b3JQcm92aWRlcicsIHtcbiAgICAgIG9uRXZlbnRIYW5kbGVyOiBpbmRleE1hbmFnZXJMYW1iZGFcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBDdXN0b21SZXNvdXJjZSBmb3IgaW5pdGlhbCBpbmRpY2VzXG4gICAgY29uc3QgaW5kZXhDcmVhdG9yUmVzb3VyY2UgPSBuZXcgQ3VzdG9tUmVzb3VyY2UodGhpcywgJ09wZW5TZWFyY2hJbmRleENyZWF0b3InLCB7XG4gICAgICBzZXJ2aWNlVG9rZW46IGluZGV4Q3JlYXRvclByb3ZpZGVyLnNlcnZpY2VUb2tlbixcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlX2luZGljZXMnLFxuICAgICAgICBkb21haW5FbmRwb2ludDogZG9tYWluLmRvbWFpbkVuZHBvaW50LFxuICAgICAgICBtYXN0ZXJVc2VyOiAnYWRtaW4nLFxuICAgICAgICBtYXN0ZXJQYXNzd29yZDogJ0FkbWluQE9wZW5TZWFyY2gxMjMhJ1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gRW5zdXJlIHRoZSBpbmRleCB0ZW1wbGF0ZSBtYW5hZ2VyIHJ1bnMgYWZ0ZXIgcm9sZSBtYXBwaW5nIGlzIGNvbXBsZXRlXG4gICAgaW5kZXhUZW1wbGF0ZU1hbmFnZXJSZXNvdXJjZS5ub2RlLmFkZERlcGVuZGVuY3kocm9sZU1hcHBpbmdSZXNvdXJjZSk7XG4gICAgXG4gICAgLy8gRW5zdXJlIHRoZSBpbmRleCBjcmVhdG9yIHJ1bnMgYWZ0ZXIgdGVtcGxhdGVzIGFyZSBjcmVhdGVkXG4gICAgaW5kZXhDcmVhdG9yUmVzb3VyY2Uubm9kZS5hZGREZXBlbmRlbmN5KGluZGV4VGVtcGxhdGVNYW5hZ2VyUmVzb3VyY2UpO1xuXG4gICAgLy8gRXhwb3J0IHRoZSBGaXJlaG9zZSByb2xlIEFSTiBhbmQgbmFtZSBmb3IgdXNlIGJ5IG90aGVyIHN0YWNrc1xuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgJ0ZpcmVob3NlUm9sZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmZpcmVob3NlUm9sZS5yb2xlQXJuLFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LUZpcmVob3NlUm9sZUFybmAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FSTiBvZiB0aGUgRmlyZWhvc2Ugcm9sZSBmb3IgT3BlblNlYXJjaCBhY2Nlc3MnXG4gICAgfSk7XG5cbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsICdGaXJlaG9zZVJvbGVOYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMuZmlyZWhvc2VSb2xlLnJvbGVOYW1lLFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LUZpcmVob3NlUm9sZU5hbWVgLFxuICAgICAgZGVzY3JpcHRpb246ICdOYW1lIG9mIHRoZSBGaXJlaG9zZSByb2xlIGZvciBPcGVuU2VhcmNoIGFjY2VzcydcbiAgICB9KTtcblxuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgJ09wZW5TZWFyY2hSb2xlTWFwcGluZ1N0YXR1cycsIHtcbiAgICAgIHZhbHVlOiByb2xlTWFwcGluZ1Jlc291cmNlLmdldEF0dCgnYm9keScpLnRvU3RyaW5nKCksXG4gICAgICBkZXNjcmlwdGlvbjogJ1N0YXR1cyBvZiBPcGVuU2VhcmNoIHJvbGUgbWFwcGluZyBjb25maWd1cmF0aW9uJ1xuICAgIH0pO1xuXG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCAnT3BlblNlYXJjaEluZGV4VGVtcGxhdGVTdGF0dXMnLCB7XG4gICAgICB2YWx1ZTogaW5kZXhUZW1wbGF0ZU1hbmFnZXJSZXNvdXJjZS5nZXRBdHQoJ2JvZHknKS50b1N0cmluZygpLFxuICAgICAgZGVzY3JpcHRpb246ICdTdGF0dXMgb2YgT3BlblNlYXJjaCBpbmRleCB0ZW1wbGF0ZSBjcmVhdGlvbiBmb3IgZWtzLWxvZ3MgYW5kIHBvZC1sb2dzJ1xuICAgIH0pO1xuXG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCAnT3BlblNlYXJjaEluZGV4Q3JlYXRpb25TdGF0dXMnLCB7XG4gICAgICB2YWx1ZTogaW5kZXhDcmVhdG9yUmVzb3VyY2UuZ2V0QXR0KCdib2R5JykudG9TdHJpbmcoKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3RhdHVzIG9mIE9wZW5TZWFyY2ggaW5kZXggY3JlYXRpb24gZm9yIGVrcy1sb2dzIGFuZCBwb2QtbG9ncydcbiAgICB9KTtcblxuICAgIC8vIEV4cG9ydCB0aGUgQ2xvdWRXYXRjaCBMb2dzIHJvbGUgQVJOIGFuZCBuYW1lIGZvciB1c2UgYnkgb3RoZXIgc3RhY2tzXG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCAnQ2xvdWRXYXRjaExvZ3NSb2xlQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuY2xvdWR3YXRjaExvZ3NSb2xlLnJvbGVBcm4sXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tQ2xvdWRXYXRjaExvZ3NSb2xlQXJuYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBDbG91ZFdhdGNoIExvZ3Mgcm9sZSBmb3IgRmlyZWhvc2UgYWNjZXNzJ1xuICAgIH0pO1xuXG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCAnQ2xvdWRXYXRjaExvZ3NSb2xlTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmNsb3Vkd2F0Y2hMb2dzUm9sZS5yb2xlTmFtZSxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1DbG91ZFdhdGNoTG9nc1JvbGVOYW1lYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTmFtZSBvZiB0aGUgQ2xvdWRXYXRjaCBMb2dzIHJvbGUgZm9yIEZpcmVob3NlIGFjY2VzcydcbiAgICB9KTtcbiAgfVxufSJdfQ==