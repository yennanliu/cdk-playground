import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';


export class Ec2Wordpress1Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC with single AZ
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 1,
      subnetConfiguration: [
        {
          name: 'PublicSubnet',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'PrivateSubnet',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // Security group for EC2 - allow SSH and HTTP from anywhere
    const ec2Sg = new ec2.SecurityGroup(this, 'EC2SecurityGroup', {
      vpc,
      description: 'Allow SSH and HTTP access',
      allowAllOutbound: true,
    });
    ec2Sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH from anywhere');
    ec2Sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP from anywhere');

    // Security group for RDS - allow MySQL access only from EC2 SG
    const rdsSg = new ec2.SecurityGroup(this, 'RDSSecurityGroup', {
      vpc,
      description: 'Allow MySQL access from EC2 instances',
      allowAllOutbound: true,
    });
    rdsSg.addIngressRule(ec2Sg, ec2.Port.tcp(3306), 'Allow MySQL from EC2 instances');

    // Create a secret for RDS credentials
    const dbCredentialsSecret = new secretsmanager.Secret(this, 'DBCredentialsSecret', {
      secretName: `${id}-db-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'wordpress' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\\'',
      },
    });

    // RDS MySQL instance in private subnet
    const dbInstance = new rds.DatabaseInstance(this, 'WordpressRDS', {
      engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_0_28 }),
      vpc,
      credentials: rds.Credentials.fromSecret(dbCredentialsSecret),
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [rdsSg],
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      multiAz: false,
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
      publiclyAccessible: false,
    });

    // IAM Role for EC2 (optional - for SSM access, can skip if not needed)
    const role = new iam.Role(this, 'EC2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'),
      ],
    });

    // UserData script to bootstrap WordPress on EC2
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      // Update and install packages
      'yum update -y',
      'amazon-linux-extras enable php7.4',
      'yum clean metadata',
      'yum install -y httpd php php-mysqlnd php-fpm wget unzip jq',

      // Start Apache
      'systemctl start httpd',
      'systemctl enable httpd',

      // Download WordPress
      'wget https://wordpress.org/latest.zip -P /tmp',
      'unzip /tmp/latest.zip -d /var/www/html',
      'chown -R apache:apache /var/www/html/wordpress',

      // Get DB credentials from Secrets Manager
      `SECRET_VALUE=$(aws secretsmanager get-secret-value --secret-id ${dbCredentialsSecret.secretName} --region ${this.region} --query SecretString --output text)`,
      'DB_USERNAME=$(echo $SECRET_VALUE | jq -r .username)',
      'DB_PASSWORD=$(echo $SECRET_VALUE | jq -r .password)',

      // Setup wp-config.php
      'cp /var/www/html/wordpress/wp-config-sample.php /var/www/html/wordpress/wp-config.php',

      // Replace DB config placeholders using sed
      'sed -i "s/database_name_here/wordpressdb/g" /var/www/html/wordpress/wp-config.php',
      'sed -i "s/username_here/$DB_USERNAME/g" /var/www/html/wordpress/wp-config.php',
      'sed -i "s/password_here/$DB_PASSWORD/g" /var/www/html/wordpress/wp-config.php',
      `sed -i "s/localhost/${dbInstance.dbInstanceEndpointAddress}/g" /var/www/html/wordpress/wp-config.php`,

      // Set permissions
      'chown apache:apache /var/www/html/wordpress/wp-config.php',

      // Restart Apache to apply changes
      'systemctl restart httpd',
    );

    // EC2 instance in public subnet with public IP
    const ec2Instance = new ec2.Instance(this, 'WordpressEC2', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux(),
      securityGroup: ec2Sg,
      keyName: 'yen-wipro-aws-dev-key-2', // <-- replace with your EC2 key pair name for SSH access
      role,
      userData,
      associatePublicIpAddress: true,
    });

    // Output the EC2 public IP
    new cdk.CfnOutput(this, 'WordpressURL', {
      value: `http://${ec2Instance.instancePublicIp}/wordpress`,
      description: 'URL to access WordPress',
    });

    // Output DB secret ARN for reference
    new cdk.CfnOutput(this, 'DBSecretArn', {
      value: dbCredentialsSecret.secretArn,
      description: 'Secret ARN for the RDS credentials',
    });
  }
}
