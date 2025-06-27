import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { StackProps } from 'aws-cdk-lib';

export interface BaseStackProps extends StackProps {
    stackName?: string;
    dbSecret: secretsmanager.Secret;
    reportDbSecret: secretsmanager.Secret;
    supersetSecret: secretsmanager.Secret;
}

export interface DatabaseProps {
    vpc: ec2.Vpc;
    dbSecret: secretsmanager.Secret;
    reportDbSecret: secretsmanager.Secret;
}

export interface EcsServiceProps {
    vpc: ec2.Vpc;
    cluster: ecs.Cluster;
    taskDefinition: ecs.FargateTaskDefinition;
    securityGroup: ec2.SecurityGroup;
}

export interface LoadBalancerProps {
    vpc: ec2.Vpc;
    services: ecs.FargateService[];
    ecsSecurityGroup: ec2.SecurityGroup;
}
