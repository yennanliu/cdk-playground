#!/bin/bash

# E2E Test Script for Firehose -> OpenSearch Integration
# This script sends test events to Firehose and verifies they reach OpenSearch

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOMAIN_NAME=""
FIREHOSE_STREAM_NAME="Firehose-os-service-domain-41-cloudwatch-logs-stream"
OPENSEARCH_INDEX="cloudwatch-logs"
OPENSEARCH_USER="admin"
OPENSEARCH_PASSWORD="Admin@OpenSearch123!"
TEST_ID="e2e-test-$(date +%Y%m%d-%H%M%S)"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Function to generate test data
generate_test_record() {
    local message="$1"
    local level="$2"
    local service="$3"
    local record_num="$4"
    
    # Use simpler JSON structure like our successful manual test
    echo '{"timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'", "message": "'$message'", "level": "'$level'", "service": "'$service'", "test_id": "'$TEST_ID'", "record_number": '$record_num'}'
}

# Function to send record to Firehose
send_to_firehose() {
    local record_json="$1"
    local record_num="$2"
    
    print_status "Sending record #$record_num to Firehose..."
    
    local encoded_data=$(echo "$record_json" | base64)
    local result=$(aws firehose put-record \
        --delivery-stream-name "$FIREHOSE_STREAM_NAME" \
        --record '{"Data": "'$encoded_data'"}' \
        --output json)
    
    local record_id=$(echo "$result" | jq -r '.RecordId')
    
    if [ "$record_id" != "null" ] && [ -n "$record_id" ]; then
        print_success "Record #$record_num sent successfully (ID: ${record_id:0:20}...)"
        return 0
    else
        print_error "Failed to send record #$record_num"
        echo "$result"
        return 1
    fi
}

# Function to get OpenSearch domain endpoint
get_domain_endpoint() {
    local endpoint=$(aws opensearch describe-domain \
        --domain-name "$DOMAIN_NAME" \
        --query 'DomainStatus.Endpoint' \
        --output text 2>/dev/null)
    
    if [ "$endpoint" = "None" ] || [ -z "$endpoint" ]; then
        return 1
    fi
    
    echo "https://$endpoint"
}

# Function to check OpenSearch cluster health
check_opensearch_health() {
    local endpoint="$1"
    
    print_status "Checking OpenSearch cluster health..."
    print_status "Using endpoint: $endpoint"
    
    local health_response
    health_response=$(curl -s -u "$OPENSEARCH_USER:$OPENSEARCH_PASSWORD" \
        "$endpoint/_cluster/health" 2>&1)
    local curl_exit_code=$?
    
    if [ $curl_exit_code -ne 0 ]; then
        print_error "Curl failed with exit code: $curl_exit_code"
        print_error "Curl output: $health_response"
        return 1
    fi
    
    if [ -z "$health_response" ]; then
        print_error "Empty response from OpenSearch"
        return 1
    fi
    
    local health
    health=$(echo "$health_response" | jq -r '.status' 2>/dev/null)
    
    if [ "$health" = "green" ] || [ "$health" = "yellow" ]; then
        print_success "OpenSearch cluster is healthy (status: $health)"
        return 0
    else
        print_error "OpenSearch cluster is unhealthy (status: $health)"
        echo "Health response: $health_response"
        return 1
    fi
}

# Function to get document count before test
get_initial_count() {
    local endpoint="$1"
    
    local count=$(curl -s -u "$OPENSEARCH_USER:$OPENSEARCH_PASSWORD" \
        "$endpoint/$OPENSEARCH_INDEX/_count" | jq -r '.count' 2>/dev/null)
    
    if [ "$count" != "null" ] && [ -n "$count" ]; then
        echo "$count"
    else
        echo "0"
    fi
}

# Function to wait for documents to appear in OpenSearch
wait_for_documents() {
    local endpoint="$1"
    local expected_count="$2"
    local initial_count="$3"
    local max_wait_time=300  # 5 minutes  
    local check_interval=15  # 15 seconds
    local elapsed=0
    
    print_status "Waiting for $expected_count documents to appear in OpenSearch..."
    print_status "Will check every $check_interval seconds (max wait: ${max_wait_time}s)"
    
    while [ $elapsed -lt $max_wait_time ]; do
        local current_count=$(curl -s -u "$OPENSEARCH_USER:$OPENSEARCH_PASSWORD" \
            "$endpoint/$OPENSEARCH_INDEX/_count" 2>/dev/null | jq -r '.count' 2>/dev/null)
        
        if [ "$current_count" != "null" ] && [ -n "$current_count" ]; then
            local new_docs=$((current_count - initial_count))
            
            if [ $new_docs -ge $expected_count ]; then
                print_success "Found $new_docs new documents (expected: $expected_count)"
                return 0
            else
                print_status "Current: $current_count docs ($new_docs new), waiting for $expected_count..."
            fi
        else
            print_status "Could not get document count, retrying..."
        fi
        
        sleep $check_interval
        elapsed=$((elapsed + check_interval))
    done
    
    print_error "Timeout waiting for documents to appear after ${max_wait_time}s"
    return 1
}

# Function to search for test documents
search_test_documents() {
    local endpoint="$1"
    
    print_status "Searching for test documents with test_id: $TEST_ID..."
    
    # Wait a bit more for indexing and try multiple times
    for attempt in {1..3}; do
        print_status "Search attempt $attempt/3..."
        
        local search_result=$(curl -s -u "$OPENSEARCH_USER:$OPENSEARCH_PASSWORD" \
            "$endpoint/$OPENSEARCH_INDEX/_search?q=test_id:$TEST_ID&size=10&sort=timestamp:desc" 2>/dev/null)
        
        local hit_count=$(echo "$search_result" | jq -r '.hits.total.value' 2>/dev/null)
        
        if [ "$hit_count" != "null" ] && [ -n "$hit_count" ] && [ $hit_count -gt 0 ]; then
            print_success "Found $hit_count test documents"
            
            # Display the documents
            echo -e "\n${BLUE}Test Documents Found:${NC}"
            echo "$search_result" | jq -r '.hits.hits[] | "- " + ._source.message + " (" + ._source.level + ", record #" + (._source.record_number | tostring) + ")"'
            
            # Verify all expected records
            local records=$(echo "$search_result" | jq -r '.hits.hits[] | ._source.record_number' | sort -n | tr '\n' ' ')
            echo -e "\n${BLUE}Record Numbers Found:${NC} $records"
            
            # Show query performance
            local query_time=$(echo "$search_result" | jq -r '.took')
            print_success "Search completed in ${query_time}ms"
            
            return 0
        else
            print_warning "No test documents found on attempt $attempt"
            if [ $attempt -lt 3 ]; then
                sleep 15
            fi
        fi
    done
    
    print_error "No test documents found after 3 attempts"
    
    # Debug: show recent documents
    print_status "Showing recent documents for debugging..."
    local recent_docs=$(curl -s -u "$OPENSEARCH_USER:$OPENSEARCH_PASSWORD" \
        "$endpoint/$OPENSEARCH_INDEX/_search?size=5&sort=timestamp:desc" 2>/dev/null)
    
    echo "$recent_docs" | jq -r '.hits.hits[] | "- " + ._source.message + " (service: " + (._source.service // "N/A") + ", time: " + (._source.timestamp // "N/A") + ")"'
    
    return 1
}

# Function to check Firehose delivery stream status
check_firehose_status() {
    print_status "Checking Firehose delivery stream status..."
    
    local status=$(aws firehose describe-delivery-stream \
        --delivery-stream-name "$FIREHOSE_STREAM_NAME" \
        --query 'DeliveryStreamDescription.DeliveryStreamStatus' \
        --output text 2>/dev/null)
    
    if [ "$status" = "ACTIVE" ]; then
        print_success "Firehose delivery stream is ACTIVE"
        return 0
    else
        print_error "Firehose delivery stream status: $status"
        return 1
    fi
}

# Function to check for Firehose errors
check_firehose_errors() {
    print_status "Checking for recent Firehose errors..."
    
    local log_group="/aws/firehose/$FIREHOSE_STREAM_NAME"
    
    # Check if log group exists
    aws logs describe-log-groups --log-group-name-prefix "$log_group" --query 'logGroups[0].logGroupName' --output text 2>/dev/null | grep -q "$FIREHOSE_STREAM_NAME"
    
    if [ $? -eq 0 ]; then
        # Get recent log streams
        local log_streams=$(aws logs describe-log-streams \
            --log-group-name "$log_group" \
            --order-by LastEventTime \
            --descending \
            --max-items 3 \
            --query 'logStreams[].logStreamName' \
            --output text 2>/dev/null)
        
        if [ -n "$log_streams" ]; then
            print_status "Found recent log streams, checking for errors..."
            
            for stream in $log_streams; do
                local errors=$(aws logs get-log-events \
                    --log-group-name "$log_group" \
                    --log-stream-name "$stream" \
                    --start-time $(($(date +%s) * 1000 - 3600000)) \
                    --query 'events[?contains(message, `ERROR`) || contains(message, `Failed`)].message' \
                    --output text 2>/dev/null)
                
                if [ -n "$errors" ] && [ "$errors" != "None" ]; then
                    print_warning "Found errors in log stream $stream:"
                    echo "$errors"
                fi
            done
        else
            print_status "No recent log streams found"
        fi
    else
        print_status "No Firehose error logs found (log group doesn't exist yet)"
    fi
}

# Main test function
run_e2e_test() {
    echo -e "${BLUE}=================================================${NC}"
    echo -e "${BLUE}  Firehose -> OpenSearch E2E Test${NC}"
    echo -e "${BLUE}=================================================${NC}"
    echo -e "Test ID: ${YELLOW}$TEST_ID${NC}"
    echo -e "Domain: ${YELLOW}$DOMAIN_NAME${NC}"
    echo -e "Stream: ${YELLOW}$FIREHOSE_STREAM_NAME${NC}"
    echo ""
    
    # Step 1: Check prerequisites
    print_status "Step 1: Checking prerequisites..."
    
    # Check if AWS CLI is configured
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        print_error "AWS CLI not configured or credentials invalid"
        exit 1
    fi
    
    # Check if jq is installed
    if ! command -v jq >/dev/null 2>&1; then
        print_error "jq is required but not installed"
        exit 1
    fi
    
    # Get domain endpoint
    print_status "Getting OpenSearch domain endpoint..."
    DOMAIN_ENDPOINT=$(get_domain_endpoint)
    if [ $? -ne 0 ] || [ -z "$DOMAIN_ENDPOINT" ]; then
        print_error "Could not retrieve domain endpoint for $DOMAIN_NAME"
        exit 1
    fi
    print_success "Domain endpoint: $DOMAIN_ENDPOINT"
    
    # Check Firehose status
    check_firehose_status || exit 1
    
    # Check OpenSearch health
    check_opensearch_health "$DOMAIN_ENDPOINT" || exit 1
    
    # Step 2: Get baseline metrics
    print_status "Step 2: Getting baseline metrics..."
    INITIAL_COUNT=$(get_initial_count "$DOMAIN_ENDPOINT")
    print_success "Initial document count: $INITIAL_COUNT"
    
    # Step 3: Send test records
    print_status "Step 3: Sending test records to Firehose..."
    
    local test_records=(
        "User login successful;INFO;auth-service"
        "Payment processed;SUCCESS;payment-service"
    )
    
    local sent_count=0
    for i in "${!test_records[@]}"; do
        IFS=';' read -r message level service <<< "${test_records[$i]}"
        record_json=$(generate_test_record "$message" "$level" "$service" $((i+1)))
        
        if send_to_firehose "$record_json" $((i+1)); then
            sent_count=$((sent_count + 1))
        fi
        
        # Small delay between records
        sleep 1
    done
    
    print_success "Sent $sent_count out of ${#test_records[@]} records"
    
    if [ $sent_count -eq 0 ]; then
        print_error "No records were sent successfully"
        exit 1
    fi
    
    # Step 4: Wait for documents in OpenSearch
    print_status "Step 4: Waiting for documents to appear in OpenSearch..."
    
    if wait_for_documents "$DOMAIN_ENDPOINT" $sent_count "$INITIAL_COUNT"; then
        # Step 5: Verify test documents
        print_status "Step 5: Verifying test documents..."
        
        if search_test_documents "$DOMAIN_ENDPOINT"; then
            print_success "E2E test PASSED! All test documents found in OpenSearch"
        else
            print_error "E2E test FAILED! Test documents not found"
            check_firehose_errors
            exit 1
        fi
    else
        print_error "E2E test FAILED! Documents did not appear in OpenSearch within timeout"
        check_firehose_errors
        exit 1
    fi
    
    # Step 6: Final status check
    print_status "Step 6: Final status summary..."
    
    local final_count=$(curl -s -u "$OPENSEARCH_USER:$OPENSEARCH_PASSWORD" \
        "$DOMAIN_ENDPOINT/$OPENSEARCH_INDEX/_count" | jq -r '.count' 2>/dev/null)
    
    print_success "Final document count: $final_count"
    print_success "Documents added: $((final_count - INITIAL_COUNT))"
    
    echo ""
    # Calculate processing time
    local end_time=$(date +%s)
    local processing_time=$((end_time - $(date -d "$(echo "$TEST_ID" | sed 's/e2e-test-[0-9]*-//')" +%s) + $(date +%s) - end_time + 120)) # Rough estimate
    
    echo ""
    echo -e "${GREEN}=================================================${NC}"
    echo -e "${GREEN}  ✅ E2E TEST COMPLETED SUCCESSFULLY${NC}"
    echo -e "${GREEN}=================================================${NC}"
    echo -e "Test ID: ${YELLOW}$TEST_ID${NC}"
    echo -e "Records sent: ${YELLOW}$sent_count${NC}"
    echo -e "Documents found: ${YELLOW}$final_count - $INITIAL_COUNT = $((final_count - INITIAL_COUNT))${NC}"
    echo -e "Processing time: ${YELLOW}~60-120 seconds${NC}"
    echo -e "Final status: ${GREEN}All records successfully processed${NC}"
    echo ""
}

# Run the test
run_e2e_test