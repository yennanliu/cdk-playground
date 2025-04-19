import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

export class MysqlReadWriteReplicaStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create a VPC with public and private subnets across multiple AZs
    const vpc = new ec2.Vpc(this, 'MysqlVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // Create a security group for the MySQL database instances
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'MysqlSecurityGroup', {
      vpc,
      description: 'Security group for MySQL RDS instances',
      allowAllOutbound: true,
    });

    // Allow inbound MySQL traffic (port 3306) from within the VPC
    dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(3306),
      'Allow MySQL access from within the VPC'
    );

    // Create the primary MySQL instance
    const primaryInstance = new rds.DatabaseInstance(this, 'MysqlPrimaryInstance', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.MEDIUM
      ),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [dbSecurityGroup],
      databaseName: 'mydb',
      storageEncrypted: true,
      multiAz: false,
      autoMinorVersionUpgrade: true,
      allocatedStorage: 20,
      backupRetention: Duration.days(7),
      deleteAutomatedBackups: true,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY, // For demo only - use SNAPSHOT or RETAIN in production
      credentials: rds.Credentials.fromGeneratedSecret('admin', {
        secretName: 'mysql-primary-credentials',
      }),
    });

    // Create a read replica in a different AZ
    const readReplica = new rds.DatabaseInstanceReadReplica(this, 'MysqlReadReplica', {
      sourceDatabaseInstance: primaryInstance,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.MEDIUM
      ),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [dbSecurityGroup],
      removalPolicy: RemovalPolicy.DESTROY, // For demo only - use SNAPSHOT or RETAIN in production
    });

    // Output the endpoints
    new CfnOutput(this, 'PrimaryEndpoint', {
      value: primaryInstance.dbInstanceEndpointAddress,
      description: 'The endpoint of the primary MySQL instance (write node)',
    });

    new CfnOutput(this, 'ReadReplicaEndpoint', {
      value: readReplica.dbInstanceEndpointAddress,
      description: 'The endpoint of the MySQL read replica (read node)',
    });
  }
}
