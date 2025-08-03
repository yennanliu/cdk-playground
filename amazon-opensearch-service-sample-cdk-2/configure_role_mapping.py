#!/usr/bin/env python3
"""
Manual script to configure OpenSearch role mapping for Firehose
This script maps the Firehose IAM role to the OpenSearch all_access role
"""

import json
import sys
import boto3
import urllib3
import base64
from urllib.parse import urlparse
import argparse

def get_stack_outputs(stack_name, region='us-east-1'):
    """Get CloudFormation stack outputs"""
    cf_client = boto3.client('cloudformation', region_name=region)
    
    try:
        response = cf_client.describe_stacks(StackName=stack_name)
        stack = response['Stacks'][0]
        
        outputs = {}
        if 'Outputs' in stack:
            for output in stack['Outputs']:
                outputs[output['OutputKey']] = output['OutputValue']
        
        return outputs
    except Exception as e:
        print(f"Error getting stack outputs: {e}")
        return None

def configure_role_mapping(domain_endpoint, firehose_role_arn, username='admin', password='Admin@OpenSearch123!'):
    """Configure OpenSearch role mapping"""
    
    # Remove https:// if present
    if domain_endpoint.startswith('https://'):
        domain_endpoint = domain_endpoint[8:]
    
    url = f"https://{domain_endpoint}/_plugins/_security/api/rolesmapping/all_access"
    
    role_mapping = {
        "backend_roles": [firehose_role_arn],
        "hosts": [],
        "users": [],
        "reserved": False
    }
    
    # Create basic auth header
    credentials = f"{username}:{password}"
    encoded_credentials = base64.b64encode(credentials.encode('utf-8')).decode('utf-8')
    
    http = urllib3.PoolManager()
    
    print(f"Configuring role mapping for: {firehose_role_arn}")
    print(f"OpenSearch endpoint: {domain_endpoint}")
    print(f"URL: {url}")
    
    try:
        response = http.request(
            'PUT',
            url,
            body=json.dumps(role_mapping, indent=2),
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Basic {encoded_credentials}'
            },
            timeout=30
        )
        
        if response.status in [200, 201]:
            print(f"✅ Role mapping configured successfully!")
            print(f"Response: {response.data.decode('utf-8')}")
            return True
        else:
            print(f"❌ Failed to configure role mapping: {response.status}")
            print(f"Response: {response.data.decode('utf-8')}")
            return False
            
    except Exception as e:
        print(f"❌ Error configuring role mapping: {e}")
        return False

def verify_role_mapping(domain_endpoint, username='admin', password='Admin@OpenSearch123!'):
    """Verify the role mapping configuration"""
    
    # Remove https:// if present
    if domain_endpoint.startswith('https://'):
        domain_endpoint = domain_endpoint[8:]
    
    url = f"https://{domain_endpoint}/_plugins/_security/api/rolesmapping/all_access"
    
    # Create basic auth header
    credentials = f"{username}:{password}"
    encoded_credentials = base64.b64encode(credentials.encode('utf-8')).decode('utf-8')
    
    http = urllib3.PoolManager()
    
    try:
        response = http.request(
            'GET',
            url,
            headers={
                'Authorization': f'Basic {encoded_credentials}'
            },
            timeout=30
        )
        
        if response.status == 200:
            mapping_data = json.loads(response.data.decode('utf-8'))
            print(f"✅ Current role mapping configuration:")
            print(json.dumps(mapping_data, indent=2))
            return True
        else:
            print(f"❌ Failed to get role mapping: {response.status}")
            print(f"Response: {response.data.decode('utf-8')}")
            return False
            
    except Exception as e:
        print(f"❌ Error getting role mapping: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description='Configure OpenSearch role mapping for Firehose')
    parser.add_argument('--stack-name', required=True, help='CloudFormation stack name')
    parser.add_argument('--region', default='us-east-1', help='AWS region (default: us-east-1)')
    parser.add_argument('--username', default='admin', help='OpenSearch master username (default: admin)')
    parser.add_argument('--password', default='Admin@OpenSearch123!', help='OpenSearch master password')
    parser.add_argument('--domain-endpoint', help='OpenSearch domain endpoint (optional, will get from stack)')
    parser.add_argument('--firehose-role-arn', help='Firehose role ARN (optional, will get from stack)')
    parser.add_argument('--verify-only', action='store_true', help='Only verify existing role mapping')
    
    args = parser.parse_args()
    
    # Get stack outputs if not provided
    if not args.domain_endpoint or not args.firehose_role_arn:
        print(f"Getting stack outputs from: {args.stack_name}")
        outputs = get_stack_outputs(args.stack_name, args.region)
        
        if not outputs:
            print("❌ Could not get stack outputs")
            sys.exit(1)
        
        # Look for domain endpoint in outputs
        domain_endpoint = args.domain_endpoint
        if not domain_endpoint:
            # Try common output key names
            for key in outputs:
                if 'domain' in key.lower() and 'endpoint' in key.lower():
                    domain_endpoint = outputs[key]
                    break
        
        # Look for Firehose role ARN in outputs
        firehose_role_arn = args.firehose_role_arn
        if not firehose_role_arn:
            for key in outputs:
                if 'firehose' in key.lower() and 'role' in key.lower() and 'arn' in key.lower():
                    firehose_role_arn = outputs[key]
                    break
        
        print(f"Available stack outputs:")
        for key, value in outputs.items():
            print(f"  {key}: {value}")
        
        if not domain_endpoint:
            print("❌ Could not find OpenSearch domain endpoint in stack outputs")
            print("Please provide --domain-endpoint manually")
            sys.exit(1)
        
        if not firehose_role_arn:
            print("❌ Could not find Firehose role ARN in stack outputs")
            print("Please provide --firehose-role-arn manually")
            sys.exit(1)
    else:
        domain_endpoint = args.domain_endpoint
        firehose_role_arn = args.firehose_role_arn
    
    print("\n" + "="*60)
    print("OpenSearch Role Mapping Configuration")
    print("="*60)
    
    if args.verify_only:
        print("Verifying existing role mapping...")
        verify_role_mapping(domain_endpoint, args.username, args.password)
    else:
        print("Configuring role mapping...")
        success = configure_role_mapping(domain_endpoint, firehose_role_arn, args.username, args.password)
        
        if success:
            print("\nVerifying configuration...")
            verify_role_mapping(domain_endpoint, args.username, args.password)
        else:
            sys.exit(1)

if __name__ == '__main__':
    main()