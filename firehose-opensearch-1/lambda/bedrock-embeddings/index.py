import os
import json
import boto3
import logging
from typing import List, Dict, Any, Optional

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Environment variables
MODEL_ID = os.environ.get('MODEL_ID', 'amazon.titan-embed-text-v1')
MAX_TOKENS = int(os.environ.get('MAX_TOKENS', '8192'))
REGION = os.environ.get('REGION', 'us-east-1')

# Initialize Bedrock client
bedrock = boto3.client('bedrock-runtime', region_name=REGION)

def get_embeddings(texts: List[str]) -> List[List[float]]:
    """
    Get embeddings for a list of texts using Amazon Bedrock
    """
    embeddings = []
    
    for text in texts:
        try:
            # Prepare request body
            request_body = {
                "inputText": text,
                "maxTokenCount": MAX_TOKENS
            }
            
            # Call Bedrock API
            response = bedrock.invoke_model(
                modelId=MODEL_ID,
                contentType='application/json',
                accept='application/json',
                body=json.dumps(request_body)
            )
            
            # Parse response
            response_body = json.loads(response['body'].read())
            embedding = response_body.get('embedding', [])
            embeddings.append(embedding)
            
        except Exception as e:
            logger.error(f"Error getting embeddings for text: {e}")
            raise
    
    return embeddings

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to get embeddings from Bedrock
    """
    try:
        # Get texts from event
        texts = event.get('texts', [])
        if not texts:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'No texts provided'})
            }
        
        # Get embeddings
        embeddings = get_embeddings(texts)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'embeddings': embeddings
            })
        }
        
    except Exception as e:
        logger.error(f"Error in lambda handler: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }