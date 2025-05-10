import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Protocol } from "aws-cdk-lib/aws-ecs";

export class EcsN8nStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const domainName = "yen.n8n.com";
    const hostedZoneDomain = "n8n.com";

    // 1. Lookup Route53 Hosted Zone
    const domainZone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: hostedZoneDomain,
    });

    // 2. VPC (default 2 AZs)
    const vpc = new ec2.Vpc(this, "N8nVpc", {
      maxAzs: 2,
    });

    // 3. ECS Cluster
    const cluster = new ecs.Cluster(this, "N8nCluster", {
      vpc,
    });

    // 4. Create ACM TLS Certificate (validated via Route 53 DNS)
    const certificate = new certificatemanager.Certificate(this, "N8nCert", {
      domainName: domainName,
      validation: certificatemanager.CertificateValidation.fromDns(domainZone),
    });

    // 5. ECS Fargate Service behind ALB (with HTTPS)
    new ecs_patterns.ApplicationLoadBalancedFargateService(this, "N8nService", {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 1,
      publicLoadBalancer: true,
      domainName: domainName,
      domainZone: domainZone,
      certificate: certificate,
      //protocol: ecs_patterns.ApplicationProtocol.HTTPS,
     // protocol: Protocol.TCP,
      redirectHTTP: true,
      taskImageOptions: {
        containerPort: 5678,
        image: ecs.ContainerImage.fromRegistry("n8nio/n8n:latest"),
        environment: {
          N8N_BASIC_AUTH_ACTIVE: "true",
          N8N_BASIC_AUTH_USER: "admin",
          N8N_BASIC_AUTH_PASSWORD: "admin",
        },
      },
    });
  }
}
