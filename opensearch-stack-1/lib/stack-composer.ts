// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {Construct} from "constructs";
import {RemovalPolicy, Stack, StackProps} from "aws-cdk-lib";
import {OpensearchServiceDomainCdkStack} from "./opensearch-service-domain-cdk-stack";
import {EngineVersion} from "aws-cdk-lib/aws-opensearchservice";
import {EbsDeviceVolumeType} from "aws-cdk-lib/aws-ec2";
import * as defaultValuesJson from "../default-values.json"
import {NetworkStack} from "./network-stack";
import {KinesisFirehoseStack} from "./kinesis-firehose-stack";

export interface StackPropsExt extends StackProps {
    readonly stage: string
}

export class StackComposer {
    public stacks: Stack[] = [];

    constructor(scope: Construct, props: StackPropsExt) {
        let networkStack: NetworkStack|undefined
        const stage = props.stage
        const account = props.env?.account
        const region = props.env?.region

        let version: EngineVersion
        const defaultValues: { [x: string]: (any); } = defaultValuesJson
        const domainName = getContextForType('domainName', 'string')
        const dataNodeType = getContextForType('dataNodeType', 'string')
        const dataNodeCount = getContextForType('dataNodeCount', 'number')
        const dedicatedManagerNodeType = getContextForType('dedicatedManagerNodeType', 'string')
        const dedicatedManagerNodeCount = getContextForType('dedicatedManagerNodeCount', 'number')
        const warmNodeType = getContextForType('warmNodeType', 'string')
        const warmNodeCount = getContextForType('warmNodeCount', 'number')
        const ebsEnabled = getContextForType('ebsEnabled', 'boolean')
        const ebsIops = getContextForType('ebsIops', 'number')
        const ebsVolumeSize = getContextForType('ebsVolumeSize', 'number')
        const vpcId = getContextForType('vpcId', 'string')
        const vpcEnabled = getContextForType('vpcEnabled', 'boolean')
        const vpcSecurityGroupIds = getContextForType('vpcSecurityGroupIds', 'object')
        const vpcSubnetIds = getContextForType('vpcSubnetIds', 'object')
        const availabilityZoneCount = getContextForType('availabilityZoneCount', 'number')
        const eksLogGroupName = getContextForType('eksLogGroupName', 'string')
        const podLogGroupName = getContextForType('podLogGroupName', 'string')

        if (!domainName) {
            throw new Error("Domain name is not present and is a required field")
        }

        const engineVersion = getContextForType('engineVersion', 'string')
        if (engineVersion && engineVersion.startsWith("OS_")) {
            version = EngineVersion.openSearch(engineVersion.substring(3))
        } else if (engineVersion && engineVersion.startsWith("ES_")) {
            version = EngineVersion.elasticsearch(engineVersion.substring(3))
        } else {
            throw new Error("Engine version is not present or does not match the expected format, i.e. OS_1.3 or ES_7.9")
        }

        const ebsVolumeTypeName = getContextForType('ebsVolumeType', 'string')
        const ebsVolumeType: EbsDeviceVolumeType|undefined = ebsVolumeTypeName ? EbsDeviceVolumeType[ebsVolumeTypeName as keyof typeof EbsDeviceVolumeType] : undefined
        if (ebsVolumeTypeName && !ebsVolumeType) {
            throw new Error("Provided ebsVolumeType does not match a selectable option, for reference https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.EbsDeviceVolumeType.html")
        }

        // If enabled re-use existing VPC and/or associated resources or create new
        if (vpcEnabled) {
            networkStack = new NetworkStack(scope, 'networkStack', {
                vpcId: vpcId,
                vpcSubnetIds: vpcSubnetIds,
                vpcSecurityGroupIds: vpcSecurityGroupIds,
                availabilityZoneCount: availabilityZoneCount,
                stackName: `OSServiceNetworkCDKStack-${domainName}`,
                description: "This stack contains resources to create/manage networking for an OpenSearch Service domain",
                ...props,
            })
            this.stacks.push(networkStack)
        }

        const opensearchStack = new OpensearchServiceDomainCdkStack(scope, 'opensearchServiceDomainCdkStack', {
            version: version,
            domainName: domainName,
            dataNodeInstanceType: dataNodeType,
            dataNodes: dataNodeCount,
            dedicatedManagerNodeType: dedicatedManagerNodeType,
            dedicatedManagerNodeCount: dedicatedManagerNodeCount,
            warmInstanceType: warmNodeType,
            warmNodes: warmNodeCount,
            ebsEnabled: ebsEnabled,
            ebsIops: ebsIops,
            ebsVolumeSize: ebsVolumeSize,
            ebsVolumeType: ebsVolumeType,
            vpc: networkStack ? networkStack.vpc : undefined,
            vpcSubnets: networkStack ? networkStack.domainSubnets : undefined,
            vpcSecurityGroups: networkStack ? networkStack.domainSecurityGroups : undefined,
            availabilityZoneCount: availabilityZoneCount,
            stackName: `OSServiceDomainCDKStack-${domainName}`,
            description: "This stack contains an OpenSearch Service domain",
            ...props,
        })
        this.stacks.push(opensearchStack)

        // Create EKS logs Firehose stack if EKS log group is configured
        if (eksLogGroupName) {
            const eksFirehoseStack = new KinesisFirehoseStack(scope, 'kinesisFirehoseEksStack', {
                opensearchDomain: opensearchStack.domain,
                opensearchIndex: 'eks-logs',
                opensearchStackName: opensearchStack.stackName,
                eksLogGroupName: eksLogGroupName,
                stackName: `KinesisFirehoseEKSCDKStack-${domainName}`,
                description: "This stack contains Kinesis Data Firehose delivery streams for EKS logs",
                ...props,
            })
            this.stacks.push(eksFirehoseStack)
        }

        // Create Pod logs Firehose stack if Pod log group is configured  
        if (podLogGroupName) {
            const podFirehoseStack = new KinesisFirehoseStack(scope, 'kinesisFirehosePodStack', {
                opensearchDomain: opensearchStack.domain,
                opensearchIndex: 'pod-logs',
                opensearchStackName: opensearchStack.stackName,
                eksLogGroupName: podLogGroupName, // Reuse the same parameter name but for pod logs
                stackName: `KinesisFirehosePodCDKStack-${domainName}`,
                description: "This stack contains Kinesis Data Firehose delivery streams for Pod logs",
                ...props,
            })
            this.stacks.push(podFirehoseStack)
        }

        function getContextForType(optionName: string, expectedType: string): any {
            const option = scope.node.tryGetContext(optionName)

            // If no context is provided (undefined or empty string) and a default value exists, use it
            if ((option === undefined || option === "") && defaultValues[optionName]) {
                return defaultValues[optionName]
            }

            // Filter out invalid or missing options by setting undefined (empty strings, null, undefined, NaN)
            if (option !== false && option !== 0 && !option) {
                return undefined
            }
            // Values provided by the CLI will always be represented as a string and need to be parsed
            if (typeof option === 'string') {
                if (expectedType === 'number') {
                    return parseInt(option)
                }
                if (expectedType === 'boolean' || expectedType === 'object') {
                    return JSON.parse(option)
                }
            }
            // Values provided by the cdk.context.json should be of the desired type
            if (typeof option !== expectedType) {
                throw new Error(`Type provided by cdk.context.json for ${optionName} was ${typeof option} but expected ${expectedType}`)
            }
            return option
        }
    }
}