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
