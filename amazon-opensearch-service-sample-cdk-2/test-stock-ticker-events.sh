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
    
    # Check Firehose status
    check_firehose_status || exit 1
    
    # Step 2: Send stock ticker test records
    print_status "Step 2: Sending stock ticker records to Firehose..."
    
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
    
    echo ""
    echo -e "${GREEN}=================================================${NC}"
    echo -e "${GREEN}  ✅ STOCK TICKER TEST COMPLETED${NC}"
    echo -e "${GREEN}=================================================${NC}"
    echo -e "Test ID: ${YELLOW}$TEST_ID${NC}"
    echo -e "Records sent: ${YELLOW}$sent_count${NC}"
    echo -e "Status: ${GREEN}All stock ticker records sent to Firehose${NC}"
    echo ""
    echo -e "${BLUE}Note: Records will be processed by Firehose and delivered to OpenSearch${NC}"
    echo -e "${BLUE}Check OpenSearch dashboard or use the e2e test script to verify delivery${NC}"
}

# Run the test
run_stock_ticker_test