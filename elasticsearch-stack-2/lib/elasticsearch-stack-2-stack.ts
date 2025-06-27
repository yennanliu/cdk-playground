import { Stack, StackProps, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";

export class ElasticsearchStack2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ✅ Create a VPC across 2 AZs
    const vpc = new ec2.Vpc(this, "OpenSearchVpc", {
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // ✅ Security Group to allow HTTPS access (for testing/demo)
    const sg = new ec2.SecurityGroup(this, "OpenSearchSG", {
      vpc,
      description: "Allow HTTPS access to OpenSearch",
      allowAllOutbound: true,
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "Allow HTTPS");

    // ✅ Create OpenSearch Domain with zone awareness enabled
    const domain = new opensearch.Domain(this, "BlankOpenSearchDomain", {
      version: opensearch.EngineVersion.OPENSEARCH_2_11,
      domainName: "blank-opensearch-domain",
      removalPolicy: RemovalPolicy.DESTROY,
      capacity: {
        dataNodes: 2,
        dataNodeInstanceType: "m5.large.search",
      },
      ebs: {
        volumeSize: 10,
      },
      zoneAwareness: {
        enabled: true,
        availabilityZoneCount: 2, // required when enabling zone awareness
      },
      vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      securityGroups: [sg],
      enforceHttps: true,
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true,
      },
      accessPolicies: [
        new iam.PolicyStatement({
          actions: ["es:*"],
          effect: iam.Effect.ALLOW,
          principals: [new iam.AnyPrincipal()],
          resources: ["*"],
        }),
      ],
    });

    // ✅ Outputs
    new CfnOutput(this, "OpenSearchEndpoint", {
      value: domain.domainEndpoint,
      description: "OpenSearch Endpoint",
    });

    new CfnOutput(this, "DashboardsURL", {
      value: `https://${domain.domainEndpoint}/_dashboards/`,
      description: "OpenSearch Dashboards URL",
    });
  }
}
