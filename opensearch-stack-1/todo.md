Here’s a clear, CDK-oriented prompt you can use:

⸻

Prompt:

Update our current AWS CDK stack so that CloudWatch → Lambda → OpenSearch ingestion is grouped by application type instead of creating a Lambda per log group.

Requirements:
	1.	Each application type (e.g., rails_app, node_service, batch_processor) should have its own Lambda for transformation logic.
	2.	Each Lambda should subscribe to multiple CloudWatch log groups belonging to its app type via subscription filters.
	3.	Make the mapping between log group names and app types configurable (e.g., in cdk.json or a config file).
	4.	Ensure minimal code duplication — transformation code should live inside app-type-specific handlers.
	5.	Use environment variables or mapping tables so Lambdas know which app type they’re processing.
	6.	Maintain existing Firehose or direct OpenSearch write integration logic.

Output:
	•	CDK code changes (TypeScript)
	•	Example folder/file structure for Lambdas grouped by application type
	•	Explanation of how to add a new app type and onboard new log groups

⸻

If you want, I can draft the file structure and sample CDK mapping config for you so the approach is immediately implementable.