import { Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import { Construct } from 'constructs';

export class EksStack3HpaStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create VPC with public and private subnets
    const vpc = new ec2.Vpc(this, 'EksVpc', {
      maxAzs: 2,
      natGateways: 1,
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
    });

    // Create EKS Cluster
    const cluster = new eks.Cluster(this, 'EksCluster', {
      version: eks.KubernetesVersion.V1_31,
      vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      defaultCapacity: 0,
    });

    // Add managed node group
    cluster.addNodegroupCapacity('NodeGroup', {
      instanceTypes: [new ec2.InstanceType('t3.medium')],
      minSize: 1,
      maxSize: 3,
      desiredSize: 2,
      diskSize: 20,
    });

    // Deploy Metrics Server (required for HPA)
    cluster.addManifest('MetricsServer', {
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata: {
        labels: {
          'k8s-app': 'metrics-server',
        },
        name: 'metrics-server',
        namespace: 'kube-system',
      },
    }, {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRole',
      metadata: {
        labels: {
          'k8s-app': 'metrics-server',
          'rbac.authorization.k8s.io/aggregate-to-admin': 'true',
          'rbac.authorization.k8s.io/aggregate-to-edit': 'true',
          'rbac.authorization.k8s.io/aggregate-to-view': 'true',
        },
        name: 'system:aggregated-metrics-reader',
      },
      rules: [
        {
          apiGroups: ['metrics.k8s.io'],
          resources: ['pods', 'nodes'],
          verbs: ['get', 'list', 'watch'],
        },
      ],
    }, {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRole',
      metadata: {
        labels: {
          'k8s-app': 'metrics-server',
        },
        name: 'system:metrics-server',
      },
      rules: [
        {
          apiGroups: [''],
          resources: ['nodes/metrics'],
          verbs: ['get'],
        },
        {
          apiGroups: [''],
          resources: ['pods', 'nodes'],
          verbs: ['get', 'list', 'watch'],
        },
      ],
    }, {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: {
        labels: {
          'k8s-app': 'metrics-server',
        },
        name: 'metrics-server-auth-reader',
        namespace: 'kube-system',
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'Role',
        name: 'extension-apiserver-authentication-reader',
      },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: 'metrics-server',
          namespace: 'kube-system',
        },
      ],
    }, {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRoleBinding',
      metadata: {
        labels: {
          'k8s-app': 'metrics-server',
        },
        name: 'metrics-server:system:auth-delegator',
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'ClusterRole',
        name: 'system:auth-delegator',
      },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: 'metrics-server',
          namespace: 'kube-system',
        },
      ],
    }, {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRoleBinding',
      metadata: {
        labels: {
          'k8s-app': 'metrics-server',
        },
        name: 'system:metrics-server',
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'ClusterRole',
        name: 'system:metrics-server',
      },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: 'metrics-server',
          namespace: 'kube-system',
        },
      ],
    }, {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        labels: {
          'k8s-app': 'metrics-server',
        },
        name: 'metrics-server',
        namespace: 'kube-system',
      },
      spec: {
        ports: [
          {
            name: 'https',
            port: 443,
            protocol: 'TCP',
            targetPort: 'https',
          },
        ],
        selector: {
          'k8s-app': 'metrics-server',
        },
      },
    }, {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        labels: {
          'k8s-app': 'metrics-server',
        },
        name: 'metrics-server',
        namespace: 'kube-system',
      },
      spec: {
        selector: {
          matchLabels: {
            'k8s-app': 'metrics-server',
          },
        },
        strategy: {
          rollingUpdate: {
            maxUnavailable: 0,
          },
        },
        template: {
          metadata: {
            labels: {
              'k8s-app': 'metrics-server',
            },
          },
          spec: {
            containers: [
              {
                args: [
                  '--cert-dir=/tmp',
                  '--secure-port=4443',
                  '--kubelet-preferred-address-types=InternalIP,ExternalIP,Hostname',
                  '--kubelet-use-node-status-port',
                  '--metric-resolution=15s',
                ],
                image: 'registry.k8s.io/metrics-server/metrics-server:v0.7.1',
                imagePullPolicy: 'IfNotPresent',
                livenessProbe: {
                  failureThreshold: 3,
                  httpGet: {
                    path: '/livez',
                    port: 'https',
                    scheme: 'HTTPS',
                  },
                  periodSeconds: 10,
                },
                name: 'metrics-server',
                ports: [
                  {
                    containerPort: 4443,
                    name: 'https',
                    protocol: 'TCP',
                  },
                ],
                readinessProbe: {
                  failureThreshold: 3,
                  httpGet: {
                    path: '/readyz',
                    port: 'https',
                    scheme: 'HTTPS',
                  },
                  initialDelaySeconds: 20,
                  periodSeconds: 10,
                },
                resources: {
                  requests: {
                    cpu: '100m',
                    memory: '200Mi',
                  },
                },
                securityContext: {
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  runAsNonRoot: true,
                  runAsUser: 1000,
                },
                volumeMounts: [
                  {
                    mountPath: '/tmp',
                    name: 'tmp-dir',
                  },
                ],
              },
            ],
            nodeSelector: {
              'kubernetes.io/os': 'linux',
            },
            priorityClassName: 'system-cluster-critical',
            serviceAccountName: 'metrics-server',
            volumes: [
              {
                emptyDir: {},
                name: 'tmp-dir',
              },
            ],
          },
        },
      },
    }, {
      apiVersion: 'apiregistration.k8s.io/v1',
      kind: 'APIService',
      metadata: {
        labels: {
          'k8s-app': 'metrics-server',
        },
        name: 'v1beta1.metrics.k8s.io',
      },
      spec: {
        group: 'metrics.k8s.io',
        groupPriorityMinimum: 100,
        insecureSkipTLSVerify: true,
        service: {
          name: 'metrics-server',
          namespace: 'kube-system',
        },
        version: 'v1beta1',
        versionPriority: 100,
      },
    });

    // Deploy PHP-Apache test application for HPA testing
    cluster.addManifest('PhpApacheDeployment', {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: 'php-apache',
        namespace: 'default',
      },
      spec: {
        replicas: 1,
        selector: {
          matchLabels: {
            app: 'php-apache',
          },
        },
        template: {
          metadata: {
            labels: {
              app: 'php-apache',
            },
          },
          spec: {
            containers: [
              {
                name: 'php-apache',
                image: 'registry.k8s.io/hpa-example',
                ports: [
                  {
                    containerPort: 80,
                  },
                ],
                resources: {
                  limits: {
                    cpu: '500m',
                    memory: '256Mi',
                  },
                  requests: {
                    cpu: '200m',
                    memory: '128Mi',
                  },
                },
              },
            ],
          },
        },
      },
    });

    // Create Service for PHP-Apache
    cluster.addManifest('PhpApacheService', {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: 'php-apache',
        namespace: 'default',
      },
      spec: {
        selector: {
          app: 'php-apache',
        },
        ports: [
          {
            protocol: 'TCP',
            port: 80,
            targetPort: 80,
          },
        ],
        type: 'ClusterIP',
      },
    });

    // Create HPA for PHP-Apache
    cluster.addManifest('PhpApacheHPA', {
      apiVersion: 'autoscaling/v2',
      kind: 'HorizontalPodAutoscaler',
      metadata: {
        name: 'php-apache-hpa',
        namespace: 'default',
      },
      spec: {
        scaleTargetRef: {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          name: 'php-apache',
        },
        minReplicas: 1,
        maxReplicas: 10,
        metrics: [
          {
            type: 'Resource',
            resource: {
              name: 'cpu',
              target: {
                type: 'Utilization',
                averageUtilization: 50,
              },
            },
          },
        ],
        behavior: {
          scaleDown: {
            stabilizationWindowSeconds: 300,
            policies: [
              {
                type: 'Percent',
                value: 50,
                periodSeconds: 15,
              },
            ],
          },
          scaleUp: {
            stabilizationWindowSeconds: 60,
            policies: [
              {
                type: 'Percent',
                value: 100,
                periodSeconds: 15,
              },
              {
                type: 'Pods',
                value: 4,
                periodSeconds: 15,
              },
            ],
            selectPolicy: 'Max',
          },
        },
      },
    });

    // Outputs
    new CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      description: 'EKS Cluster Name',
    });

    new CfnOutput(this, 'ConfigCommand', {
      value: `aws eks update-kubeconfig --region ${this.region} --name ${cluster.clusterName}`,
      description: 'Command to configure kubectl',
    });

    new CfnOutput(this, 'VerifyMetricsServer', {
      value: 'kubectl get deployment metrics-server -n kube-system && kubectl top nodes',
      description: 'Command to verify Metrics Server is running',
    });

    new CfnOutput(this, 'CheckHPA', {
      value: 'kubectl get hpa php-apache-hpa',
      description: 'Command to check HPA status',
    });

    new CfnOutput(this, 'GenerateLoad', {
      value: 'kubectl run -i --tty load-generator --rm --image=busybox --restart=Never -- /bin/sh -c "while sleep 0.01; do wget -q -O- http://php-apache; done"',
      description: 'Command to generate load for HPA testing',
    });

    new CfnOutput(this, 'WatchHPA', {
      value: 'kubectl get hpa php-apache-hpa -w',
      description: 'Command to watch HPA scaling in real-time',
    });

    new CfnOutput(this, 'WatchPods', {
      value: 'kubectl get pods -l app=php-apache -w',
      description: 'Command to watch pod scaling in real-time',
    });
  }
}
