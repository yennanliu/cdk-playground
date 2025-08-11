import { EngineVersion } from "aws-cdk-lib/aws-opensearchservice";
import { EbsDeviceVolumeType } from "aws-cdk-lib/aws-ec2";
import { ParsedOpenSearchConfig, StackConfiguration } from "./types";
export declare class ConfigValidator {
    validateRequired(value: any, fieldName: string): void;
    validateEngineVersion(engineVersion: string): EngineVersion;
    validateEbsVolumeType(ebsVolumeTypeName?: string): EbsDeviceVolumeType | undefined;
    validateAndTransformConfig(config: StackConfiguration): ParsedOpenSearchConfig;
    private validateServices;
}
