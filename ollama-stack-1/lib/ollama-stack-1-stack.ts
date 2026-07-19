import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * Simplest Ollama on EC2 (see doc/ollama-ec2-system-design.md).
 *
 * - Single t3.medium (CPU-only) in the default VPC
 * - One disk: the default root volume, bumped to 20 GB
 * - Security group fully open to the internet: 22 (SSH) + 11434 (Ollama API)
 * - Key pair created by CDK; download the private key from SSM
 * - User data installs Ollama, binds it to 0.0.0.0, and pulls a tiny model
 *
 * No DB, no queue, no load balancer, no separate EBS data volume.
 */
export class OllamaStack1Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Tweak these two if you want a different size/model.
    const instanceType = ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM);
    const model = 'llama3.2:1b';

    // Use the account's default VPC — nothing custom to manage.
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // "Full open to internet" security group.
    const sg = new ec2.SecurityGroup(this, 'OllamaSg', {
      vpc,
      description: 'Ollama - SSH + API open to the world',
      allowAllOutbound: true, // needs outbound to install Ollama + pull the model
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'SSH from anywhere');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(11434), 'Ollama API from anywhere');

    // Key pair created by CDK. Private key lands in SSM Parameter Store
    // at /ec2/keypair/<key-pair-id>; fetch it with the command in the outputs.
    const keyPair = new ec2.KeyPair(this, 'OllamaKeyPair', {
      keyPairName: 'ollama-stack-1-key',
    });

    // Ubuntu 22.04 LTS (amd64) via Canonical's public SSM parameter.
    const machineImage = ec2.MachineImage.fromSsmParameter(
      '/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id',
      { os: ec2.OperatingSystemType.LINUX },
    );

    // Boot script: install Ollama, expose it, pull the tiny model.
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -eux',
      'curl -fsSL https://ollama.com/install.sh | sh',
      'mkdir -p /etc/systemd/system/ollama.service.d',
      'cat > /etc/systemd/system/ollama.service.d/override.conf <<EOF',
      '[Service]',
      'Environment="OLLAMA_HOST=0.0.0.0:11434"',
      'EOF',
      'systemctl daemon-reload',
      'systemctl enable ollama',
      'systemctl restart ollama',
      'sleep 5',
      `ollama pull ${model}`,
    );

    const instance = new ec2.Instance(this, 'OllamaInstance', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType,
      machineImage,
      securityGroup: sg,
      keyPair,
      userData,
      associatePublicIpAddress: true,
      // One disk only: the default root volume, bumped to 20 GB gp3.
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            deleteOnTermination: true,
          }),
        },
      ],
    });

    new CfnOutput(this, 'PublicIp', {
      value: instance.instancePublicIp,
      description: 'Public IP of the Ollama instance',
    });
    new CfnOutput(this, 'SshCommand', {
      value: `ssh -i ollama-stack-1-key.pem ubuntu@${instance.instancePublicIp}`,
      description: 'SSH into the instance (after downloading the key, see DownloadKeyCommand)',
    });
    new CfnOutput(this, 'OllamaApiUrl', {
      value: `http://${instance.instancePublicIp}:11434`,
      description: 'Ollama API base URL',
    });
    new CfnOutput(this, 'TestApiCommand', {
      value:
        `curl http://${instance.instancePublicIp}:11434/api/generate -d ` +
        `'{"model":"${model}","prompt":"Why is the sky blue?","stream":false}'`,
      description: 'Quick test call once the instance has finished booting',
    });
    new CfnOutput(this, 'DownloadKeyCommand', {
      value:
        `aws ssm get-parameter --name /ec2/keypair/${keyPair.keyPairId} ` +
        `--with-decryption --query Parameter.Value --output text > ollama-stack-1-key.pem ` +
        `&& chmod 400 ollama-stack-1-key.pem`,
      description: 'Download the private key to ollama-stack-1-key.pem',
    });
  }
}
