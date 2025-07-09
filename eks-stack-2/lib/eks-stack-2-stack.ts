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

    // Create namespace for cluster autoscaler
    const autoscalerNamespace = cluster.addManifest('ClusterAutoscalerNamespace', {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name: 'cluster-autoscaler',
      },
    });

    // Create RBAC role for cluster autoscaler
    const autoscalerRole = cluster.addManifest('ClusterAutoscalerRole', {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'Role',
      metadata: {
        name: 'cluster-autoscaler',
        namespace: 'cluster-autoscaler',
      },
      rules: [
        {
          apiGroups: [''],
          resources: ['pods'],
          verbs: ['get', 'list', 'watch'],
        },
      ],
    });
    autoscalerRole.node.addDependency(autoscalerNamespace);

    // Create RBAC role binding
    const autoscalerRoleBinding = cluster.addManifest('ClusterAutoscalerRoleBinding', {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: {
        name: 'cluster-autoscaler',
        namespace: 'cluster-autoscaler',
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'Role',
        name: 'cluster-autoscaler',
      },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: 'cluster-autoscaler',
          namespace: 'kube-system',
        },
      ],
    });
    autoscalerRoleBinding.node.addDependency(autoscalerRole);

    // Add cluster autoscaler deployment with dependencies
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
        replicas: 1,
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

    // Add explicit dependencies
    clusterAutoscaler.node.addDependency(clusterAutoscalerServiceAccount);
    clusterAutoscaler.node.addDependency(autoscalerRoleBinding);

    // Deploy Nginx pods with dependency on autoscaler
    const nginxDeployment = cluster.addManifest('NginxDeployment', {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: 'nginx-deployment',
        namespace: 'default',
        labels: {
          app: 'nginx'
        }
      },
      spec: {
        replicas: 2,
        selector: {
          matchLabels: {
            app: 'nginx'
          }
        },
        template: {
          metadata: {
            labels: {
              app: 'nginx'
            }
          },
          spec: {
            containers: [{
              name: 'nginx',
              image: 'nginx:1.25',
              ports: [{
                containerPort: 80
              }],
              resources: {
                requests: {
                  cpu: '100m',
                  memory: '128Mi'
                },
                limits: {
                  cpu: '200m',
                  memory: '256Mi'
                }
              }
            }]
          }
        }
      }
    });

    // Create Kubernetes Service for Nginx
    const nginxService = cluster.addManifest('NginxService', {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: 'nginx-service',
        namespace: 'default'
      },
      spec: {
        type: 'NodePort',
        ports: [{
          port: 80,
          targetPort: 80,
          protocol: 'TCP'
        }],
        selector: {
          app: 'nginx'
        }
      }
    });

    // Create ALB Ingress for Nginx
    const nginxIngress = cluster.addManifest('NginxIngress', {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: 'nginx-ingress',
        namespace: 'default',
        annotations: {
          'kubernetes.io/ingress.class': 'alb',
          'alb.ingress.kubernetes.io/scheme': 'internet-facing',
          'alb.ingress.kubernetes.io/target-type': 'ip',
          'alb.ingress.kubernetes.io/healthcheck-path': '/'
        }
      },
      spec: {
        rules: [{
          http: {
            paths: [{
              path: '/',
              pathType: 'Prefix',
              backend: {
                service: {
                  name: 'nginx-service',
                  port: {
                    number: 80
                  }
                }
              }
            }]
          }
        }]
      }
    });

    // Add dependency to ensure ALB Controller is ready before creating ingress
    nginxIngress.node.addDependency(albController);

    // Add new output for Nginx Ingress URL
    new CfnOutput(this, 'NginxIngressUrl', {
      value: 'http://' + alb.loadBalancerDnsName,
      description: 'URL for accessing Nginx deployment',
      exportName: `${this.stackName}-NginxUrl`,
    });

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
