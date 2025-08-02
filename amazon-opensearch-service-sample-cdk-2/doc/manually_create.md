To manually create a Kinesis Firehose delivery stream that loads CloudWatch Logs into Amazon OpenSearch using the AWS Console (UI), you’ll need to complete the following steps in order:

⸻

✅ Step 1: Create OpenSearch Domain
	1.	Go to OpenSearch Service in the AWS Console.
	2.	Click Create domain.
	3.	Choose:
	•	Deployment type: “Development and testing” (for simplicity)
	•	Domain name: cloudwatch-logs-domain
	4.	Configure the rest as default or minimal resources (1 node).
	5.	Under Access policy, choose:
	•	“Only use fine-grained access control” or
	•	“Allow access to specific IAM roles” and include Firehose role later
	6.	Click Create.

⸻

✅ Step 2: Create an IAM Role for Firehose
	1.	Go to IAM > Roles > Create role.
	2.	Trusted entity: Choose Kinesis Firehose.
	3.	Permissions:
	•	Attach these policies:
	•	AmazonOpenSearchServiceFullAccess
	•	CloudWatchFullAccess
	•	AmazonKinesisFirehoseFullAccess
	•	Optionally, a custom policy to restrict access to your domain/index
	4.	Name the role: e.g., FirehoseDeliveryRole.
	5.	Save the Role ARN for use in next step.

⸻

✅ Step 3: Create Kinesis Firehose
	1.	Go to Kinesis > Data Firehose > Create delivery stream.
	2.	Name: cw-logs-to-opensearch
	3.	Source:
	•	Choose Direct PUT or other sources (CloudWatch Logs will send directly).
	4.	Destination:
	•	Choose Amazon OpenSearch Service.
	5.	Configure OpenSearch:
	•	Choose your domain created in Step 1.
	•	Index name: cloudwatch-logs
	•	Index rotation: daily or none
	6.	IAM Role:
	•	Select the role you created: FirehoseDeliveryRole
	7.	Buffer size and interval: (default values are fine)
	8.	Click Create delivery stream.

⸻

✅ Step 4: Create CloudWatch Logs Subscription Filter
	1.	Go to CloudWatch > Log groups.
	2.	Select a log group you want to stream (e.g., /aws/lambda/my-lambda-function)
	3.	Actions > Create subscription filter.
	4.	Choose destination: Kinesis Firehose
	5.	Choose delivery stream: cw-logs-to-opensearch
	6.	Define filter pattern (e.g., "" to capture all logs).
	7.	IAM role for this step:
	•	You’ll be prompted to allow CloudWatch Logs to send data to Firehose.
	•	Use a service role with permission AmazonKinesisFirehoseFullAccess.

⸻

🔍 Testing
	1.	Trigger your application to generate logs.
	2.	Go to OpenSearch Dashboards (via the OpenSearch domain UI).
	3.	Go to Discover tab and query the cloudwatch-logs index.

⸻

⚠️ Notes
	•	Ensure your OpenSearch domain has public access enabled, or your VPC network allows access from Firehose.
	•	Fine-grained access control may need specific users with index permissions.
	•	Use OpenSearch version 1.3+ for best compatibility with Firehose.