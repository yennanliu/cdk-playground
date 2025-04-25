# Lambda CRUDL

---

## 🛠️ Simple In-Memory CRUDL API (AWS CDK + TypeScript)

This is a super lightweight demo API using:
- AWS **CDK** (TypeScript)
- **API Gateway** for the REST API
- **Lambda** for handling requests
- **In-memory** storage inside Lambda (no DB!)

Great for testing, mocking, or learning CDK.

---

### 📁 Project Structure
```
.
├── bin/
│   └── lambda-crudl.ts         # CDK entry point
├── lib/
│   └── crud-api-stack.ts       # Defines the API + Lambda
├── lambda/
│   └── handler.ts              # Lambda function with CRUD logic
├── package.json
├── tsconfig.json
├── cdk.json
└── README.md
```

---

## 🚀 Getting Started

### 1. 📦 Install Dependencies

```bash
npm install
```

### 2. 🛠 Build Project

```bash
npm run build

# compile TS to JS
npx tsc -p tsconfig.lambda.json
```

### 3. 🧱 Bootstrap CDK (only once per environment)

```bash
npx cdk bootstrap
```

### 4. 🚀 Deploy Stack

```bash
npx cdk deploy
```

After deployment, you'll see an output like:

```
Outputs:
CrudApiStack.CrudApiEndpoint = https://abc123.execute-api.us-east-1.amazonaws.com/prod
```

Save that base URL! We’ll call it `API_URL` below.

---

## 🧪 Test the API (with `curl`)

Replace `API_URL` with your actual deployed endpoint.

---

### ✅ Create Item
```bash
curl -X POST $API_URL/items \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Item", "description": "Just testing"}'
```

---

### 📄 List All Items
```bash
curl $API_URL/items
```

---

### 🔍 Get Specific Item
```bash
curl $API_URL/items/{id}
```
> Replace `{id}` with the actual ID returned from the POST call.

---

### ✏️ Update Item
```bash
curl -X PUT $API_URL/items/{id} \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Item", "description": "Updated details"}'
```

---

### ❌ Delete Item
```bash
curl -X DELETE $API_URL/items/{id}
```

---

## 🧼 Clean Up

To delete the stack and avoid charges:

```bash
npx cdk destroy
```

---

## 🧠 Notes
- Data is stored **in-memory**, so it will reset on redeploy or Lambda cold start.
- Useful for **demoing APIs**, **local mocking**, or **learning CDK**.

---

Let me know if you want to add:
- Swagger/OpenAPI definition
- Local testing with `sam local` or `cdk synth && curl`
- Basic auth or API key support

Happy building! 🛠️🚀