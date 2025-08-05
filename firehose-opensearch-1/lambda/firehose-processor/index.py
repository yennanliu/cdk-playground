import os
import json
import boto3
import base64
import logging
from typing import List, Dict, Any

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Environment variables
EMBEDDINGS_FUNCTION_ARN = os.environ['EMBEDDINGS_FUNCTION_ARN']
VECTOR_FIELD_NAME = os.environ['VECTOR_FIELD_NAME']

# Initialize AWS clients
lambda_client = boto3.client('lambda')

def get_embeddings(texts: List[str]) -> List[List[float]]:
    """
    Get embeddings for texts using the Bedrock embeddings Lambda function
    """
    try:
        response = lambda_client.invoke(
            FunctionName=EMBEDDINGS_FUNCTION_ARN,
            InvocationType='RequestResponse',
            Payload=json.dumps({'texts': texts})
        )
        
        payload = json.loads(response['Payload'].read())
        if payload.get('statusCode') == 200:
            body = json.loads(payload['body'])
            return body.get('embeddings', [])
        else:
            logger.error(f"Error getting embeddings: {payload}")
            return []
            
    except Exception as e:
        logger.error(f"Error invoking embeddings function: {e}")
        return []

def process_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process a single record
    """
    try:
        # Decode and parse the record data
        data = base64.b64decode(record['data']).decode('utf-8')
        json_data = json.loads(data)
        
        # Get text field for embedding
        text = json_data.get('text', '')
        if not text:
            logger.warning("No text field found in record")
            return {
                'recordId': record['recordId'],
                'result': 'ProcessingFailed',
                'data': record['data']
            }
        
        # Get embedding for the text
        embeddings = get_embeddings([text])
        if not embeddings:
            logger.error("Failed to get embeddings")
            return {
                'recordId': record['recordId'],
                'result': 'ProcessingFailed',
                'data': record['data']
            }
        
        # Add embedding to the record
        json_data[VECTOR_FIELD_NAME] = embeddings[0]
        
        # Encode the processed data
        processed_data = base64.b64encode(
            json.dumps(json_data).encode('utf-8')
        ).decode('utf-8')
        
        return {
            'recordId': record['recordId'],
            'result': 'Ok',
            'data': processed_data
        }
        
    except Exception as e:
        logger.error(f"Error processing record: {e}")
        return {
            'recordId': record['recordId'],
            'result': 'ProcessingFailed',
            'data': record['data']
        }

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to process Firehose records
    """
    logger.info(f"Processing {len(event['records'])} records")
    
    # Process each record
    processed_records = [
        process_record(record)
        for record in event['records']
    ]
    
    return {
        'records': processed_records
    }