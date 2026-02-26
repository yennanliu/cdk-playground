import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { RemovalPolicy, Duration } from 'aws-cdk-lib';

export interface EcrRepositoriesProps {
  resourcePrefix: string;
}

export class EcrRepositoriesConstruct extends Construct {
  public readonly trainingRepository: ecr.Repository;
  public readonly vllmRepository: ecr.Repository;
  public readonly embeddingRepository: ecr.Repository;
  public readonly ragOrchestratorRepository: ecr.Repository;

  public readonly trainingRepositoryUri: string;
  public readonly vllmRepositoryUri: string;
  public readonly embeddingRepositoryUri: string;
  public readonly ragOrchestratorRepositoryUri: string;

  constructor(scope: Construct, id: string, props: EcrRepositoriesProps) {
    super(scope, id);

    // Shared lifecycle policy to keep last 10 images
    const lifecycleRules: ecr.LifecycleRule[] = [
      {
        description: 'Keep last 10 images',
        maxImageCount: 10,
        rulePriority: 1,
      },
    ];

    // ECR repository for training container (PyTorch, Transformers, DeepSpeed)
    this.trainingRepository = new ecr.Repository(this, 'TrainingRepository', {
      repositoryName: `${props.resourcePrefix}/training`,
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules,
    });

    // ECR repository for vLLM inference server
    // Note: We may use the official vLLM image, but this repo is for custom builds if needed
    this.vllmRepository = new ecr.Repository(this, 'VllmRepository', {
      repositoryName: `${props.resourcePrefix}/vllm`,
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules,
    });

    // ECR repository for embedding service (sentence-transformers)
    this.embeddingRepository = new ecr.Repository(this, 'EmbeddingRepository', {
      repositoryName: `${props.resourcePrefix}/embedding`,
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules,
    });

    // ECR repository for RAG orchestrator service
    this.ragOrchestratorRepository = new ecr.Repository(this, 'RagOrchestratorRepository', {
      repositoryName: `${props.resourcePrefix}/rag-orchestrator`,
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules,
    });

    // Export repository URIs for easy reference
    this.trainingRepositoryUri = this.trainingRepository.repositoryUri;
    this.vllmRepositoryUri = this.vllmRepository.repositoryUri;
    this.embeddingRepositoryUri = this.embeddingRepository.repositoryUri;
    this.ragOrchestratorRepositoryUri = this.ragOrchestratorRepository.repositoryUri;
  }
}
