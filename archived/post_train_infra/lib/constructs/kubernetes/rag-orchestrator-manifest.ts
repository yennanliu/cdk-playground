import { Construct } from 'constructs';
import * as eks from 'aws-cdk-lib/aws-eks';

export interface RagOrchestratorProps {
  cluster: eks.ICluster;
  resourcePrefix: string;
  ecrUri: string;
  certificateArn?: string; // Optional ACM certificate for HTTPS
}

export class RagOrchestratorConstruct extends Construct {
  constructor(scope: Construct, id: string, props: RagOrchestratorProps) {
    super(scope, id);

    // Create RAG Orchestrator Service
    new eks.KubernetesManifest(this, 'RagOrchestratorService', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: {
            name: 'rag-orchestrator',
            namespace: 'post-train',
            labels: {
              app: 'rag-orchestrator',
              'managed-by': 'cdk',
            },
          },
          spec: {
            type: 'ClusterIP',
            selector: {
              app: 'rag-orchestrator',
            },
            ports: [
              {
                port: 80,
                targetPort: 8000,
                name: 'http',
              },
            ],
          },
        },
      ],
      overwrite: true,
    });

    // Create RAG Orchestrator Deployment (CPU-only)
    new eks.KubernetesManifest(this, 'RagOrchestratorDeployment', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: {
            name: 'rag-orchestrator',
            namespace: 'post-train',
            labels: {
              app: 'rag-orchestrator',
              'managed-by': 'cdk',
            },
          },
          spec: {
            replicas: 3,
            selector: {
              matchLabels: {
                app: 'rag-orchestrator',
              },
            },
            template: {
              metadata: {
                labels: {
                  app: 'rag-orchestrator',
                },
              },
              spec: {
                serviceAccountName: 'rag-sa',
                containers: [
                  {
                    name: 'orchestrator',
                    image: `${props.ecrUri}:latest`,
                    ports: [
                      {
                        containerPort: 8000,
                        name: 'http',
                      },
                    ],
                    env: [
                      {
                        name: 'WEAVIATE_URL',
                        value: 'http://weaviate-client.post-train.svc.cluster.local:8080',
                      },
                      {
                        name: 'VLLM_URL',
                        value: 'http://vllm.post-train.svc.cluster.local:8000',
                      },
                      {
                        name: 'EMBEDDING_SERVICE_URL',
                        value: 'http://embedding-service.post-train.svc.cluster.local:8080',
                      },
                    ],
                    resources: {
                      requests: {
                        memory: '2Gi',
                        cpu: '1',
                      },
                      limits: {
                        memory: '4Gi',
                        cpu: '2',
                      },
                    },
                    readinessProbe: {
                      httpGet: {
                        path: '/health',
                        port: 8000,
                      },
                      initialDelaySeconds: 15,
                      periodSeconds: 10,
                      timeoutSeconds: 5,
                      failureThreshold: 3,
                    },
                    livenessProbe: {
                      httpGet: {
                        path: '/health',
                        port: 8000,
                      },
                      initialDelaySeconds: 30,
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

    // Create ALB Ingress for RAG API (only if certificate is provided)
    if (props.certificateArn) {
      new eks.KubernetesManifest(this, 'RagIngress', {
        cluster: props.cluster,
        manifest: [
          {
            apiVersion: 'networking.k8s.io/v1',
            kind: 'Ingress',
            metadata: {
              name: 'rag-ingress',
              namespace: 'post-train',
              labels: {
                app: 'rag-orchestrator',
                'managed-by': 'cdk',
              },
              annotations: {
                'alb.ingress.kubernetes.io/scheme': 'internet-facing',
                'alb.ingress.kubernetes.io/target-type': 'ip',
                'alb.ingress.kubernetes.io/certificate-arn': props.certificateArn,
                'alb.ingress.kubernetes.io/ssl-policy': 'ELBSecurityPolicy-TLS13-1-2-2021-06',
                'alb.ingress.kubernetes.io/listen-ports': '[{"HTTPS": 443}]',
                'alb.ingress.kubernetes.io/healthcheck-path': '/health',
                'alb.ingress.kubernetes.io/healthcheck-interval-seconds': '30',
                'alb.ingress.kubernetes.io/healthcheck-timeout-seconds': '10',
                'alb.ingress.kubernetes.io/healthy-threshold-count': '2',
                'alb.ingress.kubernetes.io/unhealthy-threshold-count': '3',
                'alb.ingress.kubernetes.io/success-codes': '200',
                'alb.ingress.kubernetes.io/target-group-attributes':
                  'deregistration_delay.timeout_seconds=30',
                'alb.ingress.kubernetes.io/load-balancer-attributes':
                  'idle_timeout.timeout_seconds=300', // 5 minutes for RAG queries
              },
            },
            spec: {
              ingressClassName: 'alb',
              rules: [
                {
                  http: {
                    paths: [
                      {
                        path: '/',
                        pathType: 'Prefix',
                        backend: {
                          service: {
                            name: 'rag-orchestrator',
                            port: {
                              number: 80,
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
        overwrite: true,
      });
    } else {
      // Create HTTP-only ingress (for dev environments without certificate)
      new eks.KubernetesManifest(this, 'RagIngressHttp', {
        cluster: props.cluster,
        manifest: [
          {
            apiVersion: 'networking.k8s.io/v1',
            kind: 'Ingress',
            metadata: {
              name: 'rag-ingress',
              namespace: 'post-train',
              labels: {
                app: 'rag-orchestrator',
                'managed-by': 'cdk',
              },
              annotations: {
                'alb.ingress.kubernetes.io/scheme': 'internet-facing',
                'alb.ingress.kubernetes.io/target-type': 'ip',
                'alb.ingress.kubernetes.io/healthcheck-path': '/health',
                'alb.ingress.kubernetes.io/healthcheck-interval-seconds': '30',
                'alb.ingress.kubernetes.io/healthcheck-timeout-seconds': '10',
                'alb.ingress.kubernetes.io/healthy-threshold-count': '2',
                'alb.ingress.kubernetes.io/unhealthy-threshold-count': '3',
                'alb.ingress.kubernetes.io/success-codes': '200',
              },
            },
            spec: {
              ingressClassName: 'alb',
              rules: [
                {
                  http: {
                    paths: [
                      {
                        path: '/',
                        pathType: 'Prefix',
                        backend: {
                          service: {
                            name: 'rag-orchestrator',
                            port: {
                              number: 80,
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
        overwrite: true,
      });
    }
  }
}
