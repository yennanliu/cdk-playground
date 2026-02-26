import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';

export interface PodExecutionRoleProps {
  cluster: eks.ICluster;
  resourcePrefix: string;
  dataBucket: s3.IBucket;
  modelsBucket: s3.IBucket;
  checkpointsBucket: s3.IBucket;
  huggingfaceTokenSecret: secretsmanager.ISecret;
  weaviateApiKeySecret: secretsmanager.ISecret;
}

export class PodExecutionRoleConstruct extends Construct {
  public readonly trainingRole: iam.Role;
  public readonly inferenceRole: iam.Role;
  public readonly weaviateRole: iam.Role;
  public readonly ragRole: iam.Role;

  constructor(scope: Construct, id: string, props: PodExecutionRoleProps) {
    super(scope, id);

    // Validate that the cluster has an OIDC provider
    if (!props.cluster.openIdConnectProvider) {
      throw new Error('EKS cluster must have an OIDC provider for IRSA. Ensure the cluster was created with OIDC enabled.');
    }

    // Training Service Account Role
    // Needs: S3 read/write, Secrets Manager read, CloudWatch Logs write, ECR pull
    this.trainingRole = new iam.Role(this, 'TrainingRole', {
      roleName: `${props.resourcePrefix}-training-role`,
      description: 'IRSA role for post-training workloads',
      assumedBy: new iam.FederatedPrincipal(
        props.cluster.openIdConnectProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            [`${props.cluster.openIdConnectProvider.openIdConnectProviderIssuer}:sub`]:
              'system:serviceaccount:post-train:post-train-sa',
            [`${props.cluster.openIdConnectProvider.openIdConnectProviderIssuer}:aud`]:
              'sts.amazonaws.com',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    // Grant S3 read/write access to training buckets
    props.dataBucket.grantReadWrite(this.trainingRole);
    props.modelsBucket.grantReadWrite(this.trainingRole);
    props.checkpointsBucket.grantReadWrite(this.trainingRole);

    // Grant Secrets Manager read access
    props.huggingfaceTokenSecret.grantRead(this.trainingRole);

    // Grant CloudWatch Logs write access
    this.trainingRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:DescribeLogStreams',
      ],
      resources: ['*'], // CloudWatch Logs requires wildcards for log group creation
    }));

    // Grant ECR pull access
    this.trainingRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
      ],
      resources: ['*'], // ECR GetAuthorizationToken requires wildcard
    }));

    // Inference Service Account Role (vLLM)
    // Needs: S3 read (models), CloudWatch Logs write, ECR pull
    this.inferenceRole = new iam.Role(this, 'InferenceRole', {
      roleName: `${props.resourcePrefix}-inference-role`,
      description: 'IRSA role for vLLM inference workloads',
      assumedBy: new iam.FederatedPrincipal(
        props.cluster.openIdConnectProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            [`${props.cluster.openIdConnectProvider.openIdConnectProviderIssuer}:sub`]:
              'system:serviceaccount:post-train:vllm-sa',
            [`${props.cluster.openIdConnectProvider.openIdConnectProviderIssuer}:aud`]:
              'sts.amazonaws.com',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    // Grant S3 read access to models bucket
    props.modelsBucket.grantRead(this.inferenceRole);

    // Grant CloudWatch Logs write access
    this.inferenceRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:DescribeLogStreams',
      ],
      resources: ['*'],
    }));

    // Grant ECR pull access
    this.inferenceRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
      ],
      resources: ['*'],
    }));

    // Weaviate Service Account Role
    // Needs: CloudWatch Logs write, ECR pull
    this.weaviateRole = new iam.Role(this, 'WeaviateRole', {
      roleName: `${props.resourcePrefix}-weaviate-role`,
      description: 'IRSA role for Weaviate vector database',
      assumedBy: new iam.FederatedPrincipal(
        props.cluster.openIdConnectProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            [`${props.cluster.openIdConnectProvider.openIdConnectProviderIssuer}:sub`]:
              'system:serviceaccount:post-train:weaviate-sa',
            [`${props.cluster.openIdConnectProvider.openIdConnectProviderIssuer}:aud`]:
              'sts.amazonaws.com',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    // Grant CloudWatch Logs write access
    this.weaviateRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:DescribeLogStreams',
      ],
      resources: ['*'],
    }));

    // Grant ECR pull access
    this.weaviateRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
      ],
      resources: ['*'],
    }));

    // RAG Service Account Role
    // Needs: CloudWatch Logs write, Secrets Manager read (API keys), ECR pull
    this.ragRole = new iam.Role(this, 'RagRole', {
      roleName: `${props.resourcePrefix}-rag-role`,
      description: 'IRSA role for RAG orchestrator and embedding services',
      assumedBy: new iam.FederatedPrincipal(
        props.cluster.openIdConnectProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            [`${props.cluster.openIdConnectProvider.openIdConnectProviderIssuer}:sub`]:
              'system:serviceaccount:post-train:rag-sa',
            [`${props.cluster.openIdConnectProvider.openIdConnectProviderIssuer}:aud`]:
              'sts.amazonaws.com',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    // Grant Secrets Manager read access
    props.weaviateApiKeySecret.grantRead(this.ragRole);

    // Grant CloudWatch Logs write access
    this.ragRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:DescribeLogStreams',
      ],
      resources: ['*'],
    }));

    // Grant ECR pull access
    this.ragRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
      ],
      resources: ['*'],
    }));

    // Additional role for embedding service (can share with RAG role)
    // The embedding service also runs under rag-sa service account
  }
}
