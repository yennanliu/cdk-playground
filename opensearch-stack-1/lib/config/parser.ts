import { Construct } from "constructs";
import { RawConfigDefaults, StackConfiguration, AppTypeConfig } from "./types";
import { ConfigValidator } from "./validator";

// App Type Registry Pattern
interface AppTypeRegistryEntry {
    readonly appType: string;
    readonly processor: string;
    readonly contextKey: string;
}

const APP_TYPE_REGISTRY = {
    eks_control_plane_app: { 
        appType: 'eks-control-plane', 
        processor: 'eks-processor', 
        contextKey: 'eksControlPlaneGroup' 
    },
    eks_pod_app: { 
        appType: 'eks-pod', 
        processor: 'pod-processor', 
        contextKey: 'eksPodGroup' 
    },
    maze_app: { 
        appType: 'maze_app', 
        processor: 'maze-processor', 
        contextKey: 'mazeLogGroupName' 
    },
    postgres_app: { 
        appType: 'postgres_app', 
        processor: 'postgres-processor', 
        contextKey: 'postgresLogGroupName' 
    }
} as const satisfies Record<string, AppTypeRegistryEntry>;

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
        const eksControlPlaneGroup = this.getContextForType(scope, 'eksControlPlaneGroup', 'string', defaults);
        const eksPodGroup = this.getContextForType(scope, 'eksPodGroup', 'string', defaults);
        const mazeLogGroupName = this.getContextForType(scope, 'mazeLogGroupName', 'string', defaults);
        const postgresLogGroupName = this.getContextForType(scope, 'postgresLogGroupName', 'string', defaults);
        const appTypeConfigs = this.getContextForType(scope, 'appTypeConfigs', 'object', defaults);

        validator.validateRequired(domainName, 'domainName');
        validator.validateEngineVersion(engineVersion);
        validator.validateEbsVolumeType(ebsVolumeType);

        // Build appTypeConfigs dynamically using registry pattern
        const contextValues = {
            eksControlPlaneGroup,
            eksPodGroup, 
            mazeLogGroupName,
            postgresLogGroupName
        };
        const finalAppTypeConfigs = this.buildAppTypeConfigs(appTypeConfigs, contextValues);

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
                eksControlPlaneGroup,
                eksPodGroup,
                mazeLogGroupName,
                postgresLogGroupName,
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

    /**
     * Build app type configurations using the registry pattern
     * @param existingConfigs - Existing app type configurations from context
     * @param contextValues - Individual log group names from context
     * @returns Array of app type configurations
     */
    private static buildAppTypeConfigs(
        existingConfigs: AppTypeConfig[] | undefined, 
        contextValues: Record<string, string | undefined>
    ): AppTypeConfig[] {
        let finalConfigs = existingConfigs || [];
        
        // Check if any individual log group names are provided
        const hasIndividualLogGroups = Object.values(contextValues).some(value => value !== undefined);
        
        if (hasIndividualLogGroups) {
            // If no existing configs, start with empty array
            if (!finalConfigs || finalConfigs.length === 0) {
                finalConfigs = [];
            }
            
            // Process each app type in the registry
            Object.values(APP_TYPE_REGISTRY).forEach(registryEntry => {
                const logGroupName = contextValues[registryEntry.contextKey as keyof typeof contextValues];
                
                // Add config if log group is provided and not already present
                if (logGroupName && !finalConfigs.some(config => config.appType === registryEntry.appType)) {
                    finalConfigs.push({
                        appType: registryEntry.appType,
                        logGroups: [logGroupName],
                        transformationModule: registryEntry.processor
                    });
                }
            });
        }
        
        return finalConfigs;
    }
}