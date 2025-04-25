import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class GitlabDeploymentStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create a VPC
    const vpc = new ec2.Vpc(this, 'GitLabVPC', {
      maxAzs: 2,
      natGateways: 1,
    });

    // Create a security group for the EC2 instance
    const gitlabSG = new ec2.SecurityGroup(this, 'GitLabSecurityGroup', {
      vpc,
      description: 'Security group for GitLab EC2 instance',
      allowAllOutbound: true,
    });

    // Allow HTTP, HTTPS and SSH inbound traffic
    gitlabSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP from anywhere');
    gitlabSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS from anywhere');
    gitlabSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH from anywhere');

    // Create a security group for the RDS instance
    const dbSG = new ec2.SecurityGroup(this, 'GitLabDBSecurityGroup', {
      vpc,
      description: 'Security group for GitLab RDS instance',
      allowAllOutbound: true,
    });

    // Allow PostgreSQL inbound traffic from the GitLab EC2 instance
    dbSG.addIngressRule(gitlabSG, ec2.Port.tcp(5432), 'Allow PostgreSQL from GitLab');

    // Create an RDS instance for GitLab
    const gitlabDB = new rds.DatabaseInstance(this, 'GitLabDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_14,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [dbSG],
      multiAz: false,
      allocatedStorage: 20,
      storageType: rds.StorageType.GP2,
      databaseName: 'gitlabdb',
      credentials: rds.Credentials.fromGeneratedSecret('postgres'),
      backupRetention: Duration.days(7),
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY, // Note: Use SNAPSHOT or RETAIN in production
    });

    // Create a role for the EC2 instance
    const ec2Role = new iam.Role(this, 'GitLabEC2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    // Add permissions to access parameter store for RDS credentials
    ec2Role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
    );
    
    // Add permissions to read the RDS secret
    gitlabDB.secret?.grantRead(ec2Role);

    // GitLab EC2 instance
    const ec2Instance = new ec2.Instance(this, 'GitLabInstance', {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroup: gitlabSG,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.XLARGE),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      role: ec2Role,
      keyName: 'gitlab-key', // Note: You need to create this key pair in the AWS console
    });

    // Install GitLab using user data script
    const userDataScript = ec2.UserData.forLinux();
    userDataScript.addCommands(
      'yum update -y',
      'yum install -y curl policycoreutils openssh-server perl jq',
      // Install PostgreSQL client
      'yum install -y postgresql15',
      // Get RDS endpoint and credentials from secrets manager
      'DB_SECRET=$(aws secretsmanager get-secret-value --secret-id ' + gitlabDB.secret!.secretName + ' --query SecretString --output text)',
      'DB_HOST=' + gitlabDB.dbInstanceEndpointAddress,
      'DB_PORT=' + gitlabDB.dbInstanceEndpointPort,
      'DB_NAME=gitlabdb',
      'DB_USER=$(echo $DB_SECRET | jq -r .username)',
      'DB_PASS=$(echo $DB_SECRET | jq -r .password)',
      // Add the GitLab repository
      'curl https://packages.gitlab.com/install/repositories/gitlab/gitlab-ce/script.rpm.sh | bash',
      // Install GitLab and configure it to use the external PostgreSQL database
      'EXTERNAL_URL="http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"',
      'yum install -y gitlab-ce',
      // Reconfigure GitLab to use external PostgreSQL
      'cat > /etc/gitlab/gitlab.rb << EOF',
      'external_url "$EXTERNAL_URL"',
      'gitlab_rails[\'db_adapter\'] = "postgresql"',
      'gitlab_rails[\'db_encoding\'] = "utf8"',
      'gitlab_rails[\'db_host\'] = "$DB_HOST"',
      'gitlab_rails[\'db_port\'] = "$DB_PORT"',
      'gitlab_rails[\'db_username\'] = "$DB_USER"',
      'gitlab_rails[\'db_password\'] = "$DB_PASS"',
      'gitlab_rails[\'db_database\'] = "$DB_NAME"',
      'EOF',
      // Reconfigure GitLab
      'gitlab-ctl reconfigure'
    );
    
    ec2Instance.addUserData(userDataScript.render());

    // Output the GitLab URL and how to access it
    new CfnOutput(this, 'GitLabURL', {
      value: `http://${ec2Instance.instancePublicDnsName}`,
      description: 'URL to access GitLab',
    });

    new CfnOutput(this, 'SSHCommand', {
      value: `ssh -i gitlab-key.pem ec2-user@${ec2Instance.instancePublicDnsName}`,
      description: 'Command to SSH into the GitLab instance',
    });

    new CfnOutput(this, 'GitLabDBSecretName', {
      value: gitlabDB.secret!.secretName,
      description: 'Secret name for GitLab database credentials',
    });
  }
}
