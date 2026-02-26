import { Construct } from 'constructs';
import * as eks from 'aws-cdk-lib/aws-eks';

export interface VllmDeploymentProps {
  cluster: eks.ICluster;
  resourcePrefix: string;
  modelsBucket: string;
}

export class VllmDeploymentConstruct extends Construct {
  constructor(scope: Construct, id: string, props: VllmDeploymentProps) {
    super(scope, id);

    // Create vLLM Service
    new eks.KubernetesManifest(this, 'VllmService', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: {
            name: 'vllm',
            namespace: 'post-train',
            labels: {
              app: 'vllm',
              'managed-by': 'cdk',
            },
          },
          spec: {
            type: 'ClusterIP',
            selector: {
              app: 'vllm',
            },
            ports: [
              {
                port: 8000,
                targetPort: 8000,
                name: 'http',
              },
            ],
          },
        },
      ],
      overwrite: true,
    });

    // Create vLLM Deployment
    new eks.KubernetesManifest(this, 'VllmDeployment', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: {
            name: 'vllm',
            namespace: 'post-train',
            labels: {
              app: 'vllm',
              'managed-by': 'cdk',
            },
          },
          spec: {
            replicas: 1,
            selector: {
              matchLabels: {
                app: 'vllm',
              },
            },
            template: {
              metadata: {
                labels: {
                  app: 'vllm',
                  'workload-type': 'gpu',
                },
              },
              spec: {
                serviceAccountName: 'vllm-sa',
                tolerations: [
                  {
                    key: 'nvidia.com/gpu',
                    operator: 'Equal',
                    value: 'true',
                    effect: 'NoSchedule',
                  },
                ],
                affinity: {
                  nodeAffinity: {
                    requiredDuringSchedulingIgnoredDuringExecution: {
                      nodeSelectorTerms: [
                        {
                          matchExpressions: [
                            {
                              key: 'workload-type',
                              operator: 'In',
                              values: ['gpu'],
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
                containers: [
                  {
                    name: 'vllm',
                    image: 'vllm/vllm-openai:latest',
                    ports: [
                      {
                        containerPort: 8000,
                        name: 'http',
                      },
                    ],
                    command: ['python', '-m', 'vllm.entrypoints.openai.api_server'],
                    args: [
                      '--model',
                      `s3://${props.modelsBucket}/qwen2.5-7b-sft-latest/`,
                      '--dtype',
                      'float16',
                      '--max-model-len',
                      '4096',
                      '--gpu-memory-utilization',
                      '0.9',
                      '--port',
                      '8000',
                    ],
                    env: [
                      {
                        name: 'NVIDIA_VISIBLE_DEVICES',
                        value: 'all',
                      },
                      {
                        name: 'NVIDIA_DRIVER_CAPABILITIES',
                        value: 'compute,utility',
                      },
                      {
                        name: 'AWS_REGION',
                        value: 'ap-northeast-1',
                      },
                    ],
                    resources: {
                      requests: {
                        memory: '12Gi',
                        cpu: '4',
                        'nvidia.com/gpu': '1',
                      },
                      limits: {
                        memory: '16Gi',
                        cpu: '6',
                        'nvidia.com/gpu': '1',
                      },
                    },
                    readinessProbe: {
                      httpGet: {
                        path: '/health',
                        port: 8000,
                      },
                      initialDelaySeconds: 120,
                      periodSeconds: 10,
                      timeoutSeconds: 5,
                      failureThreshold: 3,
                    },
                    livenessProbe: {
                      httpGet: {
                        path: '/health',
                        port: 8000,
                      },
                      initialDelaySeconds: 180,
                      periodSeconds: 30,
                      timeoutSeconds: 10,
                      failureThreshold: 3,
                    },
                  },
                ],
              },
            },
          },
        },
      ],
      overwrite: true,
    });
  }
}
