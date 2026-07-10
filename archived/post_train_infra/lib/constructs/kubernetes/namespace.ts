import { Construct } from 'constructs';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface KubernetesNamespaceProps {
  cluster: eks.ICluster;
  resourcePrefix: string;
  trainingRole: iam.IRole;
  inferenceRole: iam.IRole;
  weaviateRole: iam.IRole;
  ragRole: iam.IRole;
}

export class KubernetesNamespaceConstruct extends Construct {
  public readonly namespace: string = 'post-train';

  constructor(scope: Construct, id: string, props: KubernetesNamespaceProps) {
    super(scope, id);

    // Create the namespace
    new eks.KubernetesManifest(this, 'Namespace', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: {
            name: this.namespace,
            labels: {
              name: this.namespace,
              environment: props.resourcePrefix.split('-')[0], // Extract env from prefix
              'managed-by': 'cdk',
            },
          },
        },
      ],
      overwrite: true,
    });

    // Create service account for training workloads
    new eks.KubernetesManifest(this, 'TrainingServiceAccount', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'ServiceAccount',
          metadata: {
            name: 'post-train-sa',
            namespace: this.namespace,
            annotations: {
              'eks.amazonaws.com/role-arn': props.trainingRole.roleArn,
            },
            labels: {
              app: 'training',
              'managed-by': 'cdk',
            },
          },
        },
      ],
      overwrite: true,
    });

    // Create service account for vLLM inference
    new eks.KubernetesManifest(this, 'InferenceServiceAccount', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'ServiceAccount',
          metadata: {
            name: 'vllm-sa',
            namespace: this.namespace,
            annotations: {
              'eks.amazonaws.com/role-arn': props.inferenceRole.roleArn,
            },
            labels: {
              app: 'vllm',
              'managed-by': 'cdk',
            },
          },
        },
      ],
      overwrite: true,
    });

    // Create service account for Weaviate
    new eks.KubernetesManifest(this, 'WeaviateServiceAccount', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'ServiceAccount',
          metadata: {
            name: 'weaviate-sa',
            namespace: this.namespace,
            annotations: {
              'eks.amazonaws.com/role-arn': props.weaviateRole.roleArn,
            },
            labels: {
              app: 'weaviate',
              'managed-by': 'cdk',
            },
          },
        },
      ],
      overwrite: true,
    });

    // Create service account for RAG orchestrator and embedding service
    new eks.KubernetesManifest(this, 'RagServiceAccount', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'ServiceAccount',
          metadata: {
            name: 'rag-sa',
            namespace: this.namespace,
            annotations: {
              'eks.amazonaws.com/role-arn': props.ragRole.roleArn,
            },
            labels: {
              app: 'rag',
              'managed-by': 'cdk',
            },
          },
        },
      ],
      overwrite: true,
    });
  }
}
