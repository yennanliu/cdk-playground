import { Construct } from 'constructs';
import * as eks from 'aws-cdk-lib/aws-eks';

export interface EmbeddingDeploymentProps {
  cluster: eks.ICluster;
  resourcePrefix: string;
  ecrUri: string;
}

export class EmbeddingDeploymentConstruct extends Construct {
  constructor(scope: Construct, id: string, props: EmbeddingDeploymentProps) {
    super(scope, id);

    // Create Embedding Service
    new eks.KubernetesManifest(this, 'EmbeddingService', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: {
            name: 'embedding-service',
            namespace: 'post-train',
            labels: {
              app: 'embedding-service',
              'managed-by': 'cdk',
            },
          },
          spec: {
            type: 'ClusterIP',
            selector: {
              app: 'embedding-service',
            },
            ports: [
              {
                port: 8080,
                targetPort: 8080,
                name: 'http',
              },
            ],
          },
        },
      ],
      overwrite: true,
    });

    // Create Embedding Deployment (CPU-only)
    new eks.KubernetesManifest(this, 'EmbeddingDeployment', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: {
            name: 'embedding-service',
            namespace: 'post-train',
            labels: {
              app: 'embedding-service',
              'managed-by': 'cdk',
            },
          },
          spec: {
            replicas: 2,
            selector: {
              matchLabels: {
                app: 'embedding-service',
              },
            },
            template: {
              metadata: {
                labels: {
                  app: 'embedding-service',
                },
              },
              spec: {
                serviceAccountName: 'rag-sa',
                containers: [
                  {
                    name: 'embedding',
                    image: `${props.ecrUri}:latest`,
                    ports: [
                      {
                        containerPort: 8080,
                        name: 'http',
                      },
                    ],
                    env: [
                      {
                        name: 'MODEL_NAME',
                        value: 'sentence-transformers/all-MiniLM-L6-v2',
                      },
                      {
                        name: 'DEVICE',
                        value: 'cpu',
                      },
                    ],
                    resources: {
                      requests: {
                        memory: '4Gi',
                        cpu: '2',
                      },
                      limits: {
                        memory: '6Gi',
                        cpu: '3',
                      },
                    },
                    readinessProbe: {
                      httpGet: {
                        path: '/health',
                        port: 8080,
                      },
                      initialDelaySeconds: 30,
                      periodSeconds: 10,
                      timeoutSeconds: 5,
                      failureThreshold: 3,
                    },
                    livenessProbe: {
                      httpGet: {
                        path: '/health',
                        port: 8080,
                      },
                      initialDelaySeconds: 60,
                      periodSeconds: 20,
                      timeoutSeconds: 5,
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
