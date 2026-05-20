import { Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class OpenclawStack1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Single public subnet only — no NAT gateway needed since instance has a public IP
    const vpc = new ec2.Vpc(this, 'OpenClawVpc', {
      maxAzs: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
      natGateways: 0,
    });

    // Key pair — private key stored in SSM Parameter Store at /ec2/keypair/{keyPairId}
    const keyPair = new ec2.KeyPair(this, 'OpenClawKeyPair', {
      keyPairName: 'openclaw-key',
    });

    // All ports open to internet as requested
    const sg = new ec2.SecurityGroup(this, 'OpenClawSg', {
      vpc,
      description: 'OpenClaw EC2 — all ports open',
      allowAllOutbound: true,
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.allTraffic(), 'Allow all inbound IPv4');
    sg.addIngressRule(ec2.Peer.anyIpv6(), ec2.Port.allTraffic(), 'Allow all inbound IPv6');

    // IAM role: SSM Session Manager (no need to open port 22) + CloudWatch logs
    const role = new iam.Role(this, 'OpenClawRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });

    // Placeholder secret — set your LLM API key here after deploy, then start openclaw
    const apiKeySecret = new secretsmanager.Secret(this, 'OpenClawApiKey', {
      secretName: 'openclaw/llm-api-key',
      description: 'LLM API key for OpenClaw (populate after deploy)',
      removalPolicy: RemovalPolicy.DESTROY,
    });
    apiKeySecret.grantRead(role);

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euxo pipefail',
      'dnf update -y',

      // Node.js 20 via nodesource
      'curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -',
      'dnf install -y nodejs git chromium',

      // Clone and install OpenClaw
      'cd /opt && git clone https://github.com/openclaw/openclaw.git',
      'cd /opt/openclaw && npm install',

      // Write systemd unit
      'echo "[Unit]" > /etc/systemd/system/openclaw.service',
      'echo "Description=OpenClaw AI Agent" >> /etc/systemd/system/openclaw.service',
      'echo "After=network.target" >> /etc/systemd/system/openclaw.service',
      'echo "[Service]" >> /etc/systemd/system/openclaw.service',
      'echo "Type=simple" >> /etc/systemd/system/openclaw.service',
      'echo "User=ec2-user" >> /etc/systemd/system/openclaw.service',
      'echo "WorkingDirectory=/opt/openclaw" >> /etc/systemd/system/openclaw.service',
      'echo "ExecStart=/usr/bin/node index.js" >> /etc/systemd/system/openclaw.service',
      'echo "Restart=on-failure" >> /etc/systemd/system/openclaw.service',
      'echo "RestartSec=10" >> /etc/systemd/system/openclaw.service',
      'echo "EnvironmentFile=/opt/openclaw/.env" >> /etc/systemd/system/openclaw.service',
      'echo "[Install]" >> /etc/systemd/system/openclaw.service',
      'echo "WantedBy=multi-user.target" >> /etc/systemd/system/openclaw.service',

      // Placeholder .env — populate with API keys before starting
      'touch /opt/openclaw/.env',
      'chown -R ec2-user:ec2-user /opt/openclaw',

      'systemctl daemon-reload',
      'systemctl enable openclaw',
      'echo "OpenClaw setup complete" >> /var/log/openclaw-setup.log',
    );

    const instance = new ec2.Instance(this, 'OpenClawInstance', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: sg,
      role,
      keyPair,
      userData,
      blockDevices: [{
        deviceName: '/dev/xvda',
        volume: ec2.BlockDeviceVolume.ebs(50, {
          volumeType: ec2.EbsDeviceVolumeType.GP3,
          deleteOnTermination: true,
        }),
      }],
    });

    // Elastic IP for a stable public address across reboots
    const eip = new ec2.CfnEIP(this, 'OpenClawEip', {
      instanceId: instance.instanceId,
    });

    new CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      description: 'EC2 Instance ID',
    });
    new CfnOutput(this, 'PublicIp', {
      value: eip.ref,
      description: 'Elastic IP — stable public address',
    });
    new CfnOutput(this, 'KeyPairId', {
      value: keyPair.keyPairId,
      description: 'Key pair ID — used in the download command below',
    });
    new CfnOutput(this, 'DownloadKeyCommand', {
      value: `aws ssm get-parameter --name /ec2/keypair/${keyPair.keyPairId} --with-decryption --query Parameter.Value --output text > openclaw-key.pem && chmod 400 openclaw-key.pem`,
      description: 'Run this after deploy to download the private key',
    });
    new CfnOutput(this, 'SshCommand', {
      value: `ssh -i openclaw-key.pem ec2-user@${eip.ref}`,
      description: 'SSH into the instance after downloading the key',
    });
    new CfnOutput(this, 'ApiKeySecretArn', {
      value: apiKeySecret.secretArn,
      description: 'Set LLM API key here, then: sudo systemctl start openclaw',
    });
  }
}
