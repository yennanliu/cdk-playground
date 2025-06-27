import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import {
  Stack,
  StackProps,
  Duration,
  CfnOutput,
  RemovalPolicy,
} from "aws-cdk-lib";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";

export class ElasticsearchStack2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create a VPC (1 AZ, minimal config)
    const vpc = new ec2.Vpc(this, "OpenSearchVpc", {
      maxAzs: 2,
    });

    // Security group allowing HTTPS access (port 443) from your IP
    const sg = new ec2.SecurityGroup(this, "OpenSearchSG", {
      vpc,
      description: "Allow HTTPS access to OpenSearch Domain",
      allowAllOutbound: true,
    });
    sg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow HTTPS from anywhere"
    );

    // IAM role for OpenSearch (optional if using fine-grained access control)
    const masterUserArn = new iam.AccountPrincipal(this.account);

    // Create OpenSearch domain
    const domain = new opensearch.Domain(this, "BlankOpenSearchDomain", {
      version: opensearch.EngineVersion.OPENSEARCH_2_11,
      domainName: "blank-opensearch-domain",
      removalPolicy: RemovalPolicy.DESTROY,
      capacity: {
        dataNodes: 1,
        dataNodeInstanceType: "t3.small.search",
      },
      ebs: {
        volumeSize: 10,
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

    new CfnOutput(this, "OpenSearchEndpoint", {
      value: domain.domainEndpoint,
      description: "OpenSearch HTTP Endpoint",
    });

    new CfnOutput(this, "DashboardsURL", {
      value: `https://${domain.domainEndpoint}/_dashboards/`,
      description: "OpenSearch Dashboards URL",
    });
  }
}
