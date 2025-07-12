import { Duration, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as kubectl from '@aws-cdk/lambda-layer-kubectl-v31';
import { Construct } from 'constructs';

export class EksStack2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create VPC with public and private subnets across 3 AZs
    const vpc = new ec2.Vpc(this, 'EksVpc', {
      maxAzs: 3,
      natGateways: 1, // Single NAT Gateway for cost optimization
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // Enable VPC Flow Logs to CloudWatch
    const vpcFlowLogGroup = new logs.LogGroup(this, 'VpcFlowLogGroup', {
      logGroupName: `/aws/vpc/flowlogs/${this.stackName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: this.node.tryGetContext('retainLogs') ?
        require('aws-cdk-lib').RemovalPolicy.RETAIN :
        require('aws-cdk-lib').RemovalPolicy.DESTROY,
    });

    vpc.addFlowLog('VpcFlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(vpcFlowLogGroup),
      trafficType: ec2.FlowLogTrafficType.ALL,
    });

    // Create EKS Cluster
    const cluster = new eks.Cluster(this, 'EksCluster', {
      version: eks.KubernetesVersion.V1_31,
      vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      endpointAccess: eks.EndpointAccess.PUBLIC_AND_PRIVATE.onlyFrom(
        // Add your IP ranges here, for now allowing all (restrict in production)
        '0.0.0.0/0'
      ),
      defaultCapacity: 0, // We'll add managed node groups separately

      // Enable CloudWatch logging for control plane
      clusterLogging: [
        eks.ClusterLoggingTypes.API,
        eks.ClusterLoggingTypes.AUTHENTICATOR,
        eks.ClusterLoggingTypes.SCHEDULER,
        eks.ClusterLoggingTypes.CONTROLLER_MANAGER,
        eks.ClusterLoggingTypes.AUDIT,
      ],
      kubectlLayer: new kubectl.KubectlV31Layer(this, 'KubectlLayer'),
    });

    // Create CloudWatch Log Group for Container Insights
    const containerInsightsLogGroup = new logs.LogGroup(this, 'ContainerInsightsLogGroup', {
      logGroupName: `/aws/containerinsights/${cluster.clusterName}/performance`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: this.node.tryGetContext('retainLogs') ?
        require('aws-cdk-lib').RemovalPolicy.RETAIN :
        require('aws-cdk-lib').RemovalPolicy.DESTROY,
    });

    // Add managed node group with cost-optimized configuration
    const nodeGroup = cluster.addNodegroupCapacity('EksNodeGroup', {
      instanceTypes: [new ec2.InstanceType('t3.medium')],
      minSize: 1,
      maxSize: 5,
      desiredSize: 2,
      amiType: eks.NodegroupAmiType.AL2_X86_64,
      capacityType: eks.CapacityType.ON_DEMAND, // Change to SPOT for additional cost savings
      diskSize: 30, // GB
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },

      // Tagging for cost allocation
      tags: {
        'Environment': 'dev',
        'Application': 'eks-stack-1',
        'CostCenter': 'development',
      },
    });

    // Install AWS Load Balancer Controller
    const albController = new eks.AlbController(this, 'ALBController', {
      cluster,
      version: eks.AlbControllerVersion.V2_8_2,
    });

    // Create Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'EksALB', {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      deletionProtection: false, // Set to true in production
    });

    // Add CloudWatch alarms for cluster monitoring
    const clusterCpuAlarm = new cloudwatch.Alarm(this, 'ClusterHighCPU', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EKS',
        metricName: 'cluster_cpu_utilization',
        dimensionsMap: {
          ClusterName: cluster.clusterName,
        },
        statistic: 'Average',
        period: Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Enable Container Insights for the cluster
    cluster.addManifest('ContainerInsights', {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name: 'amazon-cloudwatch',
        labels: {
          name: 'amazon-cloudwatch',
        },
      },
    });

    // Add cluster autoscaler
    const clusterAutoscaler = cluster.addManifest('ClusterAutoscaler', {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: 'cluster-autoscaler',
        namespace: 'kube-system',
        labels: {
          app: 'cluster-autoscaler',
        },
      },
      spec: {
        selector: {
          matchLabels: {
            app: 'cluster-autoscaler',
          },
        },
        template: {
          metadata: {
            labels: {
              app: 'cluster-autoscaler',
            },
          },
          spec: {
            serviceAccountName: 'cluster-autoscaler',
            containers: [
              {
                image: 'registry.k8s.io/autoscaling/cluster-autoscaler:v1.30.0',
                name: 'cluster-autoscaler',
                resources: {
                  limits: {
                    cpu: '100m',
                    memory: '300Mi',
                  },
                  requests: {
                    cpu: '100m',
                    memory: '300Mi',
                  },
                },
                command: [
                  './cluster-autoscaler',
                  '--v=4',
                  '--stderrthreshold=info',
                  '--cloud-provider=aws',
                  '--skip-nodes-with-local-storage=false',
                  '--expander=least-waste',
                  `--node-group-auto-discovery=asg:tag=k8s.io/cluster-autoscaler/enabled,k8s.io/cluster-autoscaler/${cluster.clusterName}`,
                ],
                env: [
                  {
                    name: 'AWS_REGION',
                    value: this.region,
                  },
                ],
              },
            ],
          },
        },
      },
    });

    // Create service account for cluster autoscaler
    const clusterAutoscalerServiceAccount = cluster.addServiceAccount('ClusterAutoscalerServiceAccount', {
      name: 'cluster-autoscaler',
      namespace: 'kube-system',
    });

    // Add IAM policy for cluster autoscaler
    clusterAutoscalerServiceAccount.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'autoscaling:DescribeAutoScalingGroups',
          'autoscaling:DescribeAutoScalingInstances',
          'autoscaling:DescribeLaunchConfigurations',
          'autoscaling:DescribeTags',
          'autoscaling:SetDesiredCapacity',
          'autoscaling:TerminateInstanceInAutoScalingGroup',
          'ec2:DescribeLaunchTemplateVersions',
          'ec2:DescribeInstanceTypes',
        ],
        resources: ['*'],
      })
    );

    // Outputs for easy access
    new CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      description: 'EKS Cluster Name',
      exportName: `${this.stackName}-ClusterName`,
    });

    new CfnOutput(this, 'ClusterEndpoint', {
      value: cluster.clusterEndpoint,
      description: 'EKS Cluster Endpoint',
      exportName: `${this.stackName}-ClusterEndpoint`,
    });

    new CfnOutput(this, 'ALBArn', {
      value: alb.loadBalancerArn,
      description: 'Application Load Balancer ARN',
      exportName: `${this.stackName}-ALBArn`,
    });

    new CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID',
      exportName: `${this.stackName}-VpcId`,
    });

    new CfnOutput(this, 'ConfigCommand', {
      value: `aws eks update-kubeconfig --region ${this.region} --name ${cluster.clusterName}`,
      description: 'Command to configure kubectl',
    });
  }
}
