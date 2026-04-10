#!/bin/bash
# Seed mock data for Permission Control system
# Usage: ./scripts/seed-data.sh [API_URL]

API="${1:-https://g2l2sl0y56.execute-api.ap-northeast-1.amazonaws.com/v1}"

# Login as guest to get a token for admin operations
echo "=== Getting auth token ==="
TOKEN=$(curl -s -X POST "$API/auth/verify" \
  -H "Content-Type: application/json" \
  -d '{"phone":"admin"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
AUTH="Authorization: Bearer $TOKEN"
echo "Token acquired"

post() { curl -s -X POST "$API$1" -H "Content-Type: application/json" -H "$AUTH" -d "$2" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  OK:', json.dumps(d)[:120])" 2>/dev/null || echo "  FAIL: $1"; }

# --- Departments ---
echo ""
echo "=== Creating Departments ==="
post "/hierarchy/departments" '{"id":"engineering","name":"Engineering"}'
post "/hierarchy/departments" '{"id":"marketing","name":"Marketing"}'
post "/hierarchy/departments" '{"id":"finance","name":"Finance"}'

# --- Teams ---
echo ""
echo "=== Creating Teams ==="
post "/hierarchy/teams" '{"id":"backend","name":"Backend","deptId":"engineering"}'
post "/hierarchy/teams" '{"id":"frontend","name":"Frontend","deptId":"engineering"}'
post "/hierarchy/teams" '{"id":"devops","name":"DevOps","deptId":"engineering"}'
post "/hierarchy/teams" '{"id":"growth","name":"Growth","deptId":"marketing"}'
post "/hierarchy/teams" '{"id":"content","name":"Content","deptId":"marketing"}'
post "/hierarchy/teams" '{"id":"accounting","name":"Accounting","deptId":"finance"}'
post "/hierarchy/teams" '{"id":"analytics","name":"Analytics","deptId":"finance"}'

# --- Employees ---
echo ""
echo "=== Creating Employees ==="
# Engineering - Backend
post "/hierarchy/employees" '{"id":"emp001","name":"Alice Chen","teamId":"backend","deptId":"engineering","phone":"alice"}'
post "/hierarchy/employees" '{"id":"emp002","name":"Bob Wang","teamId":"backend","deptId":"engineering","phone":"bob"}'
# Engineering - Frontend
post "/hierarchy/employees" '{"id":"emp003","name":"Carol Lin","teamId":"frontend","deptId":"engineering","phone":"carol"}'
post "/hierarchy/employees" '{"id":"emp004","name":"Dave Wu","teamId":"frontend","deptId":"engineering","phone":"dave"}'
# Engineering - DevOps
post "/hierarchy/employees" '{"id":"emp005","name":"Eve Chang","teamId":"devops","deptId":"engineering","phone":"eve"}'
# Marketing - Growth
post "/hierarchy/employees" '{"id":"emp006","name":"Frank Liu","teamId":"growth","deptId":"marketing","phone":"frank"}'
post "/hierarchy/employees" '{"id":"emp007","name":"Grace Huang","teamId":"growth","deptId":"marketing","phone":"grace"}'
# Marketing - Content
post "/hierarchy/employees" '{"id":"emp008","name":"Henry Lee","teamId":"content","deptId":"marketing","phone":"henry"}'
# Finance - Accounting
post "/hierarchy/employees" '{"id":"emp009","name":"Ivy Tsai","teamId":"accounting","deptId":"finance","phone":"ivy"}'
# Finance - Analytics
post "/hierarchy/employees" '{"id":"emp010","name":"Jack Yang","teamId":"analytics","deptId":"finance","phone":"jack"}'

# --- Roles ---
echo ""
echo "=== Creating Roles ==="
post "/roles" '{"name":"viewer","permissions":["dataset:read"],"datasets":["*"]}'
post "/roles" '{"name":"editor","permissions":["dataset:read","dataset:write"],"datasets":["*"]}'
post "/roles" '{"name":"admin","permissions":["dataset:read","dataset:write","dataset:delete"],"datasets":["*"]}'
post "/roles" '{"name":"marketing-analyst","permissions":["dataset:read"],"datasets":["campaigns","ad-spend","user-acquisition"]}'
post "/roles" '{"name":"finance-reader","permissions":["dataset:read"],"datasets":["revenue","expenses","payroll"]}'
post "/roles" '{"name":"finance-editor","permissions":["dataset:read","dataset:write"],"datasets":["revenue","expenses","payroll"]}'
post "/roles" '{"name":"infra-ops","permissions":["dataset:read","dataset:write"],"datasets":["logs","metrics","traces"]}'

# --- Role Assignments ---
echo ""
echo "=== Assigning Roles ==="
# Department-level: all engineering gets viewer
post "/roles/assign" '{"entityId":"DEPT#engineering","roleName":"viewer"}'
# Department-level: all marketing gets marketing-analyst
post "/roles/assign" '{"entityId":"DEPT#marketing","roleName":"marketing-analyst"}'
# Department-level: all finance gets finance-reader
post "/roles/assign" '{"entityId":"DEPT#finance","roleName":"finance-reader"}'

# Team-level: devops team gets infra-ops
post "/roles/assign" '{"entityId":"TEAM#devops","roleName":"infra-ops"}'
# Team-level: analytics team gets finance-editor (upgrade from dept-level reader)
post "/roles/assign" '{"entityId":"TEAM#analytics","roleName":"finance-editor"}'
# Team-level: backend team gets editor
post "/roles/assign" '{"entityId":"TEAM#backend","roleName":"editor"}'

# Employee-level: Alice gets admin (she's the tech lead)
post "/roles/assign" '{"entityId":"EMP#emp001","roleName":"admin"}'
# Employee-level: Frank gets editor for marketing campaigns
post "/roles/assign" '{"entityId":"EMP#emp006","roleName":"editor"}'

# --- Mock Datasets (upload to S3) ---
echo ""
echo "=== Creating Mock Datasets ==="
BUCKET="permissioncontrolstack-datasetbucket9be8b15b-pnaqcqfwovun"

upload_dataset() {
  local id="$1"
  local desc="$2"
  echo "$desc" | aws s3 cp - "s3://$BUCKET/$id/data" --content-type "text/csv" 2>/dev/null && echo "  OK: $id" || echo "  FAIL: $id"
}

# Engineering datasets
upload_dataset "logs" "timestamp,level,service,message
2026-04-01T10:00:00Z,INFO,api-gateway,Request received GET /users
2026-04-01T10:00:01Z,INFO,auth-service,Token validated for user emp001
2026-04-01T10:00:02Z,ERROR,payment-service,Connection timeout to payment provider
2026-04-01T10:00:03Z,WARN,inventory-service,Stock below threshold for SKU-1234
2026-04-01T10:00:05Z,INFO,api-gateway,Response sent 200 OK"

upload_dataset "metrics" "timestamp,service,metric,value,unit
2026-04-01T10:00:00Z,api-gateway,request_count,1523,count
2026-04-01T10:00:00Z,api-gateway,latency_p99,245,ms
2026-04-01T10:00:00Z,auth-service,auth_success_rate,99.7,percent
2026-04-01T10:00:00Z,payment-service,transaction_count,892,count
2026-04-01T10:00:00Z,payment-service,error_rate,0.3,percent"

upload_dataset "traces" "trace_id,span_id,parent_span_id,service,operation,duration_ms,status
abc123,span-1,,api-gateway,GET /orders,342,OK
abc123,span-2,span-1,auth-service,validate_token,15,OK
abc123,span-3,span-1,order-service,fetch_orders,280,OK
abc123,span-4,span-3,db-proxy,query_orders,245,OK
def456,span-5,,api-gateway,POST /payments,1205,ERROR"

# Marketing datasets
upload_dataset "campaigns" "campaign_id,name,channel,start_date,end_date,budget,spent,impressions,clicks,conversions
C001,Spring Sale 2026,google_ads,2026-03-01,2026-03-31,50000,48500,2500000,75000,3200
C002,Product Launch,facebook,2026-03-15,2026-04-15,30000,22000,1800000,45000,1800
C003,Brand Awareness,youtube,2026-02-01,2026-04-30,80000,65000,5000000,120000,5500
C004,Retargeting Q1,google_ads,2026-01-01,2026-03-31,20000,19800,800000,32000,2800
C005,Email Nurture,email,2026-04-01,2026-06-30,5000,1200,150000,22000,950"

upload_dataset "ad-spend" "month,channel,budget,actual_spend,cpc,cpm,roas
2026-01,google_ads,25000,24800,1.25,8.50,4.2
2026-01,facebook,15000,14500,0.95,6.20,3.8
2026-01,youtube,20000,19000,0.45,12.00,2.9
2026-02,google_ads,28000,27500,1.30,8.80,4.5
2026-02,facebook,18000,17200,1.00,6.50,3.6
2026-02,youtube,22000,21000,0.48,11.50,3.1
2026-03,google_ads,30000,29000,1.18,8.20,4.8
2026-03,facebook,20000,19500,0.88,5.90,4.0"

upload_dataset "user-acquisition" "date,source,new_users,activation_rate,day7_retention,day30_retention,ltv_estimate
2026-03-01,organic,520,68.5,42.3,28.1,45.00
2026-03-01,google_ads,340,62.1,38.7,24.5,38.50
2026-03-01,facebook,280,59.8,35.2,22.0,35.00
2026-03-01,referral,150,75.3,52.1,38.6,62.00
2026-03-08,organic,485,67.2,41.8,27.5,44.00
2026-03-08,google_ads,390,63.5,39.2,25.0,39.50
2026-03-08,facebook,310,60.5,36.0,22.8,36.00
2026-03-08,referral,180,76.1,53.0,39.2,64.00"

# Finance datasets
upload_dataset "revenue" "month,product_line,region,gross_revenue,discounts,net_revenue,units_sold
2026-01,SaaS Platform,APAC,850000,42500,807500,1250
2026-01,SaaS Platform,Americas,1200000,60000,1140000,1800
2026-01,API Services,APAC,320000,16000,304000,890
2026-01,API Services,Americas,480000,24000,456000,1340
2026-02,SaaS Platform,APAC,920000,46000,874000,1380
2026-02,SaaS Platform,Americas,1350000,67500,1282500,2020
2026-02,API Services,APAC,355000,17750,337250,985
2026-02,API Services,Americas,520000,26000,494000,1450
2026-03,SaaS Platform,APAC,980000,49000,931000,1470
2026-03,SaaS Platform,Americas,1420000,71000,1349000,2130"

upload_dataset "expenses" "month,category,department,amount,vendor,description
2026-01,Cloud Infrastructure,Engineering,125000,AWS,EC2 + RDS + S3 hosting
2026-01,SaaS Tools,Engineering,18000,GitHub,Enterprise licenses
2026-01,Salaries,Engineering,680000,,Engineering team payroll
2026-01,Marketing Spend,Marketing,85000,Various,Ad spend + tools
2026-01,Salaries,Marketing,220000,,Marketing team payroll
2026-01,Office,Finance,15000,WeWork,Office lease
2026-01,Salaries,Finance,180000,,Finance team payroll
2026-02,Cloud Infrastructure,Engineering,132000,AWS,EC2 + RDS + S3 hosting
2026-02,Salaries,Engineering,695000,,Engineering team payroll
2026-02,Marketing Spend,Marketing,92000,Various,Ad spend + tools"

upload_dataset "payroll" "month,employee_id,department,team,base_salary,bonus,total
2026-03,emp001,engineering,backend,15000,3000,18000
2026-03,emp002,engineering,backend,12000,1500,13500
2026-03,emp003,engineering,frontend,12500,1500,14000
2026-03,emp004,engineering,frontend,11000,1000,12000
2026-03,emp005,engineering,devops,13000,2000,15000
2026-03,emp006,marketing,growth,11000,2500,13500
2026-03,emp007,marketing,growth,10000,1000,11000
2026-03,emp008,marketing,content,9500,800,10300
2026-03,emp009,finance,accounting,11500,1200,12700
2026-03,emp010,finance,analytics,12000,1500,13500"

echo ""
echo "=== Done! ==="
echo ""
echo "Login as any employee by name: alice, bob, carol, dave, eve, frank, grace, henry, ivy, jack"
echo ""
echo "Permission summary:"
echo "  alice  (eng/backend)   - admin (all datasets, read+write+delete)"
echo "  bob    (eng/backend)   - viewer + editor (all datasets, read+write)"
echo "  carol  (eng/frontend)  - viewer (all datasets, read)"
echo "  dave   (eng/frontend)  - viewer (all datasets, read)"
echo "  eve    (eng/devops)    - viewer + infra-ops (all + logs/metrics/traces, read+write)"
echo "  frank  (mkt/growth)    - marketing-analyst + editor (campaigns/ad-spend/user-acquisition + all, read+write)"
echo "  grace  (mkt/growth)    - marketing-analyst (campaigns/ad-spend/user-acquisition, read)"
echo "  henry  (mkt/content)   - marketing-analyst (campaigns/ad-spend/user-acquisition, read)"
echo "  ivy    (fin/accounting) - finance-reader (revenue/expenses/payroll, read)"
echo "  jack   (fin/analytics)  - finance-reader + finance-editor (revenue/expenses/payroll, read+write)"
