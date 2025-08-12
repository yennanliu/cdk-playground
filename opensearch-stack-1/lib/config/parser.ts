import { Construct } from "constructs";
import { RawConfigDefaults, StackConfiguration } from "./types";
import { ConfigValidator } from "./validator";

export class ConfigParser {
    
    static parse(scope: Construct, stage: string, defaults: RawConfigDefaults): StackConfiguration {
        const validator = new ConfigValidator();
        
        const domainName = this.getContextForType(scope, 'domainName', 'string', defaults);
        const engineVersion = this.getContextForType(scope, 'engineVersion', 'string', defaults);
        const dataNodeType = this.getContextForType(scope, 'dataNodeType', 'string', defaults);
        const dataNodeCount = this.getContextForType(scope, 'dataNodeCount', 'number', defaults);
        const dedicatedManagerNodeType = this.getContextForType(scope, 'dedicatedManagerNodeType', 'string', defaults);
        const dedicatedManagerNodeCount = this.getContextForType(scope, 'dedicatedManagerNodeCount', 'number', defaults);
        const warmNodeType = this.getContextForType(scope, 'warmNodeType', 'string', defaults);
        const warmNodeCount = this.getContextForType(scope, 'warmNodeCount', 'number', defaults);
        const ebsEnabled = this.getContextForType(scope, 'ebsEnabled', 'boolean', defaults);
        const ebsIops = this.getContextForType(scope, 'ebsIops', 'number', defaults);
        const ebsVolumeSize = this.getContextForType(scope, 'ebsVolumeSize', 'number', defaults);
        const ebsVolumeType = this.getContextForType(scope, 'ebsVolumeType', 'string', defaults);
        const vpcEnabled = this.getContextForType(scope, 'vpcEnabled', 'boolean', defaults);
        const vpcId = this.getContextForType(scope, 'vpcId', 'string', defaults);
        const vpcSubnetIds = this.getContextForType(scope, 'vpcSubnetIds', 'object', defaults);
        const vpcSecurityGroupIds = this.getContextForType(scope, 'vpcSecurityGroupIds', 'object', defaults);
        const availabilityZoneCount = this.getContextForType(scope, 'availabilityZoneCount', 'number', defaults);
        const eksLogGroupName = this.getContextForType(scope, 'eksLogGroupName', 'string', defaults);
        const podLogGroupName = this.getContextForType(scope, 'podLogGroupName', 'string', defaults);
        const appTypeConfigs = this.getContextForType(scope, 'appTypeConfigs', 'object', defaults);

        validator.validateRequired(domainName, 'domainName');
        validator.validateEngineVersion(engineVersion);
        validator.validateEbsVolumeType(ebsVolumeType);

        // Build appTypeConfigs dynamically from context parameters if not provided explicitly
        let finalAppTypeConfigs = appTypeConfigs || [];
        
        // If appTypeConfigs is empty but we have individual log group names, create configs dynamically
        if ((!finalAppTypeConfigs || finalAppTypeConfigs.length === 0) && (eksLogGroupName || podLogGroupName)) {
            finalAppTypeConfigs = [];
            
            if (eksLogGroupName) {
                finalAppTypeConfigs.push({
                    appType: 'eks_app',
                    logGroups: [eksLogGroupName],
                    transformationModule: 'eks-processor'
                });
            }
            
            if (podLogGroupName) {
                finalAppTypeConfigs.push({
                    appType: 'pod_app',
                    logGroups: [podLogGroupName],
                    transformationModule: 'pod-processor'
                });
            }
        }

        return {
            openSearch: {
                domainName: domainName!,
                engineVersion: engineVersion!,
                dataNodeType: dataNodeType || 't3.small.search',
                dataNodeCount: dataNodeCount || 1,
                dedicatedManagerNodeType,
                dedicatedManagerNodeCount,
                warmNodeType,
                warmNodeCount,
                ebsEnabled: ebsEnabled !== undefined ? ebsEnabled : true,
                ebsIops,
                ebsVolumeSize: ebsVolumeSize || 10,
                ebsVolumeType,
                availabilityZoneCount: availabilityZoneCount || 1,
            },
            network: {
                vpcEnabled: vpcEnabled || false,
                vpcId,
                vpcSubnetIds,
                vpcSecurityGroupIds,
                availabilityZoneCount: availabilityZoneCount || 1,
            },
            logs: {
                eksLogGroupName,
                podLogGroupName,
                appTypeConfigs: finalAppTypeConfigs,
            },
            stage,
        };
    }

    private static getContextForType(
        scope: Construct, 
        optionName: string, 
        expectedType: string, 
        defaultValues: RawConfigDefaults
    ): any {
        const option = scope.node.tryGetContext(optionName);

        // If no context is provided (undefined or empty string) and a default value exists, use it
        if ((option === undefined || option === "") && defaultValues[optionName as keyof RawConfigDefaults]) {
            return defaultValues[optionName as keyof RawConfigDefaults];
        }

        // Filter out invalid or missing options by setting undefined (empty strings, null, undefined, NaN)
        if (option !== false && option !== 0 && !option) {
            return undefined;
        }

        // Values provided by the CLI will always be represented as a string and need to be parsed
        if (typeof option === 'string') {
            if (expectedType === 'number') {
                const parsed = parseInt(option);
                if (isNaN(parsed)) {
                    throw new Error(`Invalid number format for ${optionName}: ${option}`);
                }
                return parsed;
            }
            if (expectedType === 'boolean' || expectedType === 'object') {
                try {
                    return JSON.parse(option);
                } catch (error) {
                    throw new Error(`Invalid JSON format for ${optionName}: ${option}`);
                }
            }
        }

        // Values provided by the cdk.context.json should be of the desired type
        if (typeof option !== expectedType) {
            throw new Error(`Type provided by cdk.context.json for ${optionName} was ${typeof option} but expected ${expectedType}`);
        }

        return option;
    }
}