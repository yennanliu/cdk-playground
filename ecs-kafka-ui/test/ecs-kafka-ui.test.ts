import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as EcsKafkaUi from '../lib/ecs-kafka-ui-stack';

test('ECS Fargate Service with Kafka UI Created', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new EcsKafkaUi.EcsKafkaUiStack(app, 'MyTestStack');
  // THEN

  const template = Template.fromStack(stack);

  // Verify VPC is created
  template.resourceCountIs('AWS::EC2::VPC', 1);
  
  // Verify ECS Cluster is created
  template.resourceCountIs('AWS::ECS::Cluster', 1);
  
  // Verify Fargate Task Definition is created
  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    RequiresCompatibilities: ['FARGATE'],
    ContainerDefinitions: Match.arrayWith([
      Match.objectLike({
        Image: 'provectuslabs/kafka-ui:latest',
        Environment: Match.arrayWith([
          Match.objectLike({
            Name: 'DYNAMIC_CONFIG_ENABLED',
            Value: 'true'
          })
        ])
      })
    ])
  });
  
  // Verify Load Balancer is created
  template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
});
