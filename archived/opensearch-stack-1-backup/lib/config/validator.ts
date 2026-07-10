import { EngineVersion } from "aws-cdk-lib/aws-opensearchservice";
import { EbsDeviceVolumeType } from "aws-cdk-lib/aws-ec2";
import { ParsedOpenSearchConfig, StackConfiguration } from "./types";

export class ConfigValidator {
    
    validateRequired(value: any, fieldName: string): void {
        if (!value) {
            throw new Error(`${fieldName} is required but was not provided`);
        }
    }

    validateEngineVersion(engineVersion: string): EngineVersion {
        if (!engineVersion) {
            throw new Error("Engine version is required");
        }

        if (engineVersion.startsWith("OS_")) {
            const version = engineVersion.substring(3);
            try {
                return EngineVersion.openSearch(version);
            } catch (error) {
                throw new Error(`Invalid OpenSearch version format: ${engineVersion}. Expected format: OS_x.x (e.g., OS_2.5)`);
            }
        } else if (engineVersion.startsWith("ES_")) {
            const version = engineVersion.substring(3);
            try {
                return EngineVersion.elasticsearch(version);
            } catch (error) {
                throw new Error(`Invalid Elasticsearch version format: ${engineVersion}. Expected format: ES_x.x (e.g., ES_7.9)`);
            }
        } else {
            throw new Error(`Engine version must start with 'OS_' or 'ES_'. Received: ${engineVersion}. Expected format: OS_2.5 or ES_7.9`);
        }
    }

    validateEbsVolumeType(ebsVolumeTypeName?: string): EbsDeviceVolumeType | undefined {
        if (!ebsVolumeTypeName) {
            return undefined;
        }

        const ebsVolumeType = EbsDeviceVolumeType[ebsVolumeTypeName as keyof typeof EbsDeviceVolumeType];
        if (!ebsVolumeType) {
            const validTypes = Object.keys(EbsDeviceVolumeType).join(', ');
            throw new Error(`Invalid EBS volume type: ${ebsVolumeTypeName}. Valid options are: ${validTypes}. Reference: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.EbsDeviceVolumeType.html`);
        }

        return ebsVolumeType;
    }

    validateAndTransformConfig(config: StackConfiguration): ParsedOpenSearchConfig {
        const version = this.validateEngineVersion(config.openSearch.engineVersion);
        const ebsVolumeType = this.validateEbsVolumeType(config.openSearch.ebsVolumeType);

        if (config.openSearch.dataNodeCount <= 0) {
            throw new Error(`Data node count must be greater than 0. Received: ${config.openSearch.dataNodeCount}`);
        }

        if (config.openSearch.dedicatedManagerNodeCount && config.openSearch.dedicatedManagerNodeCount < 0) {
            throw new Error(`Dedicated manager node count cannot be negative. Received: ${config.openSearch.dedicatedManagerNodeCount}`);
        }

        if (config.openSearch.warmNodeCount && config.openSearch.warmNodeCount < 0) {
            throw new Error(`Warm node count cannot be negative. Received: ${config.openSearch.warmNodeCount}`);
        }

        if (config.openSearch.ebsVolumeSize <= 0) {
            throw new Error(`EBS volume size must be greater than 0. Received: ${config.openSearch.ebsVolumeSize}`);
        }

        if (config.openSearch.availabilityZoneCount <= 0) {
            throw new Error(`Availability zone count must be greater than 0. Received: ${config.openSearch.availabilityZoneCount}`);
        }

        return {
            ...config.openSearch,
            version,
            ebsVolumeType,
        };
    }
}