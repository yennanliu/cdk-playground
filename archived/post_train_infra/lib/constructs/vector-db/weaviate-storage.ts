import { Construct } from 'constructs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface WeaviateStorageProps {
  vpc: ec2.IVpc;
  cluster: eks.ICluster;
  resourcePrefix: string;
  removalPolicy?: RemovalPolicy;
}

export class WeaviateStorageConstruct extends Construct {
  public readonly fileSystem: efs.FileSystem;
  public readonly fileSystemId: string;
  public readonly accessPoint: efs.AccessPoint;

  constructor(scope: Construct, id: string, props: WeaviateStorageProps) {
    super(scope, id);

    const removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    // Create EFS file system for Weaviate persistence
    this.fileSystem = new efs.FileSystem(this, 'WeaviateEFS', {
      vpc: props.vpc,
      encrypted: true,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      removalPolicy: removalPolicy,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroup: new ec2.SecurityGroup(this, 'EfsSecurityGroup', {
        vpc: props.vpc,
        description: 'Security group for Weaviate EFS',
        allowAllOutbound: true,
      }),
    });

    // Allow NFS traffic from EKS cluster security group
    this.fileSystem.connections.allowDefaultPortFrom(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      'Allow NFS from VPC'
    );

    // Create access point for Weaviate
    this.accessPoint = this.fileSystem.addAccessPoint('WeaviateAccessPoint', {
      path: '/weaviate',
      posixUser: {
        uid: '1000',
        gid: '1000',
      },
      createAcl: {
        ownerUid: '1000',
        ownerGid: '1000',
        permissions: '755',
      },
    });

    this.fileSystemId = this.fileSystem.fileSystemId;

    // Create EFS StorageClass for Kubernetes
    new eks.KubernetesManifest(this, 'EFSStorageClass', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'storage.k8s.io/v1',
          kind: 'StorageClass',
          metadata: {
            name: 'efs-sc',
          },
          provisioner: 'efs.csi.aws.com',
          parameters: {
            provisioningMode: 'efs-ap',
            fileSystemId: this.fileSystem.fileSystemId,
            directoryPerms: '755',
          },
          mountOptions: [
            'tls',
          ],
        },
      ],
      overwrite: true,
    });

    // Create PersistentVolume for Weaviate
    new eks.KubernetesManifest(this, 'WeaviatePV', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'PersistentVolume',
          metadata: {
            name: 'weaviate-efs-pv',
          },
          spec: {
            capacity: {
              storage: '100Gi',
            },
            volumeMode: 'Filesystem',
            accessModes: ['ReadWriteMany'],
            persistentVolumeReclaimPolicy: removalPolicy === RemovalPolicy.RETAIN ? 'Retain' : 'Delete',
            storageClassName: 'efs-sc',
            csi: {
              driver: 'efs.csi.aws.com',
              volumeHandle: `${this.fileSystem.fileSystemId}::${this.accessPoint.accessPointId}`,
            },
          },
        },
      ],
      overwrite: true,
    });

    // Create PersistentVolumeClaim for Weaviate
    new eks.KubernetesManifest(this, 'WeaviatePVC', {
      cluster: props.cluster,
      manifest: [
        {
          apiVersion: 'v1',
          kind: 'PersistentVolumeClaim',
          metadata: {
            name: 'weaviate-data-pvc',
            namespace: 'post-train',
          },
          spec: {
            accessModes: ['ReadWriteMany'],
            storageClassName: 'efs-sc',
            resources: {
              requests: {
                storage: '100Gi',
              },
            },
            volumeName: 'weaviate-efs-pv',
          },
        },
      ],
      overwrite: true,
    });
  }
}
