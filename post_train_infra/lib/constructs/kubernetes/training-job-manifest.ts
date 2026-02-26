import { Construct } from 'constructs';
import * as eks from 'aws-cdk-lib/aws-eks';

export interface TrainingJobManifestProps {
  cluster: eks.ICluster;
  resourcePrefix: string;
  ecrUri: string;
  dataBucket: string;
  modelsBucket: string;
  checkpointsBucket: string;
  huggingfaceTokenSecretName: string;
}

export class TrainingJobManifestConstruct extends Construct {
  constructor(scope: Construct, id: string, props: TrainingJobManifestProps) {
    super(scope, id);

    // Create ConfigMap for training configuration
    new eks.KubernetesManifest(this, 'TrainingConfigMap', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: {
            name: 'training-config',
            namespace: 'post-train',
            labels: {
              app: 'training',
              'managed-by': 'cdk',
            },
          },
          data: {
            MODEL_NAME: 'Qwen/Qwen2.5-7B',
            NUM_TRAIN_EPOCHS: '3',
            PER_DEVICE_TRAIN_BATCH_SIZE: '4',
            GRADIENT_ACCUMULATION_STEPS: '4',
            LEARNING_RATE: '2e-5',
            WARMUP_STEPS: '100',
            LOGGING_STEPS: '10',
            SAVE_STEPS: '100',
            FP16: 'true',
            MAX_SEQ_LENGTH: '2048',
          },
        },
      ],
      overwrite: true,
    });

    // Note: This manifest creates a template. Actual job submission should be done
    // via kubectl apply with timestamp substitution for unique job names.
    // Example usage:
    //   kubectl create job qwen2-5-7b-sft-$(date +%s) --from=cronjob/training-job-template -n post-train

    // For now, we create a Job template as a ConfigMap that users can apply manually
    new eks.KubernetesManifest(this, 'TrainingJobTemplate', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: {
            name: 'training-job-template',
            namespace: 'post-train',
            labels: {
              app: 'training',
              'managed-by': 'cdk',
            },
          },
          data: {
            'job-template.yaml': `apiVersion: batch/v1
kind: Job
metadata:
  name: qwen2-5-7b-sft-TIMESTAMP
  namespace: post-train
  labels:
    app: training
    workload-type: gpu
spec:
  backoffLimit: 3
  template:
    metadata:
      labels:
        app: training
        workload-type: gpu
    spec:
      restartPolicy: OnFailure
      serviceAccountName: post-train-sa
      tolerations:
        - key: nvidia.com/gpu
          operator: Equal
          value: "true"
          effect: NoSchedule
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: workload-type
                    operator: In
                    values:
                      - gpu
      containers:
        - name: trainer
          image: ${props.ecrUri}:latest
          command: ["/bin/bash", "-c"]
          args:
            - |
              set -e
              echo "Starting training job at \$(date)"
              echo "Model: \${MODEL_NAME}"
              echo "Training data: s3://${props.dataBucket}/processed/"

              python train_sft.py \\
                --model_name_or_path \${MODEL_NAME} \\
                --data_path s3://${props.dataBucket}/processed/train.jsonl \\
                --output_dir s3://${props.modelsBucket}/qwen2.5-7b-sft-\${TIMESTAMP} \\
                --checkpoint_dir s3://${props.checkpointsBucket}/qwen2.5-7b-sft-\${TIMESTAMP} \\
                --num_train_epochs \${NUM_TRAIN_EPOCHS} \\
                --per_device_train_batch_size \${PER_DEVICE_TRAIN_BATCH_SIZE} \\
                --gradient_accumulation_steps \${GRADIENT_ACCUMULATION_STEPS} \\
                --learning_rate \${LEARNING_RATE} \\
                --warmup_steps \${WARMUP_STEPS} \\
                --logging_steps \${LOGGING_STEPS} \\
                --save_steps \${SAVE_STEPS} \\
                --fp16 \\
                --max_seq_length \${MAX_SEQ_LENGTH}

              echo "Training completed at \$(date)"
          env:
            - name: NVIDIA_VISIBLE_DEVICES
              value: "all"
            - name: NVIDIA_DRIVER_CAPABILITIES
              value: "compute,utility"
            - name: HF_TOKEN
              valueFrom:
                secretKeyRef:
                  name: ${props.huggingfaceTokenSecretName}
                  key: token
            - name: TIMESTAMP
              value: "REPLACE_WITH_TIMESTAMP"
          envFrom:
            - configMapRef:
                name: training-config
          resources:
            requests:
              memory: "32Gi"
              cpu: "8"
              nvidia.com/gpu: "1"
            limits:
              memory: "40Gi"
              cpu: "12"
              nvidia.com/gpu: "1"
          volumeMounts:
            - name: shm
              mountPath: /dev/shm
      volumes:
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 8Gi
`,
          },
        },
      ],
      overwrite: true,
    });
  }
}
