import { Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { TrainingStorageConstruct } from './constructs/storage/training-storage';
import { MlSecretsConstruct } from './constructs/secrets/ml-secrets';
import { EcrRepositoriesConstruct } from './constructs/container/ecr-repositories';
import { PodExecutionRoleConstruct } from './constructs/iam/pod-execution-role';
import { KubernetesNamespaceConstruct } from './constructs/kubernetes/namespace';
import { WeaviateStorageConstruct } from './constructs/vector-db/weaviate-storage';
import { WeaviateStatefulSetConstruct } from './constructs/kubernetes/weaviate-statefulset-manifest';
import { TrainingJobManifestConstruct } from './constructs/kubernetes/training-job-manifest';
import { VllmDeploymentConstruct } from './constructs/kubernetes/vllm-deployment-manifest';
import { EmbeddingDeploymentConstruct } from './constructs/kubernetes/embedding-deployment-manifest';
import { RagOrchestratorConstruct } from './constructs/kubernetes/rag-orchestrator-manifest';
import { CloudWatchDashboardConstruct } from './constructs/monitoring/cloudwatch-dashboard';

export class PostTrainStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Get environment and region from context
    const env = this.node.tryGetContext('env') || 'dev';
    const region = this.region || 'ap-northeast-1';
    const resourcePrefix = `${env}-post-train`;

    // Import existing VPC (created by Terraform)
    const vpcId = this.node.tryGetContext('vpcId');
    if (!vpcId) {
      throw new Error('vpcId must be provided via context (use -c vpcId=vpc-xxx)');
    }

    const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', {
      vpcId: vpcId,
    });

    // Import existing EKS cluster (created by Terraform)
    const clusterName = this.node.tryGetContext('clusterName') || `${env}-kubernetes-cluster`;
    const kubectlRoleArn = this.node.tryGetContext('kubectlRoleArn');

    if (!kubectlRoleArn) {
      throw new Error('kubectlRoleArn must be provided via context (use -c kubectlRoleArn=arn:aws:iam::xxx)');
    }

    const cluster = eks.Cluster.fromClusterAttributes(this, 'ImportedEksCluster', {
      clusterName: clusterName,
      vpc: vpc,
      kubectlRoleArn: kubectlRoleArn,
    });

    // Create S3 buckets for training data, models, and checkpoints
    const storage = new TrainingStorageConstruct(this, 'TrainingStorage', {
      resourcePrefix,
      removalPolicy: env === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // Create Secrets Manager secrets
    const secrets = new MlSecretsConstruct(this, 'MlSecrets', {
      resourcePrefix,
    });

    // Create ECR repositories
    const ecr = new EcrRepositoriesConstruct(this, 'EcrRepositories', {
      resourcePrefix,
    });

    // Create IAM roles for Kubernetes service accounts (IRSA)
    const iamRoles = new PodExecutionRoleConstruct(this, 'PodExecutionRoles', {
      cluster,
      resourcePrefix,
      dataBucket: storage.dataBucket,
      modelsBucket: storage.modelsBucket,
      checkpointsBucket: storage.checkpointsBucket,
      huggingfaceTokenSecret: secrets.huggingfaceTokenSecret,
      weaviateApiKeySecret: secrets.weaviateApiKeySecret,
    });

    // Create Kubernetes namespace and service accounts
    const namespace = new KubernetesNamespaceConstruct(this, 'Namespace', {
      cluster,
      resourcePrefix,
      trainingRole: iamRoles.trainingRole,
      inferenceRole: iamRoles.inferenceRole,
      weaviateRole: iamRoles.weaviateRole,
      ragRole: iamRoles.ragRole,
    });

    // Create EFS for Weaviate persistence
    const weaviateStorage = new WeaviateStorageConstruct(this, 'WeaviateStorage', {
      vpc,
      cluster,
      resourcePrefix,
      removalPolicy: env === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // Deploy Weaviate StatefulSet
    const weaviate = new WeaviateStatefulSetConstruct(this, 'WeaviateStatefulSet', {
      cluster,
      resourcePrefix,
      efsFileSystemId: weaviateStorage.fileSystemId,
    });
    weaviate.node.addDependency(namespace);
    weaviate.node.addDependency(weaviateStorage);

    // Create training job manifest template
    const trainingJob = new TrainingJobManifestConstruct(this, 'TrainingJob', {
      cluster,
      resourcePrefix,
      ecrUri: ecr.trainingRepositoryUri,
      dataBucket: storage.dataBucket.bucketName,
      modelsBucket: storage.modelsBucket.bucketName,
      checkpointsBucket: storage.checkpointsBucket.bucketName,
      huggingfaceTokenSecretName: secrets.huggingfaceTokenSecret.secretName,
    });
    trainingJob.node.addDependency(namespace);

    // Deploy vLLM inference service
    const vllm = new VllmDeploymentConstruct(this, 'VllmDeployment', {
      cluster,
      resourcePrefix,
      modelsBucket: storage.modelsBucket.bucketName,
    });
    vllm.node.addDependency(namespace);

    // Deploy embedding service
    const embedding = new EmbeddingDeploymentConstruct(this, 'EmbeddingDeployment', {
      cluster,
      resourcePrefix,
      ecrUri: ecr.embeddingRepositoryUri,
    });
    embedding.node.addDependency(namespace);

    // Deploy RAG orchestrator with ALB ingress
    const ragOrchestrator = new RagOrchestratorConstruct(this, 'RagOrchestrator', {
      cluster,
      resourcePrefix,
      ecrUri: ecr.ragOrchestratorRepositoryUri,
      certificateArn: this.node.tryGetContext('certificateArn'), // Optional ACM cert
    });
    ragOrchestrator.node.addDependency(namespace);
    ragOrchestrator.node.addDependency(weaviate);
    ragOrchestrator.node.addDependency(vllm);
    ragOrchestrator.node.addDependency(embedding);

    // Create CloudWatch dashboard and alarms
    const monitoring = new CloudWatchDashboardConstruct(this, 'Monitoring', {
      resourcePrefix,
      clusterName,
    });

    // Outputs
    new CfnOutput(this, 'DataBucketName', {
      value: storage.dataBucket.bucketName,
      description: 'S3 bucket for training data',
      exportName: `${resourcePrefix}-data-bucket`,
    });

    new CfnOutput(this, 'ModelsBucketName', {
      value: storage.modelsBucket.bucketName,
      description: 'S3 bucket for model artifacts',
      exportName: `${resourcePrefix}-models-bucket`,
    });

    new CfnOutput(this, 'CheckpointsBucketName', {
      value: storage.checkpointsBucket.bucketName,
      description: 'S3 bucket for training checkpoints',
      exportName: `${resourcePrefix}-checkpoints-bucket`,
    });

    new CfnOutput(this, 'TrainingRepositoryUri', {
      value: ecr.trainingRepositoryUri,
      description: 'ECR repository URI for training image',
      exportName: `${resourcePrefix}-training-repo-uri`,
    });

    new CfnOutput(this, 'VllmRepositoryUri', {
      value: ecr.vllmRepositoryUri,
      description: 'ECR repository URI for vLLM image',
      exportName: `${resourcePrefix}-vllm-repo-uri`,
    });

    new CfnOutput(this, 'EmbeddingRepositoryUri', {
      value: ecr.embeddingRepositoryUri,
      description: 'ECR repository URI for embedding service image',
      exportName: `${resourcePrefix}-embedding-repo-uri`,
    });

    new CfnOutput(this, 'RagOrchestratorRepositoryUri', {
      value: ecr.ragOrchestratorRepositoryUri,
      description: 'ECR repository URI for RAG orchestrator image',
      exportName: `${resourcePrefix}-rag-orchestrator-repo-uri`,
    });

    new CfnOutput(this, 'HuggingFaceTokenSecretArn', {
      value: secrets.huggingfaceTokenSecret.secretArn,
      description: 'Secrets Manager ARN for HuggingFace token',
      exportName: `${resourcePrefix}-hf-token-secret-arn`,
    });

    new CfnOutput(this, 'EfsFileSystemId', {
      value: weaviateStorage.fileSystemId,
      description: 'EFS file system ID for Weaviate',
      exportName: `${resourcePrefix}-efs-id`,
    });

    new CfnOutput(this, 'DashboardUrl', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${region}#dashboards:name=${monitoring.dashboardName}`,
      description: 'CloudWatch dashboard URL',
    });
  }
}
