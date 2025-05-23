import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as EcsWordpress2 from '../lib/ecs-wordpress-2-stack';

test('WordPress Infrastructure Created', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new EcsWordpress2.EcsWordpress2Stack(app, 'MyTestStack');
  // THEN

  const template = Template.fromStack(stack);

  // Test VPC creation
  template.resourceCountIs('AWS::EC2::VPC', 1);
  
  // Test ECS Cluster creation
  template.resourceCountIs('AWS::ECS::Cluster', 1);
  
  // Test ECS Service creation
  template.resourceCountIs('AWS::ECS::Service', 1);
  
  // Test ALB creation
  template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
  
  // Test RDS Database creation
  template.resourceCountIs('AWS::RDS::DBInstance', 1);
  
  // Test EFS creation
  template.resourceCountIs('AWS::EFS::FileSystem', 1);
  
  // Test Secrets Manager secret creation
  template.resourceCountIs('AWS::SecretsManager::Secret', 1);
  
  // Test that RDS instance has correct properties
  template.hasResourceProperties('AWS::RDS::DBInstance', {
    Engine: 'mysql',
    DBInstanceClass: 'db.t3.micro',
    DBName: 'wordpress'
  });
  
  // Test that ECS task definition has WordPress container
  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    ContainerDefinitions: Match.arrayWith([
      Match.objectLike({
        Name: 'wordpress',
        Image: 'wordpress:latest'
      })
    ])
  });
});

test('Security Groups Configured Correctly', () => {
  const app = new cdk.App();
  const stack = new EcsWordpress2.EcsWordpress2Stack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  // Test that we have the expected number of security groups
  template.resourceCountIs('AWS::EC2::SecurityGroup', 4); // ALB, ECS, RDS, EFS
  
  // Test ALB security group allows HTTP traffic
  template.hasResourceProperties('AWS::EC2::SecurityGroup', {
    GroupDescription: 'Security group for Application Load Balancer',
    SecurityGroupIngress: Match.arrayWith([
      Match.objectLike({
        IpProtocol: 'tcp',
        FromPort: 80,
        ToPort: 80,
        CidrIp: '0.0.0.0/0'
      })
    ])
  });
});
