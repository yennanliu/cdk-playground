#!/bin/bash

# Stock News Summary API Client
# Usage: ./get_stock_news_summary.sh TICKER

# API endpoint
API_ENDPOINT="https://cfedn79iw0.execute-api.ap-northeast-1.amazonaws.com/prod/summarize"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check if ticker argument is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: Stock ticker required${NC}"
    echo -e "Usage: $0 <TICKER>"
    echo -e "Example: $0 TSLA"
    exit 1
fi

TICKER="$1"

# Validate ticker format (1-5 uppercase letters)
if ! [[ "$TICKER" =~ ^[A-Z]{1,5}$ ]]; then
    echo -e "${YELLOW}Warning: Ticker should be 1-5 uppercase letters${NC}"
    echo -e "Converting '$TICKER' to uppercase..."
    TICKER=$(echo "$TICKER" | tr '[:lower:]' '[:upper:]')
fi

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📈 Fetching news summary for: ${GREEN}$TICKER${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Make API request
RESPONSE=$(curl -s -X POST "$API_ENDPOINT" \
    -H "Content-Type: application/json" \
    -d "{\"ticker\": \"$TICKER\"}" \
    -w "\n%{http_code}")

# Extract HTTP status code
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

# Check if response is valid
if [ "$HTTP_CODE" != "200" ]; then
    echo -e "${RED}❌ API request failed (HTTP $HTTP_CODE)${NC}"
    echo ""
    echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
    exit 1
fi

# Check if jq is available for better formatting
if command -v jq &> /dev/null; then
    # Parse with jq
    SUMMARY=$(echo "$BODY" | jq -r '.summary[]' 2>/dev/null)
    SENTIMENT=$(echo "$BODY" | jq -r '.sentiment' 2>/dev/null)
    TIMESTAMP=$(echo "$BODY" | jq -r '.timestamp' 2>/dev/null)
    SOURCES=$(echo "$BODY" | jq -r '.sources[]' 2>/dev/null)

    # Display results
    echo -e "${GREEN}✓ Success!${NC}"
    echo ""

    # Sentiment with color
    case "$SENTIMENT" in
        "positive")
            SENTIMENT_COLOR="${GREEN}"
            SENTIMENT_ICON="📈"
            ;;
        "negative")
            SENTIMENT_COLOR="${RED}"
            SENTIMENT_ICON="📉"
            ;;
        *)
            SENTIMENT_COLOR="${YELLOW}"
            SENTIMENT_ICON="➖"
            ;;
    esac

    echo -e "${BLUE}Sentiment:${NC} ${SENTIMENT_COLOR}${SENTIMENT_ICON} ${SENTIMENT}${NC}"
    echo -e "${BLUE}Timestamp:${NC} $TIMESTAMP"
    echo ""
    echo -e "${BLUE}Summary:${NC}"
    echo "$SUMMARY" | while IFS= read -r line; do
        echo -e "  ${YELLOW}•${NC} $line"
    done
    echo ""
    echo -e "${BLUE}Sources:${NC}"
    echo "$SOURCES" | head -3 | while IFS= read -r url; do
        echo -e "  ${CYAN}→${NC} $url"
    done
else
    # Fallback to python json.tool if jq not available
    echo -e "${GREEN}✓ Success!${NC}"
    echo ""
    echo "$BODY" | python3 -m json.tool
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
