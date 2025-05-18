import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as AirflowEcs1 from '../lib/airflow-ecs-1-stack';

test('Airflow ECS Stack Snapshot', () => {
  const app = new cdk.App();
  const stack = new AirflowEcs1.AirflowEcs1Stack(app, 'MyTestStack');
  
  // Generate the CloudFormation template
  const template = Template.fromStack(stack);
  
  // Generate a snapshot of important resource types
  // This validates that the structure of our template doesn't change unexpectedly
  const snapshot = {
    // VPC resources
    vpc: filterByType(template, ['AWS::EC2::VPC']),
    subnets: filterByType(template, ['AWS::EC2::Subnet']),
    
    // Security group resources
    securityGroups: filterByType(template, ['AWS::EC2::SecurityGroup']),
    securityGroupIngress: filterByType(template, ['AWS::EC2::SecurityGroupIngress']),
    
    // Database resources
    rds: filterByType(template, ['AWS::RDS::DBInstance']),
    redis: filterByType(template, ['AWS::ElastiCache::CacheCluster']),
    
    // EFS resources
    efs: filterByType(template, ['AWS::EFS::FileSystem']),
    efsAccessPoint: filterByType(template, ['AWS::EFS::AccessPoint']),
    
    // ECS resources
    ecsCluster: filterByType(template, ['AWS::ECS::Cluster']),
    ecsTaskDefinition: filterByType(template, ['AWS::ECS::TaskDefinition']),
    ecsService: filterByType(template, ['AWS::ECS::Service']),
    
    // Load balancer resources
    loadBalancer: filterByType(template, ['AWS::ElasticLoadBalancingV2::LoadBalancer']),
    
    // Log resources
    logGroups: filterByType(template, ['AWS::Logs::LogGroup']),
    
    // IAM resources
    iamRoles: filterByType(template, ['AWS::IAM::Role']),
    
    // Outputs
    outputs: template.findOutputs('*')
  };
  
  // Verify the snapshot contains the expected resources
  expect(Object.keys(snapshot.vpc).length).toBeGreaterThan(0);
  expect(Object.keys(snapshot.subnets).length).toBeGreaterThan(0);
  expect(Object.keys(snapshot.securityGroups).length).toBeGreaterThan(0);
  expect(Object.keys(snapshot.securityGroupIngress).length).toBeGreaterThan(0);
  expect(Object.keys(snapshot.rds).length).toBeGreaterThan(0);
  expect(Object.keys(snapshot.redis).length).toBeGreaterThan(0);
  expect(Object.keys(snapshot.efs).length).toBeGreaterThan(0);
  expect(Object.keys(snapshot.efsAccessPoint).length).toBeGreaterThan(0);
  expect(Object.keys(snapshot.ecsCluster).length).toBeGreaterThan(0);
  expect(Object.keys(snapshot.ecsTaskDefinition).length).toBeGreaterThan(0);
  expect(Object.keys(snapshot.ecsService).length).toBeGreaterThan(0);
  expect(Object.keys(snapshot.loadBalancer).length).toBeGreaterThan(0);
  expect(Object.keys(snapshot.logGroups).length).toBeGreaterThan(0);
  expect(Object.keys(snapshot.iamRoles).length).toBeGreaterThan(0);
  expect(Object.keys(snapshot.outputs).length).toBeGreaterThan(0);
  
  // Store a snapshot of the resources for future reference
  expect(snapshot).toMatchSnapshot();
});

// Helper function to filter template resources by type
function filterByType(template: Template, types: string[]): Record<string, any> {
  const resources: Record<string, any> = {};
  
  for (const type of types) {
    const found = template.findResources(type);
    Object.assign(resources, found);
  }
  
  return resources;
} 