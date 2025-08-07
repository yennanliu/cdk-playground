import {Construct} from "constructs";
import {EbsDeviceVolumeType, ISecurityGroup, IVpc, SubnetSelection} from "aws-cdk-lib/aws-ec2";
import {CfnDomain, Domain, EngineVersion, ZoneAwarenessConfig} from "aws-cdk-lib/aws-opensearchservice";
import {CfnDeletionPolicy, RemovalPolicy, Stack, CfnOutput, Duration, CustomResource} from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import {PolicyStatement, Effect} from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cr from "aws-cdk-lib/custom-resources";
import {AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId} from "aws-cdk-lib/custom-resources";
import {StackPropsExt} from "./stack-composer";
import {LoggingRoles} from "./constructs/iam-roles";
import * as path from "path";

export interface OpenSearchDomainStackProps extends StackPropsExt {
  readonly version: EngineVersion,
  readonly domainName: string,
  readonly dataNodeInstanceType?: string,
  readonly dataNodes?: number,
  readonly dedicatedManagerNodeType?: string,
  readonly dedicatedManagerNodeCount?: number,
  readonly warmInstanceType?: string,
  readonly warmNodes?: number
  readonly ebsEnabled?: boolean,
  readonly ebsIops?: number,
  readonly ebsVolumeSize?: number,
  readonly ebsVolumeType?: EbsDeviceVolumeType,
  readonly vpc?: IVpc,
  readonly vpcSubnets?: SubnetSelection[],
  readonly vpcSecurityGroups?: ISecurityGroup[],
  readonly availabilityZoneCount?: number,
  readonly accessPolicies?: PolicyStatement[],
  readonly useUnsignedBasicAuth?: boolean,
  readonly fineGrainedManagerUserARN?: string,
  readonly fineGrainedManagerUserName?: string,
  readonly fineGrainedManagerUserSecretManagerKeyARN?: string,
  readonly enforceHTTPS?: boolean,
  readonly encryptionAtRestEnabled?: boolean
}

export class OpenSearchDomainStack extends Stack {
  public readonly domainEndpoint: string;
  public readonly domain: Domain;
  public readonly firehoseRole: iam.Role;
  public readonly cloudwatchLogsRole: iam.Role;

  constructor(scope: Construct, id: string, props: OpenSearchDomainStackProps) {
    super(scope, id, props);

    // Create shared IAM roles using the reusable construct
    const loggingRoles = new LoggingRoles(this, 'LoggingRoles', {
      region: this.region,
      account: this.account
    });

    this.firehoseRole = loggingRoles.firehoseRole;
    this.cloudwatchLogsRole = loggingRoles.cloudWatchLogsRole;

    // Map objects from props
    const zoneAwarenessConfig: ZoneAwarenessConfig|undefined = props.availabilityZoneCount && props.availabilityZoneCount >= 2 ?
        {enabled: true, availabilityZoneCount: props.availabilityZoneCount} : undefined;

    // Create domain with security disabled
    const domain = new Domain(this, 'Domain', {
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
      removalPolicy: RemovalPolicy.DESTROY
    });

    // Get the underlying CfnDomain to customize its behavior
    const cfnDomain = domain.node.defaultChild as CfnDomain;
    
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
    
    cfnDomain.cfnOptions.updateReplacePolicy = CfnDeletionPolicy.DELETE;
    cfnDomain.cfnOptions.deletionPolicy = CfnDeletionPolicy.DELETE;

    this.domainEndpoint = domain.domainEndpoint;
    this.domain = domain;

    // Create Lambda function for OpenSearch role mapping
    const roleMappingLambda = new lambda.Function(this, 'OpenSearchRoleMappingLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'opensearch-role-mapper.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: Duration.minutes(10),
      description: 'Configures OpenSearch role mapping for Firehose integration',
      environment: {
        LOG_LEVEL: 'INFO'
      }
    });

    // Grant the Lambda permission to be invoked by CloudFormation custom resources
    roleMappingLambda.addPermission('AllowCustomResourceInvoke', {
      principal: new iam.ServicePrincipal('cloudformation.amazonaws.com'),
      action: 'lambda:InvokeFunction'
    });

    // Create AwsCustomResource to invoke the Lambda
    const roleMappingResource = new AwsCustomResource(this, 'OpenSearchRoleMapping', {
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        physicalResourceId: PhysicalResourceId.of('opensearch-role-mapping'),
        parameters: {
          FunctionName: roleMappingLambda.functionName,
          Payload: JSON.stringify({
            RequestType: 'Create',
            domainEndpoint: domain.domainEndpoint,
            firehoseRoleArn: this.firehoseRole.roleArn,
            masterUser: 'admin',
            masterPassword: 'Admin@OpenSearch123!', // In production, use Secrets Manager
            ResponseURL: 'dummy', // Will be overridden by AwsCustomResource
            StackId: 'dummy',
            RequestId: 'dummy',
            LogicalResourceId: 'OpenSearchRoleMapping'
          })
        }
      },
      onUpdate: {
        service: 'Lambda',
        action: 'invoke',
        physicalResourceId: PhysicalResourceId.of('opensearch-role-mapping'),
        parameters: {
          FunctionName: roleMappingLambda.functionName,
          Payload: JSON.stringify({
            RequestType: 'Update',
            domainEndpoint: domain.domainEndpoint,
            firehoseRoleArn: this.firehoseRole.roleArn,
            masterUser: 'admin',
            masterPassword: 'Admin@OpenSearch123!',
            ResponseURL: 'dummy',
            StackId: 'dummy',
            RequestId: 'dummy',
            LogicalResourceId: 'OpenSearchRoleMapping'
          })
        }
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [roleMappingLambda.functionArn]
        })
      ])
    });

    // Ensure the custom resource runs after the domain is created
    roleMappingResource.node.addDependency(domain);

    // Export the Firehose role ARN and name for use by other stacks
    new CfnOutput(this, 'FirehoseRoleArn', {
      value: this.firehoseRole.roleArn,
      exportName: `${this.stackName}-FirehoseRoleArn`,
      description: 'ARN of the Firehose role for OpenSearch access'
    });

    new CfnOutput(this, 'FirehoseRoleName', {
      value: this.firehoseRole.roleName,
      exportName: `${this.stackName}-FirehoseRoleName`,
      description: 'Name of the Firehose role for OpenSearch access'
    });

    new CfnOutput(this, 'OpenSearchRoleMappingStatus', {
      value: roleMappingResource.getResponseField('Payload'),
      description: 'Status of OpenSearch role mapping configuration'
    });

    // Export the CloudWatch Logs role ARN and name for use by other stacks
    new CfnOutput(this, 'CloudWatchLogsRoleArn', {
      value: this.cloudwatchLogsRole.roleArn,
      exportName: `${this.stackName}-CloudWatchLogsRoleArn`,
      description: 'ARN of the CloudWatch Logs role for Firehose access'
    });

    new CfnOutput(this, 'CloudWatchLogsRoleName', {
      value: this.cloudwatchLogsRole.roleName,
      exportName: `${this.stackName}-CloudWatchLogsRoleName`,
      description: 'Name of the CloudWatch Logs role for Firehose access'
    });
  }
}