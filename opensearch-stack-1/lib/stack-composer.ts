import {Construct} from "constructs";
import {Stack, StackProps} from "aws-cdk-lib";
import {OpenSearchDomainStack} from "./opensearch-domain-stack";
import {NetworkStack} from "./network-stack";
import {KinesisFirehoseStack} from "./kinesis-firehose-stack";
import {ConfigManager, StackConfiguration, ParsedOpenSearchConfig, ServiceLogConfig} from "./config";
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

        // Create service-specific Firehose stacks
        this.createServiceFirehoseStacks(scope, config, opensearchStack, parsedConfig, props);
    }

    private createServiceFirehoseStacks(
        scope: Construct, 
        config: StackConfiguration, 
        opensearchStack: OpenSearchDomainStack, 
        parsedConfig: ParsedOpenSearchConfig, 
        props: StackPropsExt
    ): void {
        // Handle new service-based configuration
        if (config.logs.services) {
            Object.entries(config.logs.services).forEach(([serviceName, serviceConfig]) => {
                if (serviceConfig.enabled !== false) {
                    this.createFirehoseStack(
                        scope,
                        serviceName,
                        serviceConfig,
                        opensearchStack,
                        parsedConfig.domainName,
                        props
                    );
                }
            });
        }

        // Backward compatibility: Handle legacy EKS and Pod configurations
        if (config.logs.eksLogGroupName) {
            this.createFirehoseStack(
                scope,
                'eks',
                {
                    logGroupName: config.logs.eksLogGroupName,
                    indexName: 'eks-logs',
                    processorType: 'eks'
                },
                opensearchStack,
                parsedConfig.domainName,
                props
            );
        }

        if (config.logs.podLogGroupName) {
            this.createFirehoseStack(
                scope,
                'pod',
                {
                    logGroupName: config.logs.podLogGroupName,
                    indexName: 'pod-logs',
                    processorType: 'pod'
                },
                opensearchStack,
                parsedConfig.domainName,
                props
            );
        }
    }

    private createFirehoseStack(
        scope: Construct,
        serviceName: string,
        serviceConfig: ServiceLogConfig,
        opensearchStack: OpenSearchDomainStack,
        domainName: string,
        props: StackPropsExt
    ): void {
        const firehoseStack = new KinesisFirehoseStack(scope, `kinesisFirehose${this.capitalizeFirst(serviceName)}Stack`, {
            opensearchDomain: opensearchStack.domain,
            opensearchIndex: serviceConfig.indexName,
            opensearchStackName: opensearchStack.stackName,
            serviceLogGroupName: serviceConfig.logGroupName,
            serviceName: serviceName,
            processorType: serviceConfig.processorType,
            stackName: `KinesisFirehose${this.capitalizeFirst(serviceName)}CDKStack-${domainName}`,
            description: `This stack contains Kinesis Data Firehose delivery streams for ${serviceName} logs`,
            ...props,
        });
        this.stacks.push(firehoseStack);
    }

    private capitalizeFirst(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}