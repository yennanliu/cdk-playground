import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";

export class EcsN8N1Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const domainName = "yen.n8n.com"; // 🔁 replace with your domain
    //const hostedZoneArn = "arn:aws:route53:::hostedzone/YOUR-HOSTED-ZONE-ID"; // optional, for validation

    // 1. VPC
    const vpc = new ec2.Vpc(this, "N8nVpc", {
      maxAzs: 2,
    });

    // 2. ECS Cluster
    const cluster = new ecs.Cluster(this, "N8nCluster", {
      vpc,
    });

    // 3. Create a TLS certificate (must validate via DNS or Email)
    const certificate = new certificatemanager.Certificate(this, "N8nCert", {
      domainName: domainName,
      validation: certificatemanager.CertificateValidation.fromDns(), // assumes you have Route53 setup
    });

    // 4. Fargate Service with HTTPS
    const service = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      "N8nService",
      {
        cluster,
        cpu: 512,
        memoryLimitMiB: 1024,
        desiredCount: 1,
        publicLoadBalancer: true,
        domainName: domainName,
        domainZone: undefined, // optionally set Route53 zone here if needed
        certificate: certificate, // 🛡️ enables HTTPS
        taskImageOptions: {
          containerPort: 5678,
          image: ecs.ContainerImage.fromRegistry("n8nio/n8n:latest"),
          environment: {
            N8N_BASIC_AUTH_ACTIVE: "true",
            N8N_BASIC_AUTH_USER: "admin",
            N8N_BASIC_AUTH_PASSWORD: "admin",
          },
        },
        protocol: ecs_patterns.ApplicationProtocol.HTTPS, // 🚀 enables HTTPS
        redirectHTTP: true, // optional: redirect HTTP to HTTPS
      }
    );
  }
}
