import { Construct } from 'constructs';
import * as eks from 'aws-cdk-lib/aws-eks';

export interface WeaviateStatefulSetProps {
  cluster: eks.ICluster;
  resourcePrefix: string;
  efsFileSystemId: string;
}

export class WeaviateStatefulSetConstruct extends Construct {
  constructor(scope: Construct, id: string, props: WeaviateStatefulSetProps) {
    super(scope, id);

    // Create Weaviate Headless Service for StatefulSet
    new eks.KubernetesManifest(this, 'WeaviateService', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: {
            name: 'weaviate',
            namespace: 'post-train',
            labels: {
              app: 'weaviate',
              'managed-by': 'cdk',
            },
          },
          spec: {
            type: 'ClusterIP',
            clusterIP: 'None', // Headless service for StatefulSet
            selector: {
              app: 'weaviate',
            },
            ports: [
              {
                port: 8080,
                targetPort: 8080,
                name: 'http',
              },
              {
                port: 7100,
                name: 'gossip',
              },
              {
                port: 7101,
                name: 'data',
              },
            ],
          },
        },
      ],
      overwrite: true,
    });

    // Create Weaviate Client Service (non-headless for external access)
    new eks.KubernetesManifest(this, 'WeaviateClientService', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: {
            name: 'weaviate-client',
            namespace: 'post-train',
            labels: {
              app: 'weaviate',
              'managed-by': 'cdk',
            },
          },
          spec: {
            type: 'ClusterIP',
            selector: {
              app: 'weaviate',
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

    // Create Weaviate StatefulSet with HA configuration
    new eks.KubernetesManifest(this, 'WeaviateStatefulSet', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'apps/v1',
          kind: 'StatefulSet',
          metadata: {
            name: 'weaviate',
            namespace: 'post-train',
            labels: {
              app: 'weaviate',
              'managed-by': 'cdk',
            },
          },
          spec: {
            serviceName: 'weaviate',
            replicas: 3,
            selector: {
              matchLabels: {
                app: 'weaviate',
              },
            },
            template: {
              metadata: {
                labels: {
                  app: 'weaviate',
                },
              },
              spec: {
                serviceAccountName: 'weaviate-sa',
                containers: [
                  {
                    name: 'weaviate',
                    image: 'semitechnologies/weaviate:1.24.1',
                    ports: [
                      {
                        containerPort: 8080,
                        name: 'http',
                      },
                      {
                        containerPort: 7100,
                        name: 'gossip',
                      },
                      {
                        containerPort: 7101,
                        name: 'data',
                      },
                    ],
                    env: [
                      {
                        name: 'QUERY_DEFAULTS_LIMIT',
                        value: '25',
                      },
                      {
                        name: 'AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED',
                        value: 'true',
                      },
                      {
                        name: 'PERSISTENCE_DATA_PATH',
                        value: '/var/lib/weaviate',
                      },
                      {
                        name: 'DEFAULT_VECTORIZER_MODULE',
                        value: 'none',
                      },
                      {
                        name: 'ENABLE_MODULES',
                        value: '',
                      },
                      {
                        name: 'CLUSTER_HOSTNAME',
                        valueFrom: {
                          fieldRef: {
                            apiVersion: 'v1',
                            fieldPath: 'metadata.name',
                          },
                        },
                      },
                      {
                        name: 'CLUSTER_GOSSIP_BIND_PORT',
                        value: '7100',
                      },
                      {
                        name: 'CLUSTER_DATA_BIND_PORT',
                        value: '7101',
                      },
                      {
                        name: 'CLUSTER_JOIN',
                        value: 'weaviate-0.weaviate.post-train.svc.cluster.local:7100,weaviate-1.weaviate.post-train.svc.cluster.local:7100,weaviate-2.weaviate.post-train.svc.cluster.local:7100',
                      },
                    ],
                    resources: {
                      requests: {
                        memory: '8Gi',
                        cpu: '2',
                      },
                      limits: {
                        memory: '12Gi',
                        cpu: '4',
                      },
                    },
                    volumeMounts: [
                      {
                        name: 'weaviate-data',
                        mountPath: '/var/lib/weaviate',
                      },
                    ],
                    readinessProbe: {
                      httpGet: {
                        path: '/v1/.well-known/ready',
                        port: 8080,
                      },
                      initialDelaySeconds: 30,
                      periodSeconds: 10,
                      timeoutSeconds: 5,
                      failureThreshold: 3,
                    },
                    livenessProbe: {
                      httpGet: {
                        path: '/v1/.well-known/live',
                        port: 8080,
                      },
                      initialDelaySeconds: 60,
                      periodSeconds: 20,
                      timeoutSeconds: 5,
                      failureThreshold: 5,
                    },
                  },
                ],
                volumes: [
                  {
                    name: 'weaviate-data',
                    persistentVolumeClaim: {
                      claimName: 'weaviate-data-pvc',
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
