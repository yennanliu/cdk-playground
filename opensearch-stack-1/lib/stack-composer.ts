import {Construct} from "constructs";
import {Stack, StackProps} from "aws-cdk-lib";
import {OpenSearchDomainStack} from "./opensearch-domain-stack";
import {NetworkStack} from "./network-stack";
import {KinesisFirehoseStack} from "./kinesis-firehose-stack";
import {ConfigManager, StackConfiguration, ParsedOpenSearchConfig} from "./config";
import {ConfigValidator} from "./config/validator";

export interface StackPropsExt extends StackProps {
    readonly stage: string
}

export class StackComposer {
    public stacks: Stack[] = [];

    constructor(scope: Construct, props: StackPropsExt) {
        const config = ConfigManager.loadConfiguration(scope, props.stage);
        const validator = new ConfigValidator();
        const parsedConfig = validator.validateAndTransformConfig(config);
        
        let networkStack: NetworkStack | undefined;

        // If enabled re-use existing VPC and/or associated resources or create new
        if (config.network.vpcEnabled) {
            networkStack = new NetworkStack(scope, 'networkStack', {
                vpcId: config.network.vpcId,
                vpcSubnetIds: config.network.vpcSubnetIds,
                vpcSecurityGroupIds: config.network.vpcSecurityGroupIds,
                availabilityZoneCount: config.network.availabilityZoneCount,
                stackName: `OSServiceNetworkCDKStack-${config.openSearch.domainName}`,
                description: "This stack contains resources to create/manage networking for an OpenSearch Service domain",
                ...props,
            })
            this.stacks.push(networkStack)
        }

        const opensearchStack = new OpenSearchDomainStack(scope, 'opensearchServiceDomainCdkStack', {
            version: parsedConfig.version,
            domainName: parsedConfig.domainName,
            dataNodeInstanceType: parsedConfig.dataNodeType,
            dataNodes: parsedConfig.dataNodeCount,
            dedicatedManagerNodeType: parsedConfig.dedicatedManagerNodeType,
            dedicatedManagerNodeCount: parsedConfig.dedicatedManagerNodeCount,
            warmInstanceType: parsedConfig.warmNodeType,
            warmNodes: parsedConfig.warmNodeCount,
            ebsEnabled: parsedConfig.ebsEnabled,
            ebsIops: parsedConfig.ebsIops,
            ebsVolumeSize: parsedConfig.ebsVolumeSize,
            ebsVolumeType: parsedConfig.ebsVolumeType,
            vpc: networkStack ? networkStack.vpc : undefined,
            vpcSubnets: networkStack ? networkStack.domainSubnets : undefined,
            vpcSecurityGroups: networkStack ? networkStack.domainSecurityGroups : undefined,
            availabilityZoneCount: parsedConfig.availabilityZoneCount,
            stackName: `OSServiceDomainCDKStack-${parsedConfig.domainName}`,
            description: "This stack contains an OpenSearch Service domain",
            ...props,
        })
        this.stacks.push(opensearchStack)

        // Create EKS logs Firehose stack if EKS log group is configured
        if (config.logs.eksLogGroupName) {
            const eksFirehoseStack = new KinesisFirehoseStack(scope, 'kinesisFirehoseEksStack', {
                opensearchDomain: opensearchStack.domain,
                opensearchIndex: 'eks-logs',
                opensearchStackName: opensearchStack.stackName,
                eksLogGroupName: config.logs.eksLogGroupName,
                stackName: `KinesisFirehoseEKSCDKStack-${parsedConfig.domainName}`,
                description: "This stack contains Kinesis Data Firehose delivery streams for EKS logs",
                ...props,
            })
            this.stacks.push(eksFirehoseStack)
        }

        // Create Pod logs Firehose stack if Pod log group is configured  
        if (config.logs.podLogGroupName) {
            const podFirehoseStack = new KinesisFirehoseStack(scope, 'kinesisFirehosePodStack', {
                opensearchDomain: opensearchStack.domain,
                opensearchIndex: 'pod-logs',
                opensearchStackName: opensearchStack.stackName,
                eksLogGroupName: config.logs.podLogGroupName, // Reuse the same parameter name but for pod logs
                stackName: `KinesisFirehosePodCDKStack-${parsedConfig.domainName}`,
                description: "This stack contains Kinesis Data Firehose delivery streams for Pod logs",
                ...props,
            })
            this.stacks.push(podFirehoseStack)
        }
    }
}