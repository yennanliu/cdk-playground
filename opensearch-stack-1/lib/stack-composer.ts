import {Construct} from "constructs";
import {Stack, StackProps} from "aws-cdk-lib";
import {OpenSearchDomainStack} from "./opensearch-domain-stack";
import {NetworkStack} from "./network-stack";
import {KinesisFirehoseStack} from "./kinesis-firehose-stack";
import {ServiceDiscoveryStack} from "./automation/service-discovery-stack";
import {ServiceApiStack} from "./automation/service-api-stack";
import {MonitoringStack} from "./automation/monitoring-stack";
import {ConfigManager, StackConfiguration, ParsedOpenSearchConfig, ServiceLogConfig} from "./config";
import {ConfigValidator} from "./config/validator";

export interface StackPropsExt extends StackProps {
    readonly stage: string;
    readonly enableAutomation?: boolean;  // Enable service discovery and automation
    readonly notificationEmail?: string;  // Email for alerts
    readonly slackWebhook?: string;       // Slack webhook for notifications
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
        
        // Create automation stacks if enabled
        if (props.enableAutomation !== false) {
            this.createAutomationStacks(scope, opensearchStack, parsedConfig, props);
        }
    }

    private createServiceFirehoseStacks(
        scope: Construct, 
        config: StackConfiguration, 
        opensearchStack: OpenSearchDomainStack, 
        parsedConfig: ParsedOpenSearchConfig, 
        props: StackPropsExt
    ): void {
        // Create Firehose stacks for all configured services
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

    private createAutomationStacks(
        scope: Construct, 
        opensearchStack: OpenSearchDomainStack, 
        parsedConfig: ParsedOpenSearchConfig, 
        props: StackPropsExt
    ): void {
        // Create service discovery and automation stack
        const serviceDiscoveryStack = new ServiceDiscoveryStack(scope, 'serviceDiscoveryStack', {
            opensearchDomainName: parsedConfig.domainName,
            stackName: `OpenSearchServiceDiscoveryCDKStack-${parsedConfig.domainName}`,
            description: "This stack contains service discovery and onboarding automation for OpenSearch logging",
            ...props,
        });
        this.stacks.push(serviceDiscoveryStack);

        // Create self-service API stack
        const serviceApiStack = new ServiceApiStack(scope, 'serviceApiStack', {
            serviceRegistry: serviceDiscoveryStack.serviceRegistry,
            onboardingQueue: serviceDiscoveryStack.onboardingQueue,
            opensearchDomainName: parsedConfig.domainName,
            stackName: `OpenSearchServiceAPICDKStack-${parsedConfig.domainName}`,
            description: "This stack contains the self-service API for OpenSearch service management",
            ...props,
        });
        this.stacks.push(serviceApiStack);

        // Create monitoring stack
        const monitoringStack = new MonitoringStack(scope, 'monitoringStack', {
            serviceRegistry: serviceDiscoveryStack.serviceRegistry,
            onboardingQueue: serviceDiscoveryStack.onboardingQueue,
            opensearchDomainName: parsedConfig.domainName,
            notificationEmail: props.notificationEmail,
            slackWebhook: props.slackWebhook,
            stackName: `OpenSearchMonitoringCDKStack-${parsedConfig.domainName}`,
            description: "This stack contains monitoring and alerting for OpenSearch service management",
            ...props,
        });
        this.stacks.push(monitoringStack);
    }
}