# LLM ChatBot System - TODO

## Prompt

Design a simple chatbot system using AWS CDK and an open-source LLM.
The system should allow users to send chat messages via a web interface, process the messages through an LLM backend, and return responses.
Keep the design minimal but functional:

## Requirements:
1. **Frontend**: Simple web UI hosted on S3 + CloudFront (or similar) for sending and displaying messages.
2. **API Layer**: Use API Gateway to handle HTTPS requests from the frontend.
3. **Compute Layer**:
   • Option A: ECS/Fargate running a containerized open-source LLM (e.g., GPT4All, MPT, LLaMA.cpp).
   • Option B: Lambda function calling a small Hugging Face model (CPU-only).
4. **LLM**: Open-source language model for text generation.
5. **Storage (Optional)**: DynamoDB to store chat history and user context.
6. **Networking**: VPC, subnets, and security groups for secure and isolated deployment.

## Design Goals:
• Minimal complexity and cost.
• Scalable: ECS/Fargate auto-scaling or serverless Lambda.
• Optional features: caching with ElastiCache, authentication with Cognito, and real-time messaging via WebSockets.

## Deliverables:
• A high-level architecture diagram.
• AWS CDK resource recommendations for each component.
• Data flow description from user input to LLM response.

## Implementation Tasks:
- [ ] Design high-level architecture diagram
- [ ] Provide AWS CDK resource recommendations for each component
- [ ] Describe data flow from user input to LLM response
- [ ] Implement frontend (S3 + CloudFront web UI)
- [ ] Implement API Gateway for HTTPS requests
- [ ] Choose and implement compute layer (ECS/Fargate or Lambda)
- [ ] Integrate open-source LLM for text generation
- [ ] Add DynamoDB for chat history storage (optional)
- [ ] Set up VPC and networking security