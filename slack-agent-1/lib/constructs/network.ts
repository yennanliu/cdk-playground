import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface AgentNetworkProps {
  /**
   * NAT gateways to provision. Defaults to 0.
   *
   * The agent reaches Slack over an outbound WebSocket (Socket Mode) and never
   * accepts inbound traffic, so a public subnet fronted by a security group with
   * zero ingress rules is no more reachable than a private subnet behind NAT --
   * and saves the ~$32/mo NAT Gateway. Set this to 1 only if policy forbids the
   * host from holding a public IP at all.
   */
  readonly natGateways?: number;
}

/**
 * The VPC the agent host runs in, and the subnet selection that goes with it.
 *
 * Two AZs so the subnets exist for a Phase 1 move to Fargate; the Phase 0 host
 * itself only ever occupies one.
 */
export class AgentNetwork extends Construct {
  readonly vpc: ec2.IVpc;

  /** Private subnets when NAT was requested, public subnets otherwise. */
  readonly hostSubnets: ec2.SubnetSelection;

  constructor(scope: Construct, id: string, props: AgentNetworkProps = {}) {
    super(scope, id);

    const natGateways = props.natGateways ?? 0;
    const egressViaNat = natGateways > 0;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        // PRIVATE_WITH_EGRESS needs somewhere to egress to, so it only exists
        // when a NAT Gateway does.
        ...(egressViaNat
          ? [{ name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 }]
          : []),
      ],
    });

    this.hostSubnets = {
      subnetType: egressViaNat ? ec2.SubnetType.PRIVATE_WITH_EGRESS : ec2.SubnetType.PUBLIC,
    };
  }
}
