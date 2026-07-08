import { App } from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { LiteLlmGatewayStack1Stack } from '../lib/lite_llm-gateway-stack-1-stack';

function synth(): Template {
  const app = new App();
  const stack = new LiteLlmGatewayStack1Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

describe('LiteLLM gateway stack', () => {
  const template = synth();

  // --- Phase 1: network ---
  test('VPC spans 2 AZs with a single NAT gateway', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1);
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
    // 2 AZs x (public + private) = 4 subnets
    template.resourceCountIs('AWS::EC2::Subnet', 4);
  });

  // --- Phase 2: data & secrets ---
  test('provisions Aurora PostgreSQL Serverless v2, encrypted', () => {
    template.hasResourceProperties('AWS::RDS::DBCluster', {
      Engine: 'aurora-postgresql',
      StorageEncrypted: true,
      ServerlessV2ScalingConfiguration: Match.objectLike({
        MinCapacity: 0.5,
        MaxCapacity: 4,
      }),
    });
  });

  test('creates master key, salt key and DB credential secrets', () => {
    // master, salt, and the auto-generated DB credentials secret
    template.resourceCountIs('AWS::SecretsManager::Secret', 3);
  });

  // --- Phase 3: gateway service ---
  test('Fargate service runs 2 tasks', () => {
    template.hasResourceProperties('AWS::ECS::Service', Match.objectLike({
      DesiredCount: 2,
      LaunchType: 'FARGATE',
    }));
  });

  test('target group uses the LiteLLM liveness health check', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', Match.objectLike({
      HealthCheckPath: '/health/liveliness',
      Matcher: { HttpCode: '200' },
    }));
  });

  test('container listens on port 4000', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', Match.objectLike({
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          PortMappings: Match.arrayWith([Match.objectLike({ ContainerPort: 4000 })]),
        }),
      ]),
    }));
  });

  test('task role can invoke Bedrock', () => {
    template.hasResourceProperties('AWS::IAM::Policy', Match.objectLike({
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'bedrock:InvokeModel',
              'bedrock:InvokeModelWithResponseStream',
            ]),
          }),
        ]),
      }),
    }));
  });

  test('secrets are injected as ECS Secrets, never plaintext env', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', Match.objectLike({
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: 'DATABASE_PASSWORD' }),
            Match.objectLike({ Name: 'MASTER_KEY_RANDOM' }),
            Match.objectLike({ Name: 'SALT_KEY_RANDOM' }),
          ]),
        }),
      ]),
    }));
  });

  // --- Phase 4: scaling & observability ---
  test('service autoscales on CPU (target tracking)', () => {
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', Match.objectLike({
      MinCapacity: 2,
      MaxCapacity: 6,
    }));
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalingPolicy', Match.objectLike({
      PolicyType: 'TargetTrackingScaling',
      TargetTrackingScalingPolicyConfiguration: Match.objectLike({
        TargetValue: 60,
      }),
    }));
  });

  test('CloudWatch alarms publish to an SNS topic', () => {
    template.resourceCountIs('AWS::SNS::Topic', 1);
    // unhealthy hosts, 5xx, cpu, memory, db connections
    template.resourceCountIs('AWS::CloudWatch::Alarm', 5);
    template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
      AlarmActions: Match.anyValue(),
    }));
  });

  // --- Guards the "keep it simple" decision ---
  test('no Redis / ElastiCache is provisioned', () => {
    template.resourceCountIs('AWS::ElastiCache::CacheCluster', 0);
    template.resourceCountIs('AWS::ElastiCache::ReplicationGroup', 0);
  });

  // --- Drift guard ---
  test('template snapshot', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
