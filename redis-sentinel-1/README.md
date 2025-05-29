# Welcome to your CDK TypeScript project


Here’s a high-level system design for deploying Redis in Sentinel mode using AWS CDK. Redis Sentinel provides high availability for Redis — it monitors Redis masters and slaves, and performs automatic failover when the master node fails.

⸻

🧱 High-Level Architecture for Redis Sentinel on AWS via CDK

📦 Components:
	1.	VPC
	•	Custom VPC with private and public subnets.
	•	Subnet groups for Redis cluster nodes and Sentinel nodes.
	2.	EC2 Instances (Redis Nodes)
	•	At least 3 EC2 instances: 1 master, 2 replicas.
	•	Running Redis in cluster/sentinel-aware configuration.
	•	Security groups for inter-node communication.
	3.	EC2 Instances (Sentinel Nodes)
	•	3 additional EC2 instances running only Redis Sentinel.
	•	Monitors the Redis master and triggers failover if necessary.
	4.	Security Groups
	•	Allow TCP ports:
	•	6379 (Redis)
	•	26379 (Sentinel)
	•	Intra-node communication only (within a Redis security group)
	5.	Auto Scaling Group (Optional)
	•	For replicas/sentinel for resilience.
	•	Attach health checks.
	6.	Elastic IP (Optional)
	•	Or use AWS internal DNS with EC2 instance discovery for Sentinel nodes.
	7.	UserData / Scripts
	•	Provision EC2 nodes with:
	•	Redis install
	•	Sentinel config generation
	•	Proper replication setup (slaveof, sentinel monitor, etc.)

⸻

🧰 Tools and AWS Services Used

AWS Service	Purpose
EC2	Hosts Redis + Sentinel services
CDK (EC2, VPC, IAM, SG)	Infrastructure as code
IAM Roles	Permissions for EC2 to read configs from S3 if needed
VPC/Subnets	Isolation between Redis and Sentinel nodes
S3 (optional)	For shared config files/scripts
CloudWatch Logs	Log Redis and Sentinel output for monitoring


⸻

📐 Architecture Diagram (Conceptual)

                        ┌─────────────────────────────┐
                        │         AWS VPC             │
                        │                             │
                        │ ┌────────────┐              │
                        │ │  Redis EC2 │ ← Master     │
                        │ └────────────┘              │
                        │     ▲       ▲               │
                        │     │       │               │
                        │ ┌────────────┐              │
                        │ │  Redis EC2 │ ← Replica    │
                        │ └────────────┘              │
                        │ ┌────────────┐              │
                        │ │  Redis EC2 │ ← Replica    │
                        │ └────────────┘              │
                        │                             │
                        │ ┌────────────┐              │
                        │ │ Sentinel   │ ← Watches    │
                        │ └────────────┘              │
                        │ ┌────────────┐              │
                        │ │ Sentinel   │ ← Watches    │
                        │ └────────────┘              │
                        │ ┌────────────┐              │
                        │ │ Sentinel   │ ← Watches    │
                        │ └────────────┘              │
                        └─────────────────────────────┘


⸻

✅ Benefits
	•	High Availability: Redis Sentinel ensures automatic failover if the master goes down.
	•	Infrastructure-as-Code: CDK maintains reproducibility and version control.
	•	Customizability: You can easily increase the number of replicas/sentinels.
	•	Network Isolation: Redis and Sentinel nodes can be restricted with fine-grained security groups.

⸻
