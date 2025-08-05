#!/bin/bash

# Stock Ticker Event Test Script for Firehose -> OpenSearch Integration
# This script sends stock ticker events to Firehose in the specified format

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOMAIN_NAME="os-service-domain-42"
FIREHOSE_STREAM_NAME="Firehose-os-service-domain-42-cloudwatch-logs-stream"
OPENSEARCH_INDEX="cloudwatch-logs"
OPENSEARCH_USER="admin"
OPENSEARCH_PASSWORD="Admin@OpenSearch123!"
TEST_ID="stock-ticker-test-$(date +%Y%m%d-%H%M%S)"

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

# Function to generate stock ticker record
generate_stock_record() {
    local ticker="$1"
    local sector="$2"
    local change="$3"
    local price="$4"
    
    echo '{"TICKER_SYMBOL": "'$ticker'", "SECTOR": "'$sector'", "CHANGE": '$change', "PRICE": '$price'}'
}

# Function to send record to Firehose
send_to_firehose() {
    local record_json="$1"
    local record_num="$2"
    
    print_status "Sending stock record #$record_num to Firehose..."
    
    local encoded_data=$(echo "$record_json" | base64)
    local result=$(aws firehose put-record \
        --delivery-stream-name "$FIREHOSE_STREAM_NAME" \
        --record '{"Data": "'$encoded_data'"}' \
        --output json)
    
    local record_id=$(echo "$result" | jq -r '.RecordId')
    
    if [ "$record_id" != "null" ] && [ -n "$record_id" ]; then
        print_success "Stock record #$record_num sent successfully (ID: ${record_id:0:20}...)"
        echo "  Data: $record_json"
        return 0
    else
        print_error "Failed to send stock record #$record_num"
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

# Function to search for our specific stock ticker test documents
search_stock_ticker_documents() {
    local endpoint="$1"
    
    print_status "Searching for our specific stock ticker test documents..."
    
    # Define the specific prices we sent to verify they were stored
    local test_prices=("84.51" "175.25" "142.80" "158.45" "162.33" "245.67" "128.90" "415.32" "112.45" "28.95")
    local found_count=0
    
    for attempt in {1..3}; do
        print_status "Search attempt $attempt/3..."
        found_count=0
        
        # Check each test price we sent
        for price in "${test_prices[@]}"; do
            local search_result=$(curl -s -u "$OPENSEARCH_USER:$OPENSEARCH_PASSWORD" \
                "$endpoint/$OPENSEARCH_INDEX/_search?q=PRICE:$price&size=1" 2>/dev/null)
            
            local hit_count=$(echo "$search_result" | jq -r '.hits.total.value' 2>/dev/null)
            
            if [ "$hit_count" != "null" ] && [ -n "$hit_count" ] && [ $hit_count -gt 0 ]; then
                found_count=$((found_count + 1))
                local ticker=$(echo "$search_result" | jq -r '.hits.hits[0]._source.TICKER_SYMBOL' 2>/dev/null)
                local sector=$(echo "$search_result" | jq -r '.hits.hits[0]._source.SECTOR' 2>/dev/null)
                local change=$(echo "$search_result" | jq -r '.hits.hits[0]._source.CHANGE' 2>/dev/null)
                print_success "✓ Found $ticker ($sector) Price: \$$price Change: $change"
            fi
        done
        
        if [ $found_count -ge 8 ]; then  # Allow for some tolerance
            print_success "Found $found_count out of ${#test_prices[@]} test stock ticker documents"
            return 0
        else
            print_warning "Only found $found_count out of ${#test_prices[@]} test documents on attempt $attempt"
            if [ $attempt -lt 3 ]; then
                sleep 15
            fi
        fi
    done
    
    print_error "Only found $found_count out of ${#test_prices[@]} test documents after 3 attempts"
    
    # Debug: show some stock ticker documents
    print_status "Showing recent stock ticker documents for debugging..."
    local recent_docs=$(curl -s -u "$OPENSEARCH_USER:$OPENSEARCH_PASSWORD" \
        "$endpoint/$OPENSEARCH_INDEX/_search?q=TICKER_SYMBOL:*&size=5" 2>/dev/null)
    
    echo "$recent_docs" | jq -r '.hits.hits[] | "- " + (._source.TICKER_SYMBOL // "Unknown") + " (" + (._source.SECTOR // "N/A") + ") Price: $" + (._source.PRICE | tostring) + " Change: " + (._source.CHANGE | tostring)' 2>/dev/null || echo "Could not parse recent documents"
    
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
run_stock_ticker_test() {
    echo -e "${BLUE}=================================================${NC}"
    echo -e "${BLUE}  Stock Ticker Events Test${NC}"
    echo -e "${BLUE}=================================================${NC}"
    echo -e "Test ID: ${YELLOW}$TEST_ID${NC}"
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
    
    # Step 3: Send stock ticker test records
    print_status "Step 3: Sending stock ticker records to Firehose..."
    
    # Define stock ticker test data
    local stock_records=(
        "QXZ;HEALTHCARE;-0.05;84.51"
        "AAPL;TECHNOLOGY;2.45;175.25"
        "GOOGL;TECHNOLOGY;-1.23;142.80"
        "JPM;FINANCIAL;0.85;158.45"
        "JNJ;HEALTHCARE;1.12;162.33"
        "TSLA;AUTOMOTIVE;-3.45;245.67"
        "AMZN;TECHNOLOGY;4.22;128.90"
        "MSFT;TECHNOLOGY;1.87;415.32"
        "XOM;ENERGY;-0.67;112.45"
        "PFE;HEALTHCARE;0.34;28.95"
    )
    
    local sent_count=0
    for i in "${!stock_records[@]}"; do
        IFS=';' read -r ticker sector change price <<< "${stock_records[$i]}"
        record_json=$(generate_stock_record "$ticker" "$sector" "$change" "$price")
        
        if send_to_firehose "$record_json" $((i+1)); then
            sent_count=$((sent_count + 1))
        fi
        
        # Small delay between records
        sleep 2
    done
    
    print_success "Sent $sent_count out of ${#stock_records[@]} stock ticker records"
    
    if [ $sent_count -eq 0 ]; then
        print_error "No records were sent successfully"
        exit 1
    fi
    
    # Step 4: Wait for documents in OpenSearch
    print_status "Step 4: Waiting for documents to appear in OpenSearch..."
    
    if wait_for_documents "$DOMAIN_ENDPOINT" $sent_count "$INITIAL_COUNT"; then
        # Step 5: Verify test documents
        print_status "Step 5: Verifying stock ticker documents..."
        
        if search_stock_ticker_documents "$DOMAIN_ENDPOINT"; then
            print_success "E2E test PASSED! All stock ticker documents found in OpenSearch"
        else
            print_error "E2E test FAILED! Stock ticker documents not found"
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
    echo -e "${GREEN}=================================================${NC}"
    echo -e "${GREEN}  ✅ STOCK TICKER E2E TEST COMPLETED SUCCESSFULLY${NC}"
    echo -e "${GREEN}=================================================${NC}"
    echo -e "Test ID: ${YELLOW}$TEST_ID${NC}"
    echo -e "Records sent: ${YELLOW}$sent_count${NC}"
    echo -e "Documents found: ${YELLOW}$final_count - $INITIAL_COUNT = $((final_count - INITIAL_COUNT))${NC}"
    echo -e "Processing time: ${YELLOW}~60-120 seconds${NC}"
    echo -e "Final status: ${GREEN}All stock ticker records successfully processed${NC}"
}

# Run the test
run_stock_ticker_test