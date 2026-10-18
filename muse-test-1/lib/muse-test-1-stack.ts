import * as path from 'path';
import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';

const APP_DIR = path.join(__dirname, '..', 'app');
const BOOTSTRAP = path.join(__dirname, '..', 'assets', 'bootstrap.sh');

export interface MuseTest1StackProps extends StackProps {
  /** Bedrock inference profile ID, e.g. `global.anthropic.claude-sonnet-5-5`. */
  readonly bedrockModelId?: string;
  /** Domains the agent may browse without asking first. Everything else needs approval. */
  readonly allowedDomains?: string[];
  readonly instanceType?: ec2.InstanceType;
}

/**
 * Approach A of `doc/build-your-own-muse.md`: a single EC2 "agent box".
 *
 * One instance runs the whole agent in a container -- web UI, agent loop,
 * headless Chromium, SQLite memory, scheduler. It is for one user and exists to
 * prove the agent is useful before paying for anything bigger.
 *
 * There is no ingress of any kind. The app listens on loopback and you reach it
 * through an SSM port-forwarding tunnel, so there is no login page to build and
 * nothing for the internet to scan.
 */
export class MuseTest1Stack extends Stack {
  constructor(scope: Construct, id: string, props: MuseTest1StackProps = {}) {
    super(scope, id, props);

    const modelId = props.bedrockModelId ?? 'global.anthropic.claude-sonnet-5-5';

    // Egress only, so a public subnet replaces a NAT gateway.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC }],
    });

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc,
      description: 'Muse agent box -- egress only, no inbound',
      allowAllOutbound: true,
    });

    const role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'Muse agent box',
    });
    role.addToPolicy(bedrockInvoke(this, modelId));

    const app = new s3assets.Asset(this, 'App', {
      path: APP_DIR,
      exclude: ['.venv', '.pytest_cache', '**/__pycache__', 'tests'],
    });
    const bootstrap = new s3assets.Asset(this, 'Bootstrap', { path: BOOTSTRAP });
    app.grantRead(role);
    bootstrap.grantRead(role);

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euxo pipefail',
      'install -d -m 0755 /etc/muse',
      "cat > /etc/muse/muse.env <<'ENVEOF'",
      `AWS_REGION=${this.region}`,
      `MUSE_MODEL_ID=${modelId}`,
      `MUSE_ALLOWED_DOMAINS=${(props.allowedDomains ?? []).join(',')}`,
      'ENVEOF',
    );
    userData.addS3DownloadCommand({
      bucket: app.bucket,
      bucketKey: app.s3ObjectKey,
      localFile: '/opt/muse/app.zip',
    });
    userData.addExecuteFileCommand({
      filePath: userData.addS3DownloadCommand({
        bucket: bootstrap.bucket,
        bucketKey: bootstrap.s3ObjectKey,
        localFile: '/opt/muse/bootstrap.sh',
      }),
    });

    const instance = new ec2.Instance(this, 'Host', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: props.instanceType ?? ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup,
      role,
      userData,
      // A new app release boots a new box. Approach A accepts that this resets
      // the SQLite state; see the README.
      userDataCausesReplacement: true,
      ssmSessionPermissions: true,
      requireImdsv2: true,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(30, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
    });

    new CfnOutput(this, 'InstanceId', { value: instance.instanceId });
    new CfnOutput(this, 'TunnelCommand', {
      description: 'Forward localhost:8080 to the agent, then open http://localhost:8080',
      value:
        `aws ssm start-session --region ${this.region} --target ${instance.instanceId} ` +
        `--document-name AWS-StartPortForwardingSession --parameters portNumber=8080,localPortNumber=8080`,
    });
  }
}

/**
 * Permission to call one Claude model on Bedrock.
 *
 * Current Claude models are invoked through an inference profile (the model ID
 * prefixed with a geography such as `global.` or `jp.`), which needs permission
 * on both the profile and the foundation model -- in whichever region the
 * profile routes to, hence the wildcard region.
 */
export function bedrockInvoke(stack: Stack, modelId: string): iam.PolicyStatement {
  const foundationModelId = modelId.replace(/^(global|us|eu|apac|jp)\./, '');
  return new iam.PolicyStatement({
    actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
    resources: [
      `arn:${stack.partition}:bedrock:*::foundation-model/${foundationModelId}`,
      ...(foundationModelId !== modelId
        ? [`arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/${modelId}`]
        : []),
    ],
  });
}
