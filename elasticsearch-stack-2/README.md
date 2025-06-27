# Open search Stack V2

📊 System Diagram

           +-----------------------------+
           | Amazon OpenSearch Domain    |
           |-----------------------------|
           | Indexing Engine             |
           | REST API Endpoint           |
           | Dashboards (Kibana-like UI) |
           +-----------------------------+

               |
      +--------+--------+
      |                 |
[Manual Ingest via UI]  [Ingest via REST API / curl]


⸻

⚙️ Setup Details
	•	Engine version: e.g., OpenSearch 2.11 (latest stable)
	•	Deployment type: Development (single AZ) or Production (multi-AZ)
	•	Node type: t3.small.search (low-cost entry node)
	•	Storage: 10–50 GiB of EBS SSD (gp3) volume
	•	Access:
	•	Public access with fine-grained IAM
	•	Or private VPC access with security groups

⸻

🧪 Usage After Setup
	1.	Open Dashboards
	•	Use the built-in OpenSearch Dashboards (Kibana-like UI)
	•	Default URL: https://<your-domain>/_dashboards
	2.	Create index manually
	•	Via UI or REST:

PUT /my-index
{
  "settings": { "number_of_shards": 1 },
  "mappings": {
    "properties": {
      "title": { "type": "text" },
      "createdAt": { "type": "date" }
    }
  }
}


	3.	Manually ingest documents
	•	Curl or Postman:

POST /my-index/_doc
{
  "title": "First doc",
  "createdAt": "2024-06-06T00:00:00Z"
}



⸻
