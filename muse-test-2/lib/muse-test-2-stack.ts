import * as path from 'path';
import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import * as ssm from 'aws-cdk-lib/aws-ssm';

const APP_DIR = path.join(__dirname, '..', 'app');
const BOOTSTRAP = path.join(__dirname, '..', 'assets', 'bootstrap.sh');

export interface MuseTest2StackProps extends StackProps {
  /** Bedrock inference profile ID for the agent, e.g. `global.anthropic.claude-sonnet-5-5`. */
  readonly bedrockModelId?: string;
  /** Bedrock embedding model for pgvector memory. */
  readonly embedModelId?: string;
  /** Domains the agent may browse without asking first. Everything else needs approval. */
  readonly allowedDomains?: string[];
  readonly instanceType?: ec2.InstanceType;
}

/**
 * Approach B of `doc/build-your-own-muse.md`: one EC2 host running separated
 * services with Docker Compose (see `app/compose.yaml`).
 *
 * As in v1 there is no ingress; the UI is reached through an SSM tunnel. What
 * v2 adds at the infrastructure level is a release path that keeps state: the
 * app zip's S3 location is published to SSM, and a deploy that changes it runs
 * `muse-release` on the box instead of replacing it, so Postgres survives.
 */
export class MuseTest2Stack extends Stack {
  constructor(scope: Construct, id: string, props: MuseTest2StackProps = {}) {
    super(scope, id, props);

    const modelId = props.bedrockModelId ?? 'global.anthropic.claude-sonnet-5-5';
    const embedModelId = props.embedModelId ?? 'amazon.titan-embed-text-v2:0';

    // Egress only, so a public subnet replaces a NAT gateway.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC }],
    });

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc,
      description: 'Muse v2 host -- egress only, no inbound',
      allowAllOutbound: true,
    });

    const role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'Muse v2 host',
    });
    role.addToPolicy(bedrockInvoke(this, modelId));
    role.addToPolicy(bedrockInvoke(this, embedModelId));

    const app = new s3assets.Asset(this, 'App', {
      path: APP_DIR,
      exclude: ['.venv', '.pytest_cache', '**/__pycache__', 'tests'],
    });
    const bootstrap = new s3assets.Asset(this, 'Bootstrap', { path: BOOTSTRAP });
    app.grantRead(role);
    bootstrap.grantRead(role);

    // A literal name (not a token) so user data stays fixed as releases come and go.
    const appParam = `/${this.stackName}/app-zip`;
    const appZip = new ssm.StringParameter(this, 'AppZip', {
      parameterName: appParam,
      description: 'S3 URL of the app release muse-release deploys',
      stringValue: app.s3ObjectUrl,
    });
    appZip.grantRead(role);

    // No app reference in user data: only a bootstrap change replaces the box.
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euxo pipefail',
      'install -d -m 0700 /etc/muse',
      "cat > /etc/muse/muse.env <<'ENVEOF'",
      `AWS_REGION=${this.region}`,
      `MUSE_MODEL_ID=${modelId}`,
      `MUSE_EMBED_MODEL_ID=${embedModelId}`,
      `MUSE_ALLOWED_DOMAINS=${(props.allowedDomains ?? []).join(',')}`,
      `MUSE_APP_PARAM=${appParam}`,
      'ENVEOF',
    );
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
      instanceType: props.instanceType ?? ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup,
      role,
      userData,
      userDataCausesReplacement: true,
      ssmSessionPermissions: true,
      // IMDSv2 only. Containers sit one network hop behind the host, and the worker and API need the
      // role's credentials; the browser cannot reach IMDS at all (internal networks + sentinel).
      httpTokens: ec2.HttpTokens.REQUIRED,
      httpPutResponseHopLimit: 2,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(40, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
    });

    // On every deploy that ships a new app zip, tell the box to release it.
    const release = new cr.AwsCustomResource(this, 'Release', {
      onCreate: {
        // The first boot releases by itself; creation only needs a harmless call.
        service: 'SSM',
        action: 'getParameter',
        parameters: { Name: appParam },
        physicalResourceId: cr.PhysicalResourceId.of('release'),
      },
      onUpdate: {
        service: 'SSM',
        action: 'sendCommand',
        parameters: {
          DocumentName: 'AWS-RunShellScript',
          InstanceIds: [instance.instanceId],
          Comment: `muse release ${app.assetHash}`,
          Parameters: { commands: ['/usr/local/bin/muse-release'] },
        },
        physicalResourceId: cr.PhysicalResourceId.of('release'),
        // A replaced box is still booting when this fires; its bootstrap releases by itself.
        ignoreErrorCodesMatching: 'InvalidInstanceId',
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['ssm:SendCommand'],
          resources: [
            this.formatArn({ service: 'ec2', resource: 'instance', resourceName: instance.instanceId }),
            this.formatArn({ service: 'ssm', account: '', resource: 'document', resourceName: 'AWS-RunShellScript' }),
          ],
        }),
        new iam.PolicyStatement({ actions: ['ssm:GetParameter'], resources: [appZip.parameterArn] }),
      ]),
      installLatestAwsSdk: false,
    });
    // The box must see the new parameter value and be allowed to read the new zip.
    release.node.addDependency(appZip);
    release.node.addDependency(role);

    new CfnOutput(this, 'InstanceId', { value: instance.instanceId });
    new CfnOutput(this, 'TunnelCommand', {
      description: 'Forward localhost:8080 to the API, then open http://localhost:8080',
      value:
        `aws ssm start-session --region ${this.region} --target ${instance.instanceId} ` +
        `--document-name AWS-StartPortForwardingSession --parameters portNumber=8080,localPortNumber=8080`,
    });
    new CfnOutput(this, 'ReleaseCommand', {
      description: 'Re-run the release by hand',
      value:
        `aws ssm send-command --region ${this.region} --instance-ids ${instance.instanceId} ` +
        `--document-name AWS-RunShellScript --parameters commands=/usr/local/bin/muse-release`,
    });
  }
}

/**
 * Permission to call one model on Bedrock.
 *
 * Current Claude models are invoked through an inference profile (the model ID
 * prefixed with a geography such as `global.` or `jp.`), which needs permission
 * on both the profile and the foundation model -- in whichever region the
 * profile routes to, hence the wildcard region. Bare IDs (e.g. Titan) need only
 * the foundation model.
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
