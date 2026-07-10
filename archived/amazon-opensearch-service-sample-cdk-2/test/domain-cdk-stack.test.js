"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const aws_cdk_lib_1 = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const stack_composer_1 = require("../lib/stack-composer");
const testDefaultValues = require("./default-values-test.json");
const opensearch_service_domain_cdk_stack_1 = require("../lib/opensearch-service-domain-cdk-stack");
const network_stack_1 = require("../lib/network-stack");
test('Test primary context options are mapped with standard data type', () => {
    // The cdk.context.json and default-values.json files allow multiple data types
    const app = new aws_cdk_lib_1.App({
        context: {
            engineVersion: "OS_2.3",
            domainName: "test-os-domain",
            dataNodeType: "r6.large.search",
            dataNodeCount: 5,
            dedicatedManagerNodeType: "r6g.large.search",
            dedicatedManagerNodeCount: 3,
            warmNodeType: "ultrawarm1.medium.search",
            warmNodeCount: 2,
            accessPolicies: {
                "Version": "2012-10-17",
                "Statement": [{
                        "Effect": "Allow",
                        "Principal": { "AWS": "arn:aws:iam::123456789123:user/test-user" },
                        "Action": "es:ESHttp*",
                        "Resource": "arn:aws:es:us-east-1:123456789123:domain/cdk-os-service-domain/*"
                    }]
            },
            fineGrainedManagerUserARN: "arn:aws:iam::123456789123:user/test-user",
            enforceHTTPS: true,
            tlsSecurityPolicy: "TLS_1_2",
            ebsEnabled: true,
            ebsIops: 4000,
            ebsVolumeSize: 15,
            ebsVolumeType: "GP3",
            encryptionAtRestEnabled: true,
            encryptionAtRestKmsKeyARN: "arn:aws:kms:us-east-1:123456789123:key/abc123de-4888-4fa7-a508-3811e2d49fc3",
            loggingAppLogEnabled: true,
            loggingAppLogGroupARN: "arn:aws:logs:us-east-1:123456789123:log-group:app-log-group:*",
            loggingAuditLogEnabled: true,
            loggingAuditLogGroupARN: "arn:aws:logs:us-east-1:123456789123:log-group:audit-log-group:*",
            nodeToNodeEncryptionEnabled: true,
            vpcEnabled: true,
            vpcId: "vpc-123456789abcdefgh",
            vpcSubnetIds: ["subnet-123456789abcdefgh", "subnet-223456789abcdefgh"],
            vpcSecurityGroupIds: ["sg-123456789abcdefgh", "sg-223456789abcdefgh"],
            availabilityZoneCount: 3,
            domainRemovalPolicy: "DESTROY"
        }
    });
    const openSearchStacks = new stack_composer_1.StackComposer(app, {
        env: { account: "test-account", region: "us-east-1" }, stage: "unittest"
    });
    const domainStack = openSearchStacks.stacks.filter((s) => s instanceof opensearch_service_domain_cdk_stack_1.OpensearchServiceDomainCdkStack)[0];
    const domainTemplate = assertions_1.Template.fromStack(domainStack);
    const networkStack = openSearchStacks.stacks.filter((s) => s instanceof network_stack_1.NetworkStack)[0];
    const networkTemplate = assertions_1.Template.fromStack(networkStack);
    assertPrimaryDomainStackTemplate(domainTemplate);
    // When existing resources are provided the network stack creates no resources
    const resources = networkTemplate.toJSON().Resources;
    expect(resources === undefined);
});
test('Test primary context options are mapped with only string data type', () => {
    // CDK CLI commands pass all context values as strings
    const app = new aws_cdk_lib_1.App({
        context: {
            engineVersion: "OS_2.3",
            domainName: "test-os-domain",
            dataNodeType: "r6.large.search",
            dataNodeCount: "5",
            dedicatedManagerNodeType: "r6g.large.search",
            dedicatedManagerNodeCount: "3",
            warmNodeType: "ultrawarm1.medium.search",
            warmNodeCount: "2",
            accessPolicies: "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"AWS\":\"arn:aws:iam::123456789123:user/test-user\"},\"Action\":\"es:ESHttp*\",\"Resource\":\"arn:aws:es:us-east-1:123456789123:domain/cdk-os-service-domain/*\"}]}",
            fineGrainedManagerUserARN: "arn:aws:iam::123456789123:user/test-user",
            enforceHTTPS: "true",
            tlsSecurityPolicy: "TLS_1_2",
            ebsEnabled: "true",
            ebsIops: "4000",
            ebsVolumeSize: "15",
            ebsVolumeType: "GP3",
            encryptionAtRestEnabled: "true",
            encryptionAtRestKmsKeyARN: "arn:aws:kms:us-east-1:123456789123:key/abc123de-4888-4fa7-a508-3811e2d49fc3",
            loggingAppLogEnabled: "true",
            loggingAppLogGroupARN: "arn:aws:logs:us-east-1:123456789123:log-group:app-log-group:*",
            loggingAuditLogEnabled: "true",
            loggingAuditLogGroupARN: "arn:aws:logs:us-east-1:123456789123:log-group:audit-log-group:*",
            nodeToNodeEncryptionEnabled: "true",
            vpcEnabled: "true",
            vpcId: "vpc-123456789abcdefgh",
            vpcSubnetIds: "[\"subnet-123456789abcdefgh\", \"subnet-223456789abcdefgh\"]",
            vpcSecurityGroupIds: "[\"sg-123456789abcdefgh\", \"sg-223456789abcdefgh\"]",
            availabilityZoneCount: "3",
            domainRemovalPolicy: "DESTROY"
        }
    });
    const openSearchStacks = new stack_composer_1.StackComposer(app, {
        env: { account: "test-account", region: "us-east-1" }, stage: "unittest"
    });
    const domainStack = openSearchStacks.stacks.filter((s) => s instanceof opensearch_service_domain_cdk_stack_1.OpensearchServiceDomainCdkStack)[0];
    const domainTemplate = assertions_1.Template.fromStack(domainStack);
    const networkStack = openSearchStacks.stacks.filter((s) => s instanceof network_stack_1.NetworkStack)[0];
    const networkTemplate = assertions_1.Template.fromStack(networkStack);
    assertPrimaryDomainStackTemplate(domainTemplate);
    // When existing resources are provided the network stack creates no resources
    const resources = networkTemplate.toJSON().Resources;
    expect(resources === undefined);
});
test('Test alternate context options are mapped with standard data type', () => {
    // The cdk.context.json and default-values.json files allow multiple data types
    const app = new aws_cdk_lib_1.App({
        context: {
            useUnsignedBasicAuth: true,
            fineGrainedManagerUserName: "admin",
            fineGrainedManagerUserSecretManagerKeyARN: "arn:aws:secretsmanager:us-east-1:123456789123:secret:master-user-os-pass-123abc",
            // Fine-grained access requires enforceHTTPS, encryptionAtRest, and nodeToNodeEncryption to be enabled
            enforceHTTPS: true,
            encryptionAtRestEnabled: true,
            nodeToNodeEncryptionEnabled: true,
        }
    });
    const openSearchStacks = new stack_composer_1.StackComposer(app, {
        env: { account: "test-account", region: "us-east-1" }, stage: "unittest"
    });
    const domainStack = openSearchStacks.stacks.filter((s) => s instanceof opensearch_service_domain_cdk_stack_1.OpensearchServiceDomainCdkStack)[0];
    const domainTemplate = assertions_1.Template.fromStack(domainStack);
    assertAlternateDomainStackTemplate(domainTemplate);
});
test('Test alternate context options are mapped with only string data type', () => {
    // CDK CLI commands pass all context values as strings
    const app = new aws_cdk_lib_1.App({
        context: {
            useUnsignedBasicAuth: "true",
            fineGrainedManagerUserName: "admin",
            fineGrainedManagerUserSecretManagerKeyARN: "arn:aws:secretsmanager:us-east-1:123456789123:secret:master-user-os-pass-123abc",
            // Fine-grained access requires enforceHTTPS, encryptionAtRest, and nodeToNodeEncryption to be enabled
            enforceHTTPS: "true",
            encryptionAtRestEnabled: "true",
            nodeToNodeEncryptionEnabled: "true",
        }
    });
    const openSearchStacks = new stack_composer_1.StackComposer(app, {
        env: { account: "test-account", region: "us-east-1" }, stage: "unittest"
    });
    const domainStack = openSearchStacks.stacks.filter((s) => s instanceof opensearch_service_domain_cdk_stack_1.OpensearchServiceDomainCdkStack)[0];
    const domainTemplate = assertions_1.Template.fromStack(domainStack);
    assertAlternateDomainStackTemplate(domainTemplate);
});
test('Test openAccessPolicy setting creates access policy when enabled', () => {
    const app = new aws_cdk_lib_1.App({
        context: {
            openAccessPolicyEnabled: true
        }
    });
    const openSearchStacks = new stack_composer_1.StackComposer(app, {
        env: { account: "test-account", region: "us-east-1" }, stage: "unittest"
    });
    const domainStack = openSearchStacks.stacks.filter((s) => s instanceof opensearch_service_domain_cdk_stack_1.OpensearchServiceDomainCdkStack)[0];
    const domainTemplate = assertions_1.Template.fromStack(domainStack);
    // Check that openAccessPolicy is created
    domainTemplate.resourceCountIs("Custom::OpenSearchAccessPolicy", 1);
});
test('Test openAccessPolicy setting does not create access policy when disabled', () => {
    const app = new aws_cdk_lib_1.App({
        context: {
            openAccessPolicyEnabled: false
        }
    });
    const openSearchStacks = new stack_composer_1.StackComposer(app, {
        env: { account: "test-account", region: "us-east-1" }, stage: "unittest"
    });
    const domainStack = openSearchStacks.stacks.filter((s) => s instanceof opensearch_service_domain_cdk_stack_1.OpensearchServiceDomainCdkStack)[0];
    const domainTemplate = assertions_1.Template.fromStack(domainStack);
    // Check that openAccessPolicy is not created
    domainTemplate.resourceCountIs("Custom::OpenSearchAccessPolicy", 0);
});
test('Test openAccessPolicy setting is mapped with string data type', () => {
    const app = new aws_cdk_lib_1.App({
        context: {
            openAccessPolicyEnabled: "true"
        }
    });
    const openSearchStacks = new stack_composer_1.StackComposer(app, {
        env: { account: "test-account", region: "us-east-1" }, stage: "unittest"
    });
    const domainStack = openSearchStacks.stacks.filter((s) => s instanceof opensearch_service_domain_cdk_stack_1.OpensearchServiceDomainCdkStack)[0];
    const domainTemplate = assertions_1.Template.fromStack(domainStack);
    // Check that openAccessPolicy is created
    domainTemplate.resourceCountIs("Custom::OpenSearchAccessPolicy", 1);
});
test('Test default stack is created with default values when no context options are provided', () => {
    const app = new aws_cdk_lib_1.App({
        context: {}
    });
    const openSearchStacks = new stack_composer_1.StackComposer(app, {
        env: { account: "test-account", region: "us-east-1" }, stage: "unittest"
    });
    const defaultValues = testDefaultValues;
    const domainStack = openSearchStacks.stacks.filter((s) => s instanceof opensearch_service_domain_cdk_stack_1.OpensearchServiceDomainCdkStack)[0];
    const domainTemplate = assertions_1.Template.fromStack(domainStack);
    domainTemplate.resourceCountIs("AWS::OpenSearchService::Domain", 1);
    domainTemplate.hasResourceProperties("AWS::OpenSearchService::Domain", {
        DomainName: defaultValues["domainName"],
    });
});
test('Test default stack is created when empty context options are provided for non-required options', () => {
    const app = new aws_cdk_lib_1.App({
        context: {
            dataNodeType: "",
            dataNodeCount: "",
            dedicatedManagerNodeType: "",
            dedicatedManagerNodeCount: "",
            warmNodeType: "",
            warmNodeCount: "",
            accessPolicies: "",
            useUnsignedBasicAuth: "",
            fineGrainedManagerUserARN: "",
            fineGrainedManagerUserName: "",
            fineGrainedManagerUserSecretManagerKeyARN: "",
            enforceHTTPS: "",
            tlsSecurityPolicy: "",
            ebsEnabled: "",
            ebsIops: "",
            ebsVolumeSize: "",
            ebsVolumeType: "",
            encryptionAtRestEnabled: "",
            encryptionAtRestKmsKeyARN: "",
            loggingAppLogEnabled: "",
            loggingAppLogGroupARN: "",
            loggingAuditLogEnabled: "",
            loggingAuditLogGroupARN: "",
            nodeToNodeEncryptionEnabled: "",
            vpcEnabled: "",
            vpcId: "",
            vpcSubnetIds: "",
            vpcSecurityGroupIds: "",
            availabilityZoneCount: "",
            openAccessPolicyEnabled: "",
            domainRemovalPolicy: ""
        }
    });
    const openSearchStacks = new stack_composer_1.StackComposer(app, {
        env: { account: "test-account", region: "us-east-1" }, stage: "unittest"
    });
    const domainStack = openSearchStacks.stacks.filter((s) => s instanceof opensearch_service_domain_cdk_stack_1.OpensearchServiceDomainCdkStack)[0];
    const domainTemplate = assertions_1.Template.fromStack(domainStack);
    domainTemplate.resourceCountIs("AWS::OpenSearchService::Domain", 1);
});
/*
 * This function will make assertions on the primary config options, which contains the first set of options, all of
 * which should not interfere with resource properties of other settings in the set
 */
function assertPrimaryDomainStackTemplate(template) {
    // Check that accessPolicies policy is created
    template.resourceCountIs("Custom::OpenSearchAccessPolicy", 1);
    template.resourceCountIs("AWS::OpenSearchService::Domain", 1);
    template.hasResourceProperties("AWS::OpenSearchService::Domain", {
        EngineVersion: "OpenSearch_2.3",
        DomainName: "test-os-domain",
        AdvancedSecurityOptions: {
            Enabled: true,
            MasterUserOptions: {
                MasterUserARN: "arn:aws:iam::123456789123:user/test-user"
            }
        },
        ClusterConfig: {
            DedicatedMasterCount: 3,
            DedicatedMasterEnabled: true,
            DedicatedMasterType: "r6g.large.search",
            InstanceCount: 5,
            InstanceType: "r6.large.search",
            WarmCount: 2,
            WarmType: "ultrawarm1.medium.search",
            ZoneAwarenessConfig: {
                AvailabilityZoneCount: 3
            },
            ZoneAwarenessEnabled: true
        },
        DomainEndpointOptions: {
            EnforceHTTPS: true,
            TLSSecurityPolicy: "Policy-Min-TLS-1-2-2019-07"
        },
        EBSOptions: {
            EBSEnabled: true,
            Iops: 4000,
            VolumeSize: 15,
            VolumeType: "gp3"
        },
        EncryptionAtRestOptions: {
            Enabled: true,
            KmsKeyId: "abc123de-4888-4fa7-a508-3811e2d49fc3"
        },
        LogPublishingOptions: {
            ES_APPLICATION_LOGS: {
                CloudWatchLogsLogGroupArn: "arn:aws:logs:us-east-1:123456789123:log-group:app-log-group:*",
                Enabled: true
            },
            AUDIT_LOGS: {
                CloudWatchLogsLogGroupArn: "arn:aws:logs:us-east-1:123456789123:log-group:audit-log-group:*",
                Enabled: true
            }
        },
        /*
        * Only checking that the VPCOptions object is added here as normally the provided vpcId will perform a lookup to
        * determine these options, but seems to be auto mocked here
        */
        VPCOptions: {},
        NodeToNodeEncryptionOptions: {
            Enabled: true
        }
    });
    // Check our removal policy has been added
    template.hasResource("AWS::OpenSearchService::Domain", {
        DeletionPolicy: "Delete",
        UpdateReplacePolicy: "Delete"
    });
}
/*
 * This function will make assertions on the alternate config options, which contains options that would have been
 * impacted by the primary set of config options, all options here should not interfere with resource properties of
 * other settings in this set
 */
function assertAlternateDomainStackTemplate(template) {
    // Check that useUnsignedBasicAuth access policy is created
    template.resourceCountIs("Custom::OpenSearchAccessPolicy", 1);
    template.resourceCountIs("AWS::OpenSearchService::Domain", 1);
    template.hasResourceProperties("AWS::OpenSearchService::Domain", {
        AdvancedSecurityOptions: {
            Enabled: true,
            MasterUserOptions: {
                MasterUserName: "admin",
                MasterUserPassword: "{{resolve:secretsmanager:arn:aws:secretsmanager:us-east-1:123456789123:secret:master-user-os-pass-123abc:SecretString:::}}"
            }
        }
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZG9tYWluLWNkay1zdGFjay50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZG9tYWluLWNkay1zdGFjay50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsNkNBQWdDO0FBQ2hDLHVEQUFnRDtBQUNoRCwwREFBb0Q7QUFDcEQsZ0VBQWdFO0FBQ2hFLG9HQUEyRjtBQUMzRix3REFBa0Q7QUFFbEQsSUFBSSxDQUFDLGlFQUFpRSxFQUFFLEdBQUcsRUFBRTtJQUN6RSwrRUFBK0U7SUFDL0UsTUFBTSxHQUFHLEdBQUcsSUFBSSxpQkFBRyxDQUFDO1FBQ2hCLE9BQU8sRUFBRTtZQUNMLGFBQWEsRUFBRSxRQUFRO1lBQ3ZCLFVBQVUsRUFBRSxnQkFBZ0I7WUFDNUIsWUFBWSxFQUFFLGlCQUFpQjtZQUMvQixhQUFhLEVBQUUsQ0FBQztZQUNoQix3QkFBd0IsRUFBRSxrQkFBa0I7WUFDNUMseUJBQXlCLEVBQUUsQ0FBQztZQUM1QixZQUFZLEVBQUUsMEJBQTBCO1lBQ3hDLGFBQWEsRUFBRSxDQUFDO1lBQ2hCLGNBQWMsRUFBRTtnQkFDWixTQUFTLEVBQUUsWUFBWTtnQkFDdkIsV0FBVyxFQUFFLENBQUM7d0JBQ1YsUUFBUSxFQUFFLE9BQU87d0JBQ2pCLFdBQVcsRUFBRSxFQUFDLEtBQUssRUFBRSwwQ0FBMEMsRUFBQzt3QkFDaEUsUUFBUSxFQUFFLFlBQVk7d0JBQ3RCLFVBQVUsRUFBRSxrRUFBa0U7cUJBQ2pGLENBQUM7YUFDTDtZQUNELHlCQUF5QixFQUFFLDBDQUEwQztZQUNyRSxZQUFZLEVBQUUsSUFBSTtZQUNsQixpQkFBaUIsRUFBRSxTQUFTO1lBQzVCLFVBQVUsRUFBRSxJQUFJO1lBQ2hCLE9BQU8sRUFBRSxJQUFJO1lBQ2IsYUFBYSxFQUFFLEVBQUU7WUFDakIsYUFBYSxFQUFFLEtBQUs7WUFDcEIsdUJBQXVCLEVBQUUsSUFBSTtZQUM3Qix5QkFBeUIsRUFBRSw2RUFBNkU7WUFDeEcsb0JBQW9CLEVBQUUsSUFBSTtZQUMx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RUFBRSxJQUFJO2FBQ2hCO1NBQ0o7UUFDRDs7O1VBR0U7UUFDRixVQUFVLEVBQUUsRUFBRTtRQUNkLDJCQUEyQixFQUFFO1lBQ3pCLE9BQU8sRUFBRSxJQUFJO1NBQ2hCO0tBQ0osQ0FBQyxDQUFBO0lBQ0YsMENBQTBDO0lBQzFDLFFBQVEsQ0FBQyxXQUFXLENBQUMsZ0NBQWdDLEVBQUU7UUFDbkQsY0FBYyxFQUFFLFFBQVE7UUFDeEIsbUJBQW1CLEVBQUUsUUFBUTtLQUNoQyxDQUFDLENBQUE7QUFDTixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsa0NBQWtDLENBQUMsUUFBa0I7SUFDMUQsMkRBQTJEO0lBQzNELFFBQVEsQ0FBQyxlQUFlLENBQUMsZ0NBQWdDLEVBQUUsQ0FBQyxDQUFDLENBQUE7SUFDN0QsUUFBUSxDQUFDLGVBQWUsQ0FBQyxnQ0FBZ0MsRUFBRSxDQUFDLENBQUMsQ0FBQTtJQUM3RCxRQUFRLENBQUMscUJBQXFCLENBQUMsZ0NBQWdDLEVBQUU7UUFDN0QsdUJBQXVCLEVBQUU7WUFDckIsT0FBTyxFQUFFLElBQUk7WUFDYixpQkFBaUIsRUFBRTtnQkFDZixjQUFjLEVBQUUsT0FBTztnQkFDdkIsa0JBQWtCLEVBQUUsNEhBQTRIO2FBQ25KO1NBQ0o7S0FDSixDQUFDLENBQUE7QUFDTixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtBcHB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7VGVtcGxhdGV9IGZyb20gJ2F3cy1jZGstbGliL2Fzc2VydGlvbnMnO1xuaW1wb3J0IHtTdGFja0NvbXBvc2VyfSBmcm9tIFwiLi4vbGliL3N0YWNrLWNvbXBvc2VyXCI7XG5pbXBvcnQgKiBhcyB0ZXN0RGVmYXVsdFZhbHVlcyBmcm9tIFwiLi9kZWZhdWx0LXZhbHVlcy10ZXN0Lmpzb25cIjtcbmltcG9ydCB7T3BlbnNlYXJjaFNlcnZpY2VEb21haW5DZGtTdGFja30gZnJvbSBcIi4uL2xpYi9vcGVuc2VhcmNoLXNlcnZpY2UtZG9tYWluLWNkay1zdGFja1wiO1xuaW1wb3J0IHtOZXR3b3JrU3RhY2t9IGZyb20gXCIuLi9saWIvbmV0d29yay1zdGFja1wiO1xuXG50ZXN0KCdUZXN0IHByaW1hcnkgY29udGV4dCBvcHRpb25zIGFyZSBtYXBwZWQgd2l0aCBzdGFuZGFyZCBkYXRhIHR5cGUnLCAoKSA9PiB7XG4gICAgLy8gVGhlIGNkay5jb250ZXh0Lmpzb24gYW5kIGRlZmF1bHQtdmFsdWVzLmpzb24gZmlsZXMgYWxsb3cgbXVsdGlwbGUgZGF0YSB0eXBlc1xuICAgIGNvbnN0IGFwcCA9IG5ldyBBcHAoe1xuICAgICAgICBjb250ZXh0OiB7XG4gICAgICAgICAgICBlbmdpbmVWZXJzaW9uOiBcIk9TXzIuM1wiLFxuICAgICAgICAgICAgZG9tYWluTmFtZTogXCJ0ZXN0LW9zLWRvbWFpblwiLFxuICAgICAgICAgICAgZGF0YU5vZGVUeXBlOiBcInI2LmxhcmdlLnNlYXJjaFwiLFxuICAgICAgICAgICAgZGF0YU5vZGVDb3VudDogNSxcbiAgICAgICAgICAgIGRlZGljYXRlZE1hbmFnZXJOb2RlVHlwZTogXCJyNmcubGFyZ2Uuc2VhcmNoXCIsXG4gICAgICAgICAgICBkZWRpY2F0ZWRNYW5hZ2VyTm9kZUNvdW50OiAzLFxuICAgICAgICAgICAgd2FybU5vZGVUeXBlOiBcInVsdHJhd2FybTEubWVkaXVtLnNlYXJjaFwiLFxuICAgICAgICAgICAgd2FybU5vZGVDb3VudDogMixcbiAgICAgICAgICAgIGFjY2Vzc1BvbGljaWVzOiB7XG4gICAgICAgICAgICAgICAgXCJWZXJzaW9uXCI6IFwiMjAxMi0xMC0xN1wiLFxuICAgICAgICAgICAgICAgIFwiU3RhdGVtZW50XCI6IFt7XG4gICAgICAgICAgICAgICAgICAgIFwiRWZmZWN0XCI6IFwiQWxsb3dcIixcbiAgICAgICAgICAgICAgICAgICAgXCJQcmluY2lwYWxcIjoge1wiQVdTXCI6IFwiYXJuOmF3czppYW06OjEyMzQ1Njc4OTEyMzp1c2VyL3Rlc3QtdXNlclwifSxcbiAgICAgICAgICAgICAgICAgICAgXCJBY3Rpb25cIjogXCJlczpFU0h0dHAqXCIsXG4gICAgICAgICAgICAgICAgICAgIFwiUmVzb3VyY2VcIjogXCJhcm46YXdzOmVzOnVzLWVhc3QtMToxMjM0NTY3ODkxMjM6ZG9tYWluL2Nkay1vcy1zZXJ2aWNlLWRvbWFpbi8qXCJcbiAgICAgICAgICAgICAgICB9XVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGZpbmVHcmFpbmVkTWFuYWdlclVzZXJBUk46IFwiYXJuOmF3czppYW06OjEyMzQ1Njc4OTEyMzp1c2VyL3Rlc3QtdXNlclwiLFxuICAgICAgICAgICAgZW5mb3JjZUhUVFBTOiB0cnVlLFxuICAgICAgICAgICAgdGxzU2VjdXJpdHlQb2xpY3k6IFwiVExTXzFfMlwiLFxuICAgICAgICAgICAgZWJzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGVic0lvcHM6IDQwMDAsXG4gICAgICAgICAgICBlYnNWb2x1bWVTaXplOiAxNSxcbiAgICAgICAgICAgIGVic1ZvbHVtZVR5cGU6IFwiR1AzXCIsXG4gICAgICAgICAgICBlbmNyeXB0aW9uQXRSZXN0RW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGVuY3J5cHRpb25BdFJlc3RLbXNLZXlBUk46IFwiYXJuOmF3czprbXM6dXMtZWFzdC0xOjEyMzQ1Njc4OTEyMzprZXkvYWJjMTIzZGUtNDg4OC00ZmE3LWE1MDgtMzgxMWUyZDQ5ZmMzXCIsXG4gICAgICAgICAgICBsb2dnaW5nQXBwTG9nRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGxvZ2dpbmdBcHBMb2dHcm91cEFSTjogXCJhcm46YXdzOmxvZ3M6dXMtZWFzdC0xOjEyMzQ1Njc4OTEyMzpsb2ctZ3JvdXA6YXBwLWxvZy1ncm91cDoqXCIsXG4gICAgICAgICAgICBsb2dnaW5nQXVkaXRMb2dFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgbG9nZ2luZ0F1ZGl0TG9nR3JvdXBBUk46IFwiYXJuOmF3czpsb2dzOnVzLWVhc3QtMToxMjM0NTY3ODkxMjM6bG9nLWdyb3VwOmF1ZGl0LWxvZy1ncm91cDoqXCIsXG4gICAgICAgICAgICBub2RlVG9Ob2RlRW5jcnlwdGlvbkVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICB2cGNFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgdnBjSWQ6IFwidnBjLTEyMzQ1Njc4OWFiY2RlZmdoXCIsXG4gICAgICAgICAgICB2cGNTdWJuZXRJZHM6IFtcInN1Ym5ldC0xMjM0NTY3ODlhYmNkZWZnaFwiLCBcInN1Ym5ldC0yMjM0NTY3ODlhYmNkZWZnaFwiXSxcbiAgICAgICAgICAgIHZwY1NlY3VyaXR5R3JvdXBJZHM6IFtcInNnLTEyMzQ1Njc4OWFiY2RlZmdoXCIsIFwic2ctMjIzNDU2Nzg5YWJjZGVmZ2hcIl0sXG4gICAgICAgICAgICBhdmFpbGFiaWxpdHlab25lQ291bnQ6IDMsXG4gICAgICAgICAgICBkb21haW5SZW1vdmFsUG9saWN5OiBcIkRFU1RST1lcIlxuICAgICAgICB9XG4gICAgfSlcblxuICAgIGNvbnN0IG9wZW5TZWFyY2hTdGFja3MgPSBuZXcgU3RhY2tDb21wb3NlcihhcHAsIHtcbiAgICAgICAgZW52OiB7YWNjb3VudDogXCJ0ZXN0LWFjY291bnRcIiwgcmVnaW9uOiBcInVzLWVhc3QtMVwifSwgc3RhZ2U6IFwidW5pdHRlc3RcIlxuICAgIH0pXG5cbiAgICBjb25zdCBkb21haW5TdGFjayA9IG9wZW5TZWFyY2hTdGFja3Muc3RhY2tzLmZpbHRlcigocykgPT4gcyBpbnN0YW5jZW9mIE9wZW5zZWFyY2hTZXJ2aWNlRG9tYWluQ2RrU3RhY2spWzBdXG4gICAgY29uc3QgZG9tYWluVGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soZG9tYWluU3RhY2spXG4gICAgY29uc3QgbmV0d29ya1N0YWNrID0gb3BlblNlYXJjaFN0YWNrcy5zdGFja3MuZmlsdGVyKChzKSA9PiBzIGluc3RhbmNlb2YgTmV0d29ya1N0YWNrKVswXVxuICAgIGNvbnN0IG5ldHdvcmtUZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhuZXR3b3JrU3RhY2spXG4gICAgYXNzZXJ0UHJpbWFyeURvbWFpblN0YWNrVGVtcGxhdGUoZG9tYWluVGVtcGxhdGUpXG4gICAgLy8gV2hlbiBleGlzdGluZyByZXNvdXJjZXMgYXJlIHByb3ZpZGVkIHRoZSBuZXR3b3JrIHN0YWNrIGNyZWF0ZXMgbm8gcmVzb3VyY2VzXG4gICAgY29uc3QgcmVzb3VyY2VzID0gbmV0d29ya1RlbXBsYXRlLnRvSlNPTigpLlJlc291cmNlcztcbiAgICBleHBlY3QocmVzb3VyY2VzID09PSB1bmRlZmluZWQpXG59KVxuXG50ZXN0KCdUZXN0IHByaW1hcnkgY29udGV4dCBvcHRpb25zIGFyZSBtYXBwZWQgd2l0aCBvbmx5IHN0cmluZyBkYXRhIHR5cGUnLCAoKSA9PiB7XG4gICAgLy8gQ0RLIENMSSBjb21tYW5kcyBwYXNzIGFsbCBjb250ZXh0IHZhbHVlcyBhcyBzdHJpbmdzXG4gICAgY29uc3QgYXBwID0gbmV3IEFwcCh7XG4gICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICAgIGVuZ2luZVZlcnNpb246IFwiT1NfMi4zXCIsXG4gICAgICAgICAgICBkb21haW5OYW1lOiBcInRlc3Qtb3MtZG9tYWluXCIsXG4gICAgICAgICAgICBkYXRhTm9kZVR5cGU6IFwicjYubGFyZ2Uuc2VhcmNoXCIsXG4gICAgICAgICAgICBkYXRhTm9kZUNvdW50OiBcIjVcIixcbiAgICAgICAgICAgIGRlZGljYXRlZE1hbmFnZXJOb2RlVHlwZTogXCJyNmcubGFyZ2Uuc2VhcmNoXCIsXG4gICAgICAgICAgICBkZWRpY2F0ZWRNYW5hZ2VyTm9kZUNvdW50OiBcIjNcIixcbiAgICAgICAgICAgIHdhcm1Ob2RlVHlwZTogXCJ1bHRyYXdhcm0xLm1lZGl1bS5zZWFyY2hcIixcbiAgICAgICAgICAgIHdhcm1Ob2RlQ291bnQ6IFwiMlwiLFxuICAgICAgICAgICAgYWNjZXNzUG9saWNpZXM6IFwie1xcXCJWZXJzaW9uXFxcIjpcXFwiMjAxMi0xMC0xN1xcXCIsXFxcIlN0YXRlbWVudFxcXCI6W3tcXFwiRWZmZWN0XFxcIjpcXFwiQWxsb3dcXFwiLFxcXCJQcmluY2lwYWxcXFwiOntcXFwiQVdTXFxcIjpcXFwiYXJuOmF3czppYW06OjEyMzQ1Njc4OTEyMzp1c2VyL3Rlc3QtdXNlclxcXCJ9LFxcXCJBY3Rpb25cXFwiOlxcXCJlczpFU0h0dHAqXFxcIixcXFwiUmVzb3VyY2VcXFwiOlxcXCJhcm46YXdzOmVzOnVzLWVhc3QtMToxMjM0NTY3ODkxMjM6ZG9tYWluL2Nkay1vcy1zZXJ2aWNlLWRvbWFpbi8qXFxcIn1dfVwiLFxuICAgICAgICAgICAgZmluZUdyYWluZWRNYW5hZ2VyVXNlckFSTjogXCJhcm46YXdzOmlhbTo6MTIzNDU2Nzg5MTIzOnVzZXIvdGVzdC11c2VyXCIsXG4gICAgICAgICAgICBlbmZvcmNlSFRUUFM6IFwidHJ1ZVwiLFxuICAgICAgICAgICAgdGxzU2VjdXJpdHlQb2xpY3k6IFwiVExTXzFfMlwiLFxuICAgICAgICAgICAgZWJzRW5hYmxlZDogXCJ0cnVlXCIsXG4gICAgICAgICAgICBlYnNJb3BzOiBcIjQwMDBcIixcbiAgICAgICAgICAgIGVic1ZvbHVtZVNpemU6IFwiMTVcIixcbiAgICAgICAgICAgIGVic1ZvbHVtZVR5cGU6IFwiR1AzXCIsXG4gICAgICAgICAgICBlbmNyeXB0aW9uQXRSZXN0RW5hYmxlZDogXCJ0cnVlXCIsXG4gICAgICAgICAgICBlbmNyeXB0aW9uQXRSZXN0S21zS2V5QVJOOiBcImFybjphd3M6a21zOnVzLWVhc3QtMToxMjM0NTY3ODkxMjM6a2V5L2FiYzEyM2RlLTQ4ODgtNGZhNy1hNTA4LTM4MTFlMmQ0OWZjM1wiLFxuICAgICAgICAgICAgbG9nZ2luZ0FwcExvZ0VuYWJsZWQ6IFwidHJ1ZVwiLFxuICAgICAgICAgICAgbG9nZ2luZ0FwcExvZ0dyb3VwQVJOOiBcImFybjphd3M6bG9nczp1cy1lYXN0LTE6MTIzNDU2Nzg5MTIzOmxvZy1ncm91cDphcHAtbG9nLWdyb3VwOipcIixcbiAgICAgICAgICAgIGxvZ2dpbmdBdWRpdExvZ0VuYWJsZWQ6IFwidHJ1ZVwiLFxuICAgICAgICAgICAgbG9nZ2luZ0F1ZGl0TG9nR3JvdXBBUk46IFwiYXJuOmF3czpsb2dzOnVzLWVhc3QtMToxMjM0NTY3ODkxMjM6bG9nLWdyb3VwOmF1ZGl0LWxvZy1ncm91cDoqXCIsXG4gICAgICAgICAgICBub2RlVG9Ob2RlRW5jcnlwdGlvbkVuYWJsZWQ6IFwidHJ1ZVwiLFxuICAgICAgICAgICAgdnBjRW5hYmxlZDogXCJ0cnVlXCIsXG4gICAgICAgICAgICB2cGNJZDogXCJ2cGMtMTIzNDU2Nzg5YWJjZGVmZ2hcIixcbiAgICAgICAgICAgIHZwY1N1Ym5ldElkczogXCJbXFxcInN1Ym5ldC0xMjM0NTY3ODlhYmNkZWZnaFxcXCIsIFxcXCJzdWJuZXQtMjIzNDU2Nzg5YWJjZGVmZ2hcXFwiXVwiLFxuICAgICAgICAgICAgdnBjU2VjdXJpdHlHcm91cElkczogXCJbXFxcInNnLTEyMzQ1Njc4OWFiY2RlZmdoXFxcIiwgXFxcInNnLTIyMzQ1Njc4OWFiY2RlZmdoXFxcIl1cIixcbiAgICAgICAgICAgIGF2YWlsYWJpbGl0eVpvbmVDb3VudDogXCIzXCIsXG4gICAgICAgICAgICBkb21haW5SZW1vdmFsUG9saWN5OiBcIkRFU1RST1lcIlxuICAgICAgICB9XG4gICAgfSlcblxuICAgIGNvbnN0IG9wZW5TZWFyY2hTdGFja3MgPSBuZXcgU3RhY2tDb21wb3NlcihhcHAsIHtcbiAgICAgICAgZW52OiB7YWNjb3VudDogXCJ0ZXN0LWFjY291bnRcIiwgcmVnaW9uOiBcInVzLWVhc3QtMVwifSwgc3RhZ2U6IFwidW5pdHRlc3RcIlxuICAgIH0pXG5cbiAgICBjb25zdCBkb21haW5TdGFjayA9IG9wZW5TZWFyY2hTdGFja3Muc3RhY2tzLmZpbHRlcigocykgPT4gcyBpbnN0YW5jZW9mIE9wZW5zZWFyY2hTZXJ2aWNlRG9tYWluQ2RrU3RhY2spWzBdXG4gICAgY29uc3QgZG9tYWluVGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soZG9tYWluU3RhY2spXG4gICAgY29uc3QgbmV0d29ya1N0YWNrID0gb3BlblNlYXJjaFN0YWNrcy5zdGFja3MuZmlsdGVyKChzKSA9PiBzIGluc3RhbmNlb2YgTmV0d29ya1N0YWNrKVswXVxuICAgIGNvbnN0IG5ldHdvcmtUZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhuZXR3b3JrU3RhY2spXG4gICAgYXNzZXJ0UHJpbWFyeURvbWFpblN0YWNrVGVtcGxhdGUoZG9tYWluVGVtcGxhdGUpXG4gICAgLy8gV2hlbiBleGlzdGluZyByZXNvdXJjZXMgYXJlIHByb3ZpZGVkIHRoZSBuZXR3b3JrIHN0YWNrIGNyZWF0ZXMgbm8gcmVzb3VyY2VzXG4gICAgY29uc3QgcmVzb3VyY2VzID0gbmV0d29ya1RlbXBsYXRlLnRvSlNPTigpLlJlc291cmNlcztcbiAgICBleHBlY3QocmVzb3VyY2VzID09PSB1bmRlZmluZWQpXG59KVxuXG50ZXN0KCdUZXN0IGFsdGVybmF0ZSBjb250ZXh0IG9wdGlvbnMgYXJlIG1hcHBlZCB3aXRoIHN0YW5kYXJkIGRhdGEgdHlwZScsICgpID0+IHtcbiAgICAvLyBUaGUgY2RrLmNvbnRleHQuanNvbiBhbmQgZGVmYXVsdC12YWx1ZXMuanNvbiBmaWxlcyBhbGxvdyBtdWx0aXBsZSBkYXRhIHR5cGVzXG4gICAgY29uc3QgYXBwID0gbmV3IEFwcCh7XG4gICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICAgIHVzZVVuc2lnbmVkQmFzaWNBdXRoOiB0cnVlLFxuICAgICAgICAgICAgZmluZUdyYWluZWRNYW5hZ2VyVXNlck5hbWU6IFwiYWRtaW5cIixcbiAgICAgICAgICAgIGZpbmVHcmFpbmVkTWFuYWdlclVzZXJTZWNyZXRNYW5hZ2VyS2V5QVJOOiBcImFybjphd3M6c2VjcmV0c21hbmFnZXI6dXMtZWFzdC0xOjEyMzQ1Njc4OTEyMzpzZWNyZXQ6bWFzdGVyLXVzZXItb3MtcGFzcy0xMjNhYmNcIixcbiAgICAgICAgICAgIC8vIEZpbmUtZ3JhaW5lZCBhY2Nlc3MgcmVxdWlyZXMgZW5mb3JjZUhUVFBTLCBlbmNyeXB0aW9uQXRSZXN0LCBhbmQgbm9kZVRvTm9kZUVuY3J5cHRpb24gdG8gYmUgZW5hYmxlZFxuICAgICAgICAgICAgZW5mb3JjZUhUVFBTOiB0cnVlLFxuICAgICAgICAgICAgZW5jcnlwdGlvbkF0UmVzdEVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBub2RlVG9Ob2RlRW5jcnlwdGlvbkVuYWJsZWQ6IHRydWUsXG4gICAgICAgIH1cbiAgICB9KVxuXG4gICAgY29uc3Qgb3BlblNlYXJjaFN0YWNrcyA9IG5ldyBTdGFja0NvbXBvc2VyKGFwcCwge1xuICAgICAgICBlbnY6IHthY2NvdW50OiBcInRlc3QtYWNjb3VudFwiLCByZWdpb246IFwidXMtZWFzdC0xXCJ9LCBzdGFnZTogXCJ1bml0dGVzdFwiXG4gICAgfSlcblxuICAgIGNvbnN0IGRvbWFpblN0YWNrID0gb3BlblNlYXJjaFN0YWNrcy5zdGFja3MuZmlsdGVyKChzKSA9PiBzIGluc3RhbmNlb2YgT3BlbnNlYXJjaFNlcnZpY2VEb21haW5DZGtTdGFjaylbMF1cbiAgICBjb25zdCBkb21haW5UZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhkb21haW5TdGFjaylcbiAgICBhc3NlcnRBbHRlcm5hdGVEb21haW5TdGFja1RlbXBsYXRlKGRvbWFpblRlbXBsYXRlKVxufSlcblxudGVzdCgnVGVzdCBhbHRlcm5hdGUgY29udGV4dCBvcHRpb25zIGFyZSBtYXBwZWQgd2l0aCBvbmx5IHN0cmluZyBkYXRhIHR5cGUnLCAoKSA9PiB7XG4gICAgLy8gQ0RLIENMSSBjb21tYW5kcyBwYXNzIGFsbCBjb250ZXh0IHZhbHVlcyBhcyBzdHJpbmdzXG4gICAgY29uc3QgYXBwID0gbmV3IEFwcCh7XG4gICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICAgIHVzZVVuc2lnbmVkQmFzaWNBdXRoOiBcInRydWVcIixcbiAgICAgICAgICAgIGZpbmVHcmFpbmVkTWFuYWdlclVzZXJOYW1lOiBcImFkbWluXCIsXG4gICAgICAgICAgICBmaW5lR3JhaW5lZE1hbmFnZXJVc2VyU2VjcmV0TWFuYWdlcktleUFSTjogXCJhcm46YXdzOnNlY3JldHNtYW5hZ2VyOnVzLWVhc3QtMToxMjM0NTY3ODkxMjM6c2VjcmV0Om1hc3Rlci11c2VyLW9zLXBhc3MtMTIzYWJjXCIsXG4gICAgICAgICAgICAvLyBGaW5lLWdyYWluZWQgYWNjZXNzIHJlcXVpcmVzIGVuZm9yY2VIVFRQUywgZW5jcnlwdGlvbkF0UmVzdCwgYW5kIG5vZGVUb05vZGVFbmNyeXB0aW9uIHRvIGJlIGVuYWJsZWRcbiAgICAgICAgICAgIGVuZm9yY2VIVFRQUzogXCJ0cnVlXCIsXG4gICAgICAgICAgICBlbmNyeXB0aW9uQXRSZXN0RW5hYmxlZDogXCJ0cnVlXCIsXG4gICAgICAgICAgICBub2RlVG9Ob2RlRW5jcnlwdGlvbkVuYWJsZWQ6IFwidHJ1ZVwiLFxuICAgICAgICB9XG4gICAgfSlcblxuICAgIGNvbnN0IG9wZW5TZWFyY2hTdGFja3MgPSBuZXcgU3RhY2tDb21wb3NlcihhcHAsIHtcbiAgICAgICAgZW52OiB7YWNjb3VudDogXCJ0ZXN0LWFjY291bnRcIiwgcmVnaW9uOiBcInVzLWVhc3QtMVwifSwgc3RhZ2U6IFwidW5pdHRlc3RcIlxuICAgIH0pXG5cbiAgICBjb25zdCBkb21haW5TdGFjayA9IG9wZW5TZWFyY2hTdGFja3Muc3RhY2tzLmZpbHRlcigocykgPT4gcyBpbnN0YW5jZW9mIE9wZW5zZWFyY2hTZXJ2aWNlRG9tYWluQ2RrU3RhY2spWzBdXG4gICAgY29uc3QgZG9tYWluVGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soZG9tYWluU3RhY2spXG4gICAgYXNzZXJ0QWx0ZXJuYXRlRG9tYWluU3RhY2tUZW1wbGF0ZShkb21haW5UZW1wbGF0ZSlcbn0pXG5cbnRlc3QoJ1Rlc3Qgb3BlbkFjY2Vzc1BvbGljeSBzZXR0aW5nIGNyZWF0ZXMgYWNjZXNzIHBvbGljeSB3aGVuIGVuYWJsZWQnLCAoKSA9PiB7XG4gICAgY29uc3QgYXBwID0gbmV3IEFwcCh7XG4gICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICAgIG9wZW5BY2Nlc3NQb2xpY3lFbmFibGVkOiB0cnVlXG4gICAgICAgIH1cbiAgICB9KVxuXG4gICAgY29uc3Qgb3BlblNlYXJjaFN0YWNrcyA9IG5ldyBTdGFja0NvbXBvc2VyKGFwcCwge1xuICAgICAgICBlbnY6IHthY2NvdW50OiBcInRlc3QtYWNjb3VudFwiLCByZWdpb246IFwidXMtZWFzdC0xXCJ9LCBzdGFnZTogXCJ1bml0dGVzdFwiXG4gICAgfSlcblxuICAgIGNvbnN0IGRvbWFpblN0YWNrID0gb3BlblNlYXJjaFN0YWNrcy5zdGFja3MuZmlsdGVyKChzKSA9PiBzIGluc3RhbmNlb2YgT3BlbnNlYXJjaFNlcnZpY2VEb21haW5DZGtTdGFjaylbMF1cbiAgICBjb25zdCBkb21haW5UZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhkb21haW5TdGFjaylcbiAgICAvLyBDaGVjayB0aGF0IG9wZW5BY2Nlc3NQb2xpY3kgaXMgY3JlYXRlZFxuICAgIGRvbWFpblRlbXBsYXRlLnJlc291cmNlQ291bnRJcyhcIkN1c3RvbTo6T3BlblNlYXJjaEFjY2Vzc1BvbGljeVwiLCAxKVxuXG59KVxuXG50ZXN0KCdUZXN0IG9wZW5BY2Nlc3NQb2xpY3kgc2V0dGluZyBkb2VzIG5vdCBjcmVhdGUgYWNjZXNzIHBvbGljeSB3aGVuIGRpc2FibGVkJywgKCkgPT4ge1xuICAgIGNvbnN0IGFwcCA9IG5ldyBBcHAoe1xuICAgICAgICBjb250ZXh0OiB7XG4gICAgICAgICAgICBvcGVuQWNjZXNzUG9saWN5RW5hYmxlZDogZmFsc2VcbiAgICAgICAgfVxuICAgIH0pXG5cbiAgICBjb25zdCBvcGVuU2VhcmNoU3RhY2tzID0gbmV3IFN0YWNrQ29tcG9zZXIoYXBwLCB7XG4gICAgICAgIGVudjoge2FjY291bnQ6IFwidGVzdC1hY2NvdW50XCIsIHJlZ2lvbjogXCJ1cy1lYXN0LTFcIn0sIHN0YWdlOiBcInVuaXR0ZXN0XCJcbiAgICB9KVxuXG4gICAgY29uc3QgZG9tYWluU3RhY2sgPSBvcGVuU2VhcmNoU3RhY2tzLnN0YWNrcy5maWx0ZXIoKHMpID0+IHMgaW5zdGFuY2VvZiBPcGVuc2VhcmNoU2VydmljZURvbWFpbkNka1N0YWNrKVswXVxuICAgIGNvbnN0IGRvbWFpblRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKGRvbWFpblN0YWNrKVxuICAgIC8vIENoZWNrIHRoYXQgb3BlbkFjY2Vzc1BvbGljeSBpcyBub3QgY3JlYXRlZFxuICAgIGRvbWFpblRlbXBsYXRlLnJlc291cmNlQ291bnRJcyhcIkN1c3RvbTo6T3BlblNlYXJjaEFjY2Vzc1BvbGljeVwiLCAwKVxuXG59KVxuXG50ZXN0KCdUZXN0IG9wZW5BY2Nlc3NQb2xpY3kgc2V0dGluZyBpcyBtYXBwZWQgd2l0aCBzdHJpbmcgZGF0YSB0eXBlJywgKCkgPT4ge1xuICAgIGNvbnN0IGFwcCA9IG5ldyBBcHAoe1xuICAgICAgICBjb250ZXh0OiB7XG4gICAgICAgICAgICBvcGVuQWNjZXNzUG9saWN5RW5hYmxlZDogXCJ0cnVlXCJcbiAgICAgICAgfVxuICAgIH0pXG5cbiAgICBjb25zdCBvcGVuU2VhcmNoU3RhY2tzID0gbmV3IFN0YWNrQ29tcG9zZXIoYXBwLCB7XG4gICAgICAgIGVudjoge2FjY291bnQ6IFwidGVzdC1hY2NvdW50XCIsIHJlZ2lvbjogXCJ1cy1lYXN0LTFcIn0sIHN0YWdlOiBcInVuaXR0ZXN0XCJcbiAgICB9KVxuXG4gICAgY29uc3QgZG9tYWluU3RhY2sgPSBvcGVuU2VhcmNoU3RhY2tzLnN0YWNrcy5maWx0ZXIoKHMpID0+IHMgaW5zdGFuY2VvZiBPcGVuc2VhcmNoU2VydmljZURvbWFpbkNka1N0YWNrKVswXVxuICAgIGNvbnN0IGRvbWFpblRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKGRvbWFpblN0YWNrKVxuICAgIC8vIENoZWNrIHRoYXQgb3BlbkFjY2Vzc1BvbGljeSBpcyBjcmVhdGVkXG4gICAgZG9tYWluVGVtcGxhdGUucmVzb3VyY2VDb3VudElzKFwiQ3VzdG9tOjpPcGVuU2VhcmNoQWNjZXNzUG9saWN5XCIsIDEpXG5cbn0pXG5cbnRlc3QoICdUZXN0IGRlZmF1bHQgc3RhY2sgaXMgY3JlYXRlZCB3aXRoIGRlZmF1bHQgdmFsdWVzIHdoZW4gbm8gY29udGV4dCBvcHRpb25zIGFyZSBwcm92aWRlZCcsICgpID0+IHtcbiAgICBjb25zdCBhcHAgPSBuZXcgQXBwKHtcbiAgICAgICAgY29udGV4dDoge31cbiAgICB9KVxuXG4gICAgY29uc3Qgb3BlblNlYXJjaFN0YWNrcyA9IG5ldyBTdGFja0NvbXBvc2VyKGFwcCwge1xuICAgICAgICBlbnY6IHthY2NvdW50OiBcInRlc3QtYWNjb3VudFwiLCByZWdpb246IFwidXMtZWFzdC0xXCJ9LCBzdGFnZTogXCJ1bml0dGVzdFwiXG4gICAgfSlcblxuICAgIGNvbnN0IGRlZmF1bHRWYWx1ZXM6IHsgW3g6IHN0cmluZ106IChzdHJpbmcpOyB9ID0gdGVzdERlZmF1bHRWYWx1ZXNcbiAgICBjb25zdCBkb21haW5TdGFjayA9IG9wZW5TZWFyY2hTdGFja3Muc3RhY2tzLmZpbHRlcigocykgPT4gcyBpbnN0YW5jZW9mIE9wZW5zZWFyY2hTZXJ2aWNlRG9tYWluQ2RrU3RhY2spWzBdXG4gICAgY29uc3QgZG9tYWluVGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soZG9tYWluU3RhY2spXG4gICAgZG9tYWluVGVtcGxhdGUucmVzb3VyY2VDb3VudElzKFwiQVdTOjpPcGVuU2VhcmNoU2VydmljZTo6RG9tYWluXCIsIDEpXG4gICAgZG9tYWluVGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKFwiQVdTOjpPcGVuU2VhcmNoU2VydmljZTo6RG9tYWluXCIsIHtcbiAgICAgICAgRG9tYWluTmFtZTogZGVmYXVsdFZhbHVlc1tcImRvbWFpbk5hbWVcIl0sXG4gICAgfSlcbn0pXG5cbnRlc3QoICdUZXN0IGRlZmF1bHQgc3RhY2sgaXMgY3JlYXRlZCB3aGVuIGVtcHR5IGNvbnRleHQgb3B0aW9ucyBhcmUgcHJvdmlkZWQgZm9yIG5vbi1yZXF1aXJlZCBvcHRpb25zJywgKCkgPT4ge1xuICAgIGNvbnN0IGFwcCA9IG5ldyBBcHAoe1xuICAgICAgICBjb250ZXh0OiB7XG4gICAgICAgICAgICBkYXRhTm9kZVR5cGU6IFwiXCIsXG4gICAgICAgICAgICBkYXRhTm9kZUNvdW50OiBcIlwiLFxuICAgICAgICAgICAgZGVkaWNhdGVkTWFuYWdlck5vZGVUeXBlOiBcIlwiLFxuICAgICAgICAgICAgZGVkaWNhdGVkTWFuYWdlck5vZGVDb3VudDogXCJcIixcbiAgICAgICAgICAgIHdhcm1Ob2RlVHlwZTogXCJcIixcbiAgICAgICAgICAgIHdhcm1Ob2RlQ291bnQ6IFwiXCIsXG4gICAgICAgICAgICBhY2Nlc3NQb2xpY2llczogXCJcIixcbiAgICAgICAgICAgIHVzZVVuc2lnbmVkQmFzaWNBdXRoOiBcIlwiLFxuICAgICAgICAgICAgZmluZUdyYWluZWRNYW5hZ2VyVXNlckFSTjogXCJcIixcbiAgICAgICAgICAgIGZpbmVHcmFpbmVkTWFuYWdlclVzZXJOYW1lOiBcIlwiLFxuICAgICAgICAgICAgZmluZUdyYWluZWRNYW5hZ2VyVXNlclNlY3JldE1hbmFnZXJLZXlBUk46IFwiXCIsXG4gICAgICAgICAgICBlbmZvcmNlSFRUUFM6IFwiXCIsXG4gICAgICAgICAgICB0bHNTZWN1cml0eVBvbGljeTogXCJcIixcbiAgICAgICAgICAgIGVic0VuYWJsZWQ6IFwiXCIsXG4gICAgICAgICAgICBlYnNJb3BzOiBcIlwiLFxuICAgICAgICAgICAgZWJzVm9sdW1lU2l6ZTogXCJcIixcbiAgICAgICAgICAgIGVic1ZvbHVtZVR5cGU6IFwiXCIsXG4gICAgICAgICAgICBlbmNyeXB0aW9uQXRSZXN0RW5hYmxlZDogXCJcIixcbiAgICAgICAgICAgIGVuY3J5cHRpb25BdFJlc3RLbXNLZXlBUk46IFwiXCIsXG4gICAgICAgICAgICBsb2dnaW5nQXBwTG9nRW5hYmxlZDogXCJcIixcbiAgICAgICAgICAgIGxvZ2dpbmdBcHBMb2dHcm91cEFSTjogXCJcIixcbiAgICAgICAgICAgIGxvZ2dpbmdBdWRpdExvZ0VuYWJsZWQ6IFwiXCIsXG4gICAgICAgICAgICBsb2dnaW5nQXVkaXRMb2dHcm91cEFSTjogXCJcIixcbiAgICAgICAgICAgIG5vZGVUb05vZGVFbmNyeXB0aW9uRW5hYmxlZDogXCJcIixcbiAgICAgICAgICAgIHZwY0VuYWJsZWQ6IFwiXCIsXG4gICAgICAgICAgICB2cGNJZDogXCJcIixcbiAgICAgICAgICAgIHZwY1N1Ym5ldElkczogXCJcIixcbiAgICAgICAgICAgIHZwY1NlY3VyaXR5R3JvdXBJZHM6IFwiXCIsXG4gICAgICAgICAgICBhdmFpbGFiaWxpdHlab25lQ291bnQ6IFwiXCIsXG4gICAgICAgICAgICBvcGVuQWNjZXNzUG9saWN5RW5hYmxlZDogXCJcIixcbiAgICAgICAgICAgIGRvbWFpblJlbW92YWxQb2xpY3k6IFwiXCJcbiAgICAgICAgfVxuICAgIH0pXG5cbiAgICBjb25zdCBvcGVuU2VhcmNoU3RhY2tzID0gbmV3IFN0YWNrQ29tcG9zZXIoYXBwLCB7XG4gICAgICAgIGVudjoge2FjY291bnQ6IFwidGVzdC1hY2NvdW50XCIsIHJlZ2lvbjogXCJ1cy1lYXN0LTFcIn0sIHN0YWdlOiBcInVuaXR0ZXN0XCJcbiAgICB9KVxuXG4gICAgY29uc3QgZG9tYWluU3RhY2sgPSBvcGVuU2VhcmNoU3RhY2tzLnN0YWNrcy5maWx0ZXIoKHMpID0+IHMgaW5zdGFuY2VvZiBPcGVuc2VhcmNoU2VydmljZURvbWFpbkNka1N0YWNrKVswXVxuICAgIGNvbnN0IGRvbWFpblRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKGRvbWFpblN0YWNrKVxuICAgIGRvbWFpblRlbXBsYXRlLnJlc291cmNlQ291bnRJcyhcIkFXUzo6T3BlblNlYXJjaFNlcnZpY2U6OkRvbWFpblwiLCAxKVxufSlcblxuXG4vKlxuICogVGhpcyBmdW5jdGlvbiB3aWxsIG1ha2UgYXNzZXJ0aW9ucyBvbiB0aGUgcHJpbWFyeSBjb25maWcgb3B0aW9ucywgd2hpY2ggY29udGFpbnMgdGhlIGZpcnN0IHNldCBvZiBvcHRpb25zLCBhbGwgb2ZcbiAqIHdoaWNoIHNob3VsZCBub3QgaW50ZXJmZXJlIHdpdGggcmVzb3VyY2UgcHJvcGVydGllcyBvZiBvdGhlciBzZXR0aW5ncyBpbiB0aGUgc2V0XG4gKi9cbmZ1bmN0aW9uIGFzc2VydFByaW1hcnlEb21haW5TdGFja1RlbXBsYXRlKHRlbXBsYXRlOiBUZW1wbGF0ZSkge1xuICAgIC8vIENoZWNrIHRoYXQgYWNjZXNzUG9saWNpZXMgcG9saWN5IGlzIGNyZWF0ZWRcbiAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoXCJDdXN0b206Ok9wZW5TZWFyY2hBY2Nlc3NQb2xpY3lcIiwgMSlcbiAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoXCJBV1M6Ok9wZW5TZWFyY2hTZXJ2aWNlOjpEb21haW5cIiwgMSlcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoXCJBV1M6Ok9wZW5TZWFyY2hTZXJ2aWNlOjpEb21haW5cIiwge1xuICAgICAgICBFbmdpbmVWZXJzaW9uOiBcIk9wZW5TZWFyY2hfMi4zXCIsXG4gICAgICAgIERvbWFpbk5hbWU6IFwidGVzdC1vcy1kb21haW5cIixcbiAgICAgICAgQWR2YW5jZWRTZWN1cml0eU9wdGlvbnM6IHtcbiAgICAgICAgICAgIEVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBNYXN0ZXJVc2VyT3B0aW9uczoge1xuICAgICAgICAgICAgICAgIE1hc3RlclVzZXJBUk46IFwiYXJuOmF3czppYW06OjEyMzQ1Njc4OTEyMzp1c2VyL3Rlc3QtdXNlclwiXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIENsdXN0ZXJDb25maWc6IHtcbiAgICAgICAgICAgIERlZGljYXRlZE1hc3RlckNvdW50OiAzLFxuICAgICAgICAgICAgRGVkaWNhdGVkTWFzdGVyRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIERlZGljYXRlZE1hc3RlclR5cGU6IFwicjZnLmxhcmdlLnNlYXJjaFwiLFxuICAgICAgICAgICAgSW5zdGFuY2VDb3VudDogNSxcbiAgICAgICAgICAgIEluc3RhbmNlVHlwZTogXCJyNi5sYXJnZS5zZWFyY2hcIixcbiAgICAgICAgICAgIFdhcm1Db3VudDogMixcbiAgICAgICAgICAgIFdhcm1UeXBlOiBcInVsdHJhd2FybTEubWVkaXVtLnNlYXJjaFwiLFxuICAgICAgICAgICAgWm9uZUF3YXJlbmVzc0NvbmZpZzoge1xuICAgICAgICAgICAgICAgIEF2YWlsYWJpbGl0eVpvbmVDb3VudDogM1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFpvbmVBd2FyZW5lc3NFbmFibGVkOiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIERvbWFpbkVuZHBvaW50T3B0aW9uczoge1xuICAgICAgICAgICAgRW5mb3JjZUhUVFBTOiB0cnVlLFxuICAgICAgICAgICAgVExTU2VjdXJpdHlQb2xpY3k6IFwiUG9saWN5LU1pbi1UTFMtMS0yLTIwMTktMDdcIlxuICAgICAgICB9LFxuICAgICAgICBFQlNPcHRpb25zOiB7XG4gICAgICAgICAgICBFQlNFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgSW9wczogNDAwMCxcbiAgICAgICAgICAgIFZvbHVtZVNpemU6IDE1LFxuICAgICAgICAgICAgVm9sdW1lVHlwZTogXCJncDNcIlxuICAgICAgICB9LFxuICAgICAgICBFbmNyeXB0aW9uQXRSZXN0T3B0aW9uczoge1xuICAgICAgICAgICAgRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIEttc0tleUlkOiBcImFiYzEyM2RlLTQ4ODgtNGZhNy1hNTA4LTM4MTFlMmQ0OWZjM1wiXG4gICAgICAgIH0sXG4gICAgICAgIExvZ1B1Ymxpc2hpbmdPcHRpb25zOiB7XG4gICAgICAgICAgICBFU19BUFBMSUNBVElPTl9MT0dTOiB7XG4gICAgICAgICAgICAgICAgQ2xvdWRXYXRjaExvZ3NMb2dHcm91cEFybjogXCJhcm46YXdzOmxvZ3M6dXMtZWFzdC0xOjEyMzQ1Njc4OTEyMzpsb2ctZ3JvdXA6YXBwLWxvZy1ncm91cDoqXCIsXG4gICAgICAgICAgICAgICAgRW5hYmxlZDogdHJ1ZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIEFVRElUX0xPR1M6IHtcbiAgICAgICAgICAgICAgICBDbG91ZFdhdGNoTG9nc0xvZ0dyb3VwQXJuOiBcImFybjphd3M6bG9nczp1cy1lYXN0LTE6MTIzNDU2Nzg5MTIzOmxvZy1ncm91cDphdWRpdC1sb2ctZ3JvdXA6KlwiLFxuICAgICAgICAgICAgICAgIEVuYWJsZWQ6IHRydWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLypcbiAgICAgICAgKiBPbmx5IGNoZWNraW5nIHRoYXQgdGhlIFZQQ09wdGlvbnMgb2JqZWN0IGlzIGFkZGVkIGhlcmUgYXMgbm9ybWFsbHkgdGhlIHByb3ZpZGVkIHZwY0lkIHdpbGwgcGVyZm9ybSBhIGxvb2t1cCB0b1xuICAgICAgICAqIGRldGVybWluZSB0aGVzZSBvcHRpb25zLCBidXQgc2VlbXMgdG8gYmUgYXV0byBtb2NrZWQgaGVyZVxuICAgICAgICAqL1xuICAgICAgICBWUENPcHRpb25zOiB7fSxcbiAgICAgICAgTm9kZVRvTm9kZUVuY3J5cHRpb25PcHRpb25zOiB7XG4gICAgICAgICAgICBFbmFibGVkOiB0cnVlXG4gICAgICAgIH1cbiAgICB9KVxuICAgIC8vIENoZWNrIG91ciByZW1vdmFsIHBvbGljeSBoYXMgYmVlbiBhZGRlZFxuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlKFwiQVdTOjpPcGVuU2VhcmNoU2VydmljZTo6RG9tYWluXCIsIHtcbiAgICAgICAgRGVsZXRpb25Qb2xpY3k6IFwiRGVsZXRlXCIsXG4gICAgICAgIFVwZGF0ZVJlcGxhY2VQb2xpY3k6IFwiRGVsZXRlXCJcbiAgICB9KVxufVxuXG4vKlxuICogVGhpcyBmdW5jdGlvbiB3aWxsIG1ha2UgYXNzZXJ0aW9ucyBvbiB0aGUgYWx0ZXJuYXRlIGNvbmZpZyBvcHRpb25zLCB3aGljaCBjb250YWlucyBvcHRpb25zIHRoYXQgd291bGQgaGF2ZSBiZWVuXG4gKiBpbXBhY3RlZCBieSB0aGUgcHJpbWFyeSBzZXQgb2YgY29uZmlnIG9wdGlvbnMsIGFsbCBvcHRpb25zIGhlcmUgc2hvdWxkIG5vdCBpbnRlcmZlcmUgd2l0aCByZXNvdXJjZSBwcm9wZXJ0aWVzIG9mXG4gKiBvdGhlciBzZXR0aW5ncyBpbiB0aGlzIHNldFxuICovXG5mdW5jdGlvbiBhc3NlcnRBbHRlcm5hdGVEb21haW5TdGFja1RlbXBsYXRlKHRlbXBsYXRlOiBUZW1wbGF0ZSkge1xuICAgIC8vIENoZWNrIHRoYXQgdXNlVW5zaWduZWRCYXNpY0F1dGggYWNjZXNzIHBvbGljeSBpcyBjcmVhdGVkXG4gICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKFwiQ3VzdG9tOjpPcGVuU2VhcmNoQWNjZXNzUG9saWN5XCIsIDEpXG4gICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKFwiQVdTOjpPcGVuU2VhcmNoU2VydmljZTo6RG9tYWluXCIsIDEpXG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKFwiQVdTOjpPcGVuU2VhcmNoU2VydmljZTo6RG9tYWluXCIsIHtcbiAgICAgICAgQWR2YW5jZWRTZWN1cml0eU9wdGlvbnM6IHtcbiAgICAgICAgICAgIEVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBNYXN0ZXJVc2VyT3B0aW9uczoge1xuICAgICAgICAgICAgICAgIE1hc3RlclVzZXJOYW1lOiBcImFkbWluXCIsXG4gICAgICAgICAgICAgICAgTWFzdGVyVXNlclBhc3N3b3JkOiBcInt7cmVzb2x2ZTpzZWNyZXRzbWFuYWdlcjphcm46YXdzOnNlY3JldHNtYW5hZ2VyOnVzLWVhc3QtMToxMjM0NTY3ODkxMjM6c2VjcmV0Om1hc3Rlci11c2VyLW9zLXBhc3MtMTIzYWJjOlNlY3JldFN0cmluZzo6On19XCJcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pXG59Il19