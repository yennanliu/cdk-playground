#!/bin/bash

# Test script for AI Music Generation API
# Usage: ./test-api.sh <API_ENDPOINT>

if [ -z "$1" ]; then
  echo "Usage: ./test-api.sh <API_ENDPOINT>"
  echo "Example: ./test-api.sh https://xxxxx.execute-api.us-east-1.amazonaws.com/prod/generate"
  exit 1
fi

ENDPOINT=$1

echo "Testing AI Music Generation API"
echo "Endpoint: $ENDPOINT"
echo ""

# Test 1: Rock music
echo "Test 1: Generating rock music..."
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "heavy metal guitar riff with drums",
    "duration": 30,
    "genre": "rock"
  }' | jq .

echo ""
echo "---"
echo ""

# Test 2: Electronic music
echo "Test 2: Generating electronic music..."
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "ambient synth pad with soft beats",
    "duration": 30,
    "genre": "electronic"
  }' | jq .

echo ""
echo "---"
echo ""

# Test 3: Classical music
echo "Test 3: Generating classical music..."
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "piano and strings, emotional and calm",
    "duration": 30,
    "genre": "classical"
  }' | jq .

echo ""
echo "Done!"
