import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class MyCdkS3Bucket2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a new S3 bucket
    for (let i = 1; i <= 3; i++) {
      console.log(`>>> Build S3 bucket :  ${i}`);
      new s3.Bucket(this, `my-second-bucket-${i}`, {
        bucketName: `my-second-cdk-bucket-${i}`, // Unique name for the bucket
        versioned: true, // Enable versioning for the bucket
        removalPolicy: cdk.RemovalPolicy.DESTROY, // Automatically delete the bucket when the stack is deleted
        autoDeleteObjects: true, // Automatically delete objects when the bucket is deleted
      });
    }

    // create vpc
    // const vpc = new ec2.Vpc(this, "MyVpc", {
    //   maxAzs: 2, // Default is all AZs in the region
    //   natGateways: 1});
    const vpc = new ec2.Vpc(this, "MyVpc", {
      maxAzs: 2, // Default is all AZs in the region
    });

    // creare security group
    const securityGroup = new ec2.SecurityGroup(this, "MySecurityGroup", {
      vpc,
      allowAllOutbound: true, // Allow all outbound traffic
    });
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(), // Allow all inbound traffic from any IPv4 address
      ec2.Port.tcp(22), // Allow ssh access
      "Allow HTTP traffic"
    );

    // add ec2
    const instance = new ec2.Instance(this, "MyInstance", {
      vpc,
      instanceType: new ec2.InstanceType("t2.micro"),
      machineImage: new ec2.AmazonLinuxImage(), // Use the latest Amazon Linux AMI
      securityGroup: securityGroup,
    });
    // instance.userData.addCommands(
    //   "yum update -y",
    //   "yum install -y httpd",);


  }


}
