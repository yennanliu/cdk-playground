  Architecture Overview

  Core Components:
  - 3 Redis Master/Slave pairs across different AZs for high
  availability
  - 3 Redis Sentinel instances (minimum for quorum) monitoring the
  masters
  - Demo application (web UI) to visualize failover scenarios
  - Load balancer distributing traffic to healthy Redis instances

  AWS Services:
  - ECS/Fargate - Container orchestration for Redis and Sentinel
  instances
  - ALB - Application load balancer for the demo web interface
  - VPC - Multi-AZ setup with public/private subnets
  - CloudWatch - Monitoring and logging for failover events
  - Parameter Store/Secrets Manager - Redis configuration and passwords

  Demo Features:
  1. Real-time dashboard showing Redis topology and health status
  2. Failover simulation - Kill master instances to trigger automatic
  failover
  3. Performance metrics - Monitor latency, throughput during failover
  4. Configuration viewer - Display current master/slave relationships
  5. Log streaming - Show Sentinel decision-making process

  Key Demo Scenarios:
  - Manual master shutdown → Automatic failover
  - Network partition simulation → Split-brain prevention
  - Scaling scenarios → Adding/removing Redis instances
  - Recovery testing → Failed master rejoining as slave