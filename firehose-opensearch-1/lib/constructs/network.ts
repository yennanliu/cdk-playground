import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface NetworkConstructProps {
  readonly vpcName?: string;
  readonly vpcCidr?: string;
  readonly maxAzs?: number;
  readonly natGateways?: number;
  readonly enableDnsHostnames?: boolean;
  readonly enableDnsSupport?: boolean;
  readonly removalPolicy?: RemovalPolicy;
}

export class NetworkConstruct extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly privateSubnets: ec2.ISubnet[];
  public readonly publicSubnets: ec2.ISubnet[];
  public readonly openSearchSecurityGroup: ec2.SecurityGroup;
  public readonly firehoseSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkConstructProps = {}) {
    super(scope, id);

    // Create VPC
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(props.vpcCidr || '10.0.0.0/16'),
      maxAzs: props.maxAzs || 2,
      natGateways: props.natGateways || 1,
      enableDnsHostnames: props.enableDnsHostnames ?? true,
      enableDnsSupport: props.enableDnsSupport ?? true,
      
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 28,
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // Store subnet references
    this.privateSubnets = this.vpc.privateSubnets;
    this.publicSubnets = this.vpc.publicSubnets;

    // Create security group for OpenSearch
    this.openSearchSecurityGroup = new ec2.SecurityGroup(this, 'OpenSearchSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for OpenSearch domain',
      allowAllOutbound: true,
    });

    // Allow HTTPS traffic from within VPC for OpenSearch
    this.openSearchSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'Allow HTTPS from VPC'
    );

    // Allow HTTP traffic from within VPC for OpenSearch (if needed for development)
    this.openSearchSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(80),
      'Allow HTTP from VPC'
    );

    // Create security group for Firehose (if needed for VPC endpoints)
    this.firehoseSecurityGroup = new ec2.SecurityGroup(this, 'FirehoseSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Firehose delivery stream',
      allowAllOutbound: true,
    });

    // Allow HTTPS traffic for Firehose
    this.firehoseSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'Allow HTTPS from VPC'
    );

    // Create VPC endpoints for AWS services (optional but recommended)
    this.createVpcEndpoints();
  }

  private createVpcEndpoints(): void {
    // S3 Gateway endpoint (for Firehose backup)
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [
        {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // CloudWatch Logs VPC endpoint (for Firehose logging)
    this.vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [this.firehoseSecurityGroup],
    });

    // Kinesis Firehose VPC endpoint
    this.vpc.addInterfaceEndpoint('FirehoseEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.KINESIS_FIREHOSE,
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [this.firehoseSecurityGroup],
    });
  }

  /**
   * Add ingress rule to OpenSearch security group
   */
  public addOpenSearchIngressRule(peer: ec2.IPeer, port: ec2.Port, description?: string): void {
    this.openSearchSecurityGroup.addIngressRule(peer, port, description);
  }

  /**
   * Add ingress rule to Firehose security group
   */
  public addFirehoseIngressRule(peer: ec2.IPeer, port: ec2.Port, description?: string): void {
    this.firehoseSecurityGroup.addIngressRule(peer, port, description);
  }

  /**
   * Get private subnets for specific AZ
   */
  public getPrivateSubnetByAz(availabilityZone: string): ec2.ISubnet | undefined {
    return this.privateSubnets.find(subnet => subnet.availabilityZone === availabilityZone);
  }

  /**
   * Get public subnets for specific AZ
   */
  public getPublicSubnetByAz(availabilityZone: string): ec2.ISubnet | undefined {
    return this.publicSubnets.find(subnet => subnet.availabilityZone === availabilityZone);
  }
}