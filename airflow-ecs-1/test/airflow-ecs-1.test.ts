import * as cdk from 'aws-cdk-lib';
import { Template, Match, Capture } from 'aws-cdk-lib/assertions';
import * as AirflowEcs1 from '../lib/airflow-ecs-1-stack';

describe('Airflow ECS Stack', () => {
  let app: cdk.App;
  let stack: AirflowEcs1.AirflowEcs1Stack;
  let template: Template;

  beforeAll(() => {
    app = new cdk.App();
    stack = new AirflowEcs1.AirflowEcs1Stack(app, 'MyTestStack');
    template = Template.fromStack(stack);
  });

  test('VPC is created correctly', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1);
    template.resourceCountIs('AWS::EC2::Subnet', 4); // 2 public subnets + 2 private subnets
    template.resourceCountIs('AWS::EC2::RouteTable', 4); // Route tables for each subnet
    template.resourceCountIs('AWS::EC2::NatGateway', 1); // 1 NAT Gateway as specified
  });

  test('Security Groups are created correctly', () => {
    // Main security groups for components
    template.resourceCountIs('AWS::EC2::SecurityGroup', 5); // Airflow, PostgreSQL, Redis, EFS, ALB
    
    // Test Airflow security group allows inbound on port 8080
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      FromPort: 8080,
      ToPort: 8080,
      IpProtocol: 'tcp',
    });
    
    // Test Redis security group allows inbound on port 6379
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      FromPort: 6379,
      ToPort: 6379,
      IpProtocol: 'tcp',
    });
    
    // Test PostgreSQL security group allows inbound on port 5432
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      FromPort: 5432,
      ToPort: 5432,
      IpProtocol: 'tcp',
    });
    
    // Test EFS security group allows inbound on port 2049
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      FromPort: 2049,
      ToPort: 2049,
      IpProtocol: 'tcp',
    });
  });

  test('Database resources are created correctly', () => {
    template.resourceCountIs('AWS::RDS::DBInstance', 1);
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      DBInstanceClass: 'db.t3.small',
      AllocatedStorage: '20',
      DBName: 'airflow',
    });
    
    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
  });

  test('Redis cache is created correctly', () => {
    template.resourceCountIs('AWS::ElastiCache::CacheCluster', 1);
    template.hasResourceProperties('AWS::ElastiCache::CacheCluster', {
      CacheNodeType: 'cache.t3.small',
      Engine: 'redis',
      NumCacheNodes: 1,
    });
    
    template.resourceCountIs('AWS::ElastiCache::SubnetGroup', 1);
  });

  test('EFS resources are created correctly', () => {
    template.resourceCountIs('AWS::EFS::FileSystem', 1);
    template.resourceCountIs('AWS::EFS::AccessPoint', 1);
    // Check for at least one mount target
    const mountTargets = template.findResources('AWS::EFS::MountTarget');
    expect(Object.keys(mountTargets).length).toBeGreaterThanOrEqual(1);
    
    // Verify EFS access point configuration
    template.hasResourceProperties('AWS::EFS::AccessPoint', {
      PosixUser: {
        Gid: '50000',
        Uid: '50000',
      },
      RootDirectory: {
        Path: '/dags',
      },
    });
  });

  test('ECS resources are created correctly', () => {
    template.resourceCountIs('AWS::ECS::Cluster', 1);
    template.resourceCountIs('AWS::ECS::TaskDefinition', 2); // Main task definition and init task definition
    template.resourceCountIs('AWS::ECS::Service', 2); // Main service and init service
    
    // Verify the main task definition has 4 containers (webserver, scheduler, worker, triggerer)
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'webserver',
        }),
        Match.objectLike({
          Name: 'scheduler',
        }),
        Match.objectLike({
          Name: 'worker',
        }),
        Match.objectLike({
          Name: 'triggerer',
        }),
      ]),
    });
    
    // Verify EFS volume is attached to task definition
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Volumes: Match.arrayWith([
        Match.objectLike({
          Name: 'efs-dags',
          EFSVolumeConfiguration: Match.objectLike({
            TransitEncryption: 'ENABLED',
          }),
        }),
      ]),
    });
  });

  test('Load balancer is configured correctly', () => {
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 1);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 1);
    
    // Verify the load balancer listener is on port 80
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      Protocol: 'HTTP',
    });
    
    // Verify the target group is configured with health check
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      Port: 8080,
      Protocol: 'HTTP',
      HealthCheckPath: '/health',
    });
  });

  test('IAM roles are configured correctly', () => {
    // Check for the right number of IAM roles and policies
    template.resourceCountIs('AWS::IAM::Role', 2); // Execution role and task role
    template.resourceCountIs('AWS::IAM::Policy', 2); // Policy for each role
    
    // EFS permissions should be present in one of the policies
    const policies = template.findResources('AWS::IAM::Policy');
    let efsPermissionFound = false;
    
    for (const policyId in policies) {
      const policy = policies[policyId];
      const statements = policy.Properties.PolicyDocument.Statement;
      
      for (const statement of statements) {
        if (statement.Action && 
            Array.isArray(statement.Action) && 
            statement.Action.includes('elasticfilesystem:ClientRootAccess')) {
          efsPermissionFound = true;
          break;
        }
      }
      
      if (efsPermissionFound) break;
    }
    
    expect(efsPermissionFound).toBe(true);
  });

  test('CloudWatch logs are created', () => {
    template.resourceCountIs('AWS::Logs::LogGroup', 5); // webserver, scheduler, worker, triggerer, init
    
    // Verify log groups have correct retention period
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 7,
    });
  });

  test('Stack outputs are defined', () => {
    template.hasOutput('AirflowUIUrl', {});
    template.hasOutput('AirflowCredentials', {});
    template.hasOutput('AirflowDBEndpoint', {});
    template.hasOutput('AirflowRedisEndpoint', {});
  });
});
