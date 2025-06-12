import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { BaseStackProps } from './types';

export class BaseStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly dbSecret: secretsmanager.Secret;
  public readonly reportDbSecret: secretsmanager.Secret;
  public readonly supersetSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, props);

    this.vpc = this.createVpc();
    this.dbSecret = props.dbSecret;
    this.reportDbSecret = props.reportDbSecret;
    this.supersetSecret = props.supersetSecret;
  }

  private createVpc(): ec2.Vpc {
    return new ec2.Vpc(this, 'SupersetVpc', {
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'PublicSubnet',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'PrivateSubnet',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }
      ]
    });
  }

  private createSecret(id: string): secretsmanager.Secret {
    return new secretsmanager.Secret(this, id, {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\\'',
      },
    });
  }

  private createSupersetSecret(): secretsmanager.Secret {
    return new secretsmanager.Secret(this, 'SupersetSecretKey', {
      generateSecretString: {
        secretStringTemplate: '{}',
        generateStringKey: 'secret_key',
        excludeCharacters: '"@/\\\'',
      },
    });
  }
}
