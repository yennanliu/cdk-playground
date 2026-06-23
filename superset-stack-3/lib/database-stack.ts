import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';
import { DatabaseProps } from './types';

export class DatabaseStack extends cdk.Stack {
  public readonly database: rds.DatabaseInstance;
  public readonly reportDatabase: rds.DatabaseInstance;
  public readonly dbSecurityGroup: ec2.SecurityGroup;
  public readonly reportDbSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: DatabaseProps) {
    super(scope, id);

    this.dbSecurityGroup = this.createSecurityGroup(props.vpc, 'DatabaseSecurityGroup', false);
    this.reportDbSecurityGroup = this.createSecurityGroup(props.vpc, 'ReportDbSecurityGroup', true);

    this.database = this.createDatabase({
      id: 'SupersetDatabase',
      vpc: props.vpc,
      secret: props.dbSecret,
      securityGroup: this.dbSecurityGroup,
      dbName: 'superset',
      isPublic: false
    });

    this.reportDatabase = this.createDatabase({
      id: 'ReportingDatabase',
      vpc: props.vpc,
      secret: props.reportDbSecret,
      securityGroup: this.reportDbSecurityGroup,
      dbName: 'reporting',
      isPublic: true
    });
  }

  private createSecurityGroup(vpc: ec2.Vpc, id: string, isPublic: boolean): ec2.SecurityGroup {
    const sg = new ec2.SecurityGroup(this, id, {
      vpc,
      description: `Security group for ${id}`,
      allowAllOutbound: false,
    });

    if (isPublic) {
      sg.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(5432),
        'Allow PostgreSQL access from anywhere'
      );
    }

    return sg;
  }

  private createDatabase(props: {
    id: string;
    vpc: ec2.Vpc;
    secret: cdk.aws_secretsmanager.Secret;
    securityGroup: ec2.SecurityGroup;
    dbName: string;
    isPublic: boolean;
  }): rds.DatabaseInstance {
    return new rds.DatabaseInstance(this, props.id, {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_3,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      credentials: rds.Credentials.fromSecret(props.secret),
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: props.isPublic ? ec2.SubnetType.PUBLIC : ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      databaseName: props.dbName,
      securityGroups: [props.securityGroup],
      deletionProtection: false,
      backupRetention: cdk.Duration.days(props.isPublic ? 7 : 1),
      publiclyAccessible: props.isPublic,
      multiAz: false,
    });
  }
}
