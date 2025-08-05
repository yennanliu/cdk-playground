from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth
import os
import boto3
import json
import logging
import cfnresponse
import time

# Environment variables
COLLECTION_ENDPOINT = os.environ.get('COLLECTION_ENDPOINT')
INDEX_NAME = os.environ.get('INDEX_NAME')
VECTOR_FIELD_NAME = os.environ.get('VECTOR_FIELD_NAME')
VECTOR_DIMENSION = int(os.environ.get('VECTOR_DIMENSION', '1536'))

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def log(message):
    logger.info(message)

def lambda_handler(event, context):
    """
    Lambda handler to create OpenSearch Index with vector search capabilities
    """
    log(f"Event: {json.dumps(event)}")

    session = boto3.Session()
    credentials = session.get_credentials()
    region = session.region_name
    service = 'aoss'
    status = cfnresponse.SUCCESS
    response = {}

    try:
        # Create AWS auth
        auth = AWSV4SignerAuth(credentials, region, service)

        # Create OpenSearch client
        client = OpenSearch(
            hosts=[{'host': COLLECTION_ENDPOINT.split('//')[1], 'port': 443}],
            http_auth=auth,
            use_ssl=True,
            verify_certs=True,
            connection_class=RequestsHttpConnection,
            pool_maxsize=20,
        )

        if event['RequestType'] == 'Create':
            log(f"Creating index: {INDEX_NAME}")

            # Define index body with vector search capabilities
            index_body = {
                'settings': {
                    'index.knn': True,
                    'index.knn.algo_param.ef_search': 512,
                },
                'mappings': {
                    'properties': {
                        VECTOR_FIELD_NAME: {
                            'type': 'knn_vector',
                            'dimension': VECTOR_DIMENSION,
                            'method': {
                                'space_type': 'innerproduct',
                                'engine': 'faiss',
                                'name': 'hnsw',
                                'parameters': {
                                    'm': 16,
                                    'ef_construction': 512,
                                },
                            },
                        },
                        'text': {'type': 'text'},
                        'metadata': {'type': 'text', 'index': False},
                        'timestamp': {'type': 'date'},
                    }
                },
            }

            # Create index
            response = client.indices.create(INDEX_NAME, body=index_body)
            log(f"Response: {response}")

            # Wait for index to be ready
            log("Waiting for index to be ready...")
            time.sleep(60)

        elif event['RequestType'] == 'Delete':
            log(f"Deleting index: {INDEX_NAME}")
            try:
                response = client.indices.delete(index=INDEX_NAME)
                log(f"Response: {response}")
            except Exception as e:
                log(f"Error deleting index: {e}")
                # Don't fail on delete if index doesn't exist
                pass

        else:
            log("Update request - no action needed")

    except Exception as e:
        logging.error("Exception: %s" % e, exc_info=True)
        status = cfnresponse.FAILED

    finally:
        cfnresponse.send(event, context, status, response)

    return {
        'statusCode': 200,
        'body': json.dumps('Index creation lambda completed successfully')
    }