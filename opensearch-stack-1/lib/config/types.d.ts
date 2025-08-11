import { EbsDeviceVolumeType } from "aws-cdk-lib/aws-ec2";
import { EngineVersion } from "aws-cdk-lib/aws-opensearchservice";
export interface OpenSearchConfig {
    readonly domainName: string;
    readonly engineVersion: string;
    readonly dataNodeType: string;
    readonly dataNodeCount: number;
    readonly dedicatedManagerNodeType?: string;
    readonly dedicatedManagerNodeCount?: number;
    readonly warmNodeType?: string;
    readonly warmNodeCount?: number;
    readonly ebsEnabled: boolean;
    readonly ebsIops?: number;
    readonly ebsVolumeSize: number;
    readonly ebsVolumeType?: string;
    readonly availabilityZoneCount: number;
}
export interface NetworkConfig {
    readonly vpcEnabled: boolean;
    readonly vpcId?: string;
    readonly vpcSubnetIds?: string[];
    readonly vpcSecurityGroupIds?: string[];
    readonly availabilityZoneCount: number;
}
export interface ServiceLogConfig {
    readonly logGroupName: string;
    readonly indexName: string;
    readonly processorType?: string;
    readonly enabled?: boolean;
}
export interface LogConfig {
    readonly services: {
        readonly [serviceName: string]: ServiceLogConfig;
    };
}
export interface StackConfiguration {
    readonly openSearch: OpenSearchConfig;
    readonly network: NetworkConfig;
    readonly logs: LogConfig;
    readonly stage: string;
}
export interface ParsedOpenSearchConfig extends Omit<OpenSearchConfig, 'engineVersion' | 'ebsVolumeType'> {
    readonly version: EngineVersion;
    readonly ebsVolumeType?: EbsDeviceVolumeType;
}
export interface RawServiceLogConfig {
    readonly logGroupName?: string;
    readonly indexName?: string;
    readonly processorType?: string;
    readonly enabled?: boolean;
}
export interface RawConfigDefaults {
    readonly domainName?: string;
    readonly engineVersion?: string;
    readonly dataNodeType?: string;
    readonly dataNodeCount?: number;
    readonly dedicatedManagerNodeType?: string;
    readonly dedicatedManagerNodeCount?: number;
    readonly warmNodeType?: string;
    readonly warmNodeCount?: number;
    readonly ebsEnabled?: boolean;
    readonly ebsIops?: number;
    readonly ebsVolumeSize?: number;
    readonly ebsVolumeType?: string;
    readonly vpcEnabled?: boolean;
    readonly vpcId?: string;
    readonly vpcSubnetIds?: string[];
    readonly vpcSecurityGroupIds?: string[];
    readonly availabilityZoneCount?: number;
    readonly services?: {
        readonly [serviceName: string]: RawServiceLogConfig;
    };
}
