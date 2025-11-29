#!/bin/bash

# Test script for the deployed SageMaker ML API
# Usage: ./test-api.sh <API_ENDPOINT_URL>

if [ -z "$1" ]; then
    echo "Usage: ./test-api.sh <API_ENDPOINT_URL>"
    echo "Example: ./test-api.sh https://abc123.execute-api.ap-northeast-1.amazonaws.com/prod/predict"
    exit 1
fi

API_URL="$1"

echo "=================================="
echo "Testing House Price Prediction API"
echo "=================================="
echo "API Endpoint: $API_URL"
echo ""

# Test 1: Basic prediction
echo "Test 1: Basic house prediction"
echo "Input: 3 bedrooms, 2 bathrooms, 2000 sqft, built in 2015"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2000,
    "year_built": 2015
  }' | jq .

echo ""
echo ""

# Test 2: Luxury house
echo "Test 2: Luxury house prediction"
echo "Input: 5 bedrooms, 4 bathrooms, 3500 sqft, built in 2020"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "bedrooms": 5,
    "bathrooms": 4,
    "sqft": 3500,
    "year_built": 2020
  }' | jq .

echo ""
echo ""

# Test 3: Small house
echo "Test 3: Small house prediction"
echo "Input: 2 bedrooms, 1 bathroom, 1200 sqft, built in 2010"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "bedrooms": 2,
    "bathrooms": 1,
    "sqft": 1200,
    "year_built": 2010
  }' | jq .

echo ""
echo ""

# Test 4: Invalid input (should fail)
echo "Test 4: Invalid input (missing required field)"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 2000
  }' | jq .

echo ""
echo ""
echo "=================================="
echo "Testing complete!"
echo "=================================="
