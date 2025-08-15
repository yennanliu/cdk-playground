import {Construct} from "constructs";
import {Stack, StackProps} from "aws-cdk-lib";
import {OpenSearchDomainStack} from "./opensearch-domain-stack";
import {NetworkStack} from "./network-stack";
import {KinesisFirehoseAppStack} from "./kinesis-firehose-app-stack";
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
        
        // Set env with the configured region
        const stackPropsWithRegion = {
            ...props,
            env: {
                ...props.env,
                region: config.region
            }
        };
        
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
                ...stackPropsWithRegion,
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
            ...stackPropsWithRegion,
        })
        this.stacks.push(opensearchStack)

        // Create a new Firehose stack for every single app type configuration
        // e.g. KinesisFirehoseEksControlPlaneStack, KinesisFirehoseEksPodStack, KinesisFirehoseMazeStack ..
        config.logs.appTypeConfigs.forEach((appTypeConfig, index) => {
            // Clean app type name for CDK naming (replace underscores with dashes, capitalize words)
            const cleanAppType = appTypeConfig.appType.replace(/_/g, '-');
            const capitalizedAppType = cleanAppType.split('-').map(word => 
                word.charAt(0).toUpperCase() + word.slice(1)
            ).join('');
            
            const appFirehoseStack = new KinesisFirehoseAppStack(scope, `kinesisFirehose${capitalizedAppType}Stack`, {
                opensearchDomain: opensearchStack.domain,
                opensearchStackName: opensearchStack.stackName,
                appTypeConfig: appTypeConfig,
                stackName: `KinesisFirehose${capitalizedAppType}CDKStack-${parsedConfig.domainName}`,
                description: `This stack contains Kinesis Data Firehose delivery streams for ${appTypeConfig.appType} logs`,
                ...stackPropsWithRegion,
            });
            this.stacks.push(appFirehoseStack);
        });
    }
}