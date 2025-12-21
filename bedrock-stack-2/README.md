# Resume Updater - AI-Powered Resume Optimization

An AWS CDK application that uses Amazon Bedrock (Claude) to optimize resumes for specific job descriptions.

## What It Does

Takes your resume and a job description, then uses AI to:
- Emphasize relevant experience and skills
- Align language with job requirements
- Add appropriate keywords naturally
- Maintain truthfulness (no fabrication)
- Preserve structure and formatting

## Cmd

```bash
# default
bash test-with-data.sh

# custom input
bash test-with-data.sh -r data/resume_1.txt -j data/jd_1.txt
```

## Architecture

**Architecture 2: With File Upload (Production-Ready)**

```
Client → API Gateway → Lambda (parse) → S3 (optional) → Lambda (process) → Bedrock → Response
                                                                         ↓
                                                                    DynamoDB (history)
```

**Components:**
- S3 bucket for file uploads with CORS support
- Lambda for generating presigned upload URLs
- Lambda for document processing with Bedrock integration
- DynamoDB for storing update history (30-day TTL)
- API Gateway REST API with binary support
- IAM roles with Bedrock, S3, and DynamoDB permissions

**Features:**
- Direct text input or file upload (PDF/TXT)
- Real PDF parsing with pdf-parse library
- Automatic cleanup (S3: 7 days, DynamoDB: 30 days)
- Update history tracking
- Presigned URL for secure uploads
- No Docker required for deployment

## Prerequisites

1. **AWS Region**
   - Deploy to **ap-northeast-1** (Tokyo) - default region for this stack
   - Alternative: us-east-1, us-west-2
   - Set your region: `export AWS_REGION=ap-northeast-1`

2. **Enable Bedrock Model Access**
   - Go to AWS Bedrock Console → ap-northeast-1 region
   - Navigate to Model access
   - Enable "Claude 3.5 Sonnet" model
   - Wait for approval (usually instant)

3. **Install Dependencies**
   ```bash
   npm install
   ```

## Deployment

```bash
# Option 1: One-command deploy (recommended)
npm run deploy

# Option 2: Manual steps
npm run build:all  # Builds Lambda and CDK
cdk deploy

# Note the outputs:
# - ApiUrl: API Gateway endpoint
# - BucketName: S3 bucket for file uploads
# - TableName: DynamoDB table for history
```

**Note**: Lambda JavaScript files are compiled from TypeScript and committed to the repo for deployment. No Docker needed!

## Testing

### Automated Test with Data Files (Recommended)

Test with real resume and job description files. Results are automatically saved to `output/` directory:

```bash
# Use default data files (data/resume_1.txt, data/jd_1.txt)
./test-with-data.sh

# Use custom files
./test-with-data.sh -r my_resume.txt -j my_job.txt

# Use custom API URL
./test-with-data.sh -a https://custom-api-url/prod/

# Show help
./test-with-data.sh --help
```

**Output:** Results saved to `output/resume_updated_YYYYMMDD_HHMMSS.txt`

### Quick Test

Use the simple test script for direct text input:

```bash
./test-resume-updater.sh https://xxihxfmkka.execute-api.ap-northeast-1.amazonaws.com/prod/
```

### File Upload Test

Test the complete file upload flow:

```bash
# With default data files
./test-file-upload.sh https://xxihxfmkka.execute-api.ap-northeast-1.amazonaws.com/prod/

# With custom files
./test-file-upload.sh https://your-api-url/prod/ path/to/resume.txt path/to/job.txt
```

This script performs the 3-step upload process automatically:
1. Gets presigned S3 upload URL
2. Uploads resume file to S3
3. Processes resume with AI and saves result

### Manual cURL Test

```bash
curl -X POST https://xxihxfmkka.execute-api.ap-northeast-1.amazonaws.com/prod/update \
  -H "Content-Type: application/json" \
  -d '{
    "resumeText": "John Doe\nSoftware Engineer\n\nExperience:\n- Built web apps with JavaScript",
    "jobDescription": "Looking for Full Stack Developer with React and Node.js experience"
  }'
```

**Expected Response:**
```json
{
  "updatedResume": "...optimized resume text...",
  "originalLength": 85,
  "updatedLength": 250,
  "timestamp": "2025-12-21T10:30:00.000Z"
}
```

## Usage

### Basic Example

```bash
curl -X POST https://YOUR-API-URL/update \
  -H "Content-Type: application/json" \
  -d '{
    "resumeText": "John Doe\nSoftware Engineer\n\nExperience:\n- Built web applications using JavaScript\n- Worked with databases and APIs\n\nSkills: JavaScript, SQL, REST APIs",
    "jobDescription": "We are seeking a Full Stack Developer with strong React and Node.js experience to build modern web applications. Must have experience with RESTful APIs, databases, and cloud platforms."
  }'
```

### With Options

```bash
curl -X POST https://YOUR-API-URL/update \
  -H "Content-Type: application/json" \
  -d '{
    "resumeText": "Your resume here...",
    "jobDescription": "Job description here...",
    "options": {
      "tone": "professional",
      "format": "markdown"
    }
  }'
```

**Options:**
- `tone`: `"professional"` (default), `"casual"`, or `"executive"`
- `format`: `"markdown"` (default) or `"plain"`

### File Upload (3-step process)

```bash
# Step 1: Get presigned upload URL
UPLOAD_RESPONSE=$(curl -X POST https://YOUR-API-URL/upload \
  -H "Content-Type: application/json" \
  -d '{"fileName": "resume.txt"}')

echo $UPLOAD_RESPONSE
# {"uploadUrl":"https://s3...","key":"uploads/1234567890-resume.txt","expiresIn":300}

# Step 2: Upload file to S3 using presigned URL
UPLOAD_URL=$(echo $UPLOAD_RESPONSE | jq -r '.uploadUrl')
S3_KEY=$(echo $UPLOAD_RESPONSE | jq -r '.key')

curl -X PUT "$UPLOAD_URL" \
  --upload-file data/resume_1.txt \
  -H "Content-Type: text/plain"

# Step 3: Process the uploaded resume
curl -X POST https://YOUR-API-URL/update \
  -H "Content-Type: application/json" \
  -d "{
    \"resumeS3Key\": \"$S3_KEY\",
    \"jobDescription\": \"Looking for Full Stack Developer with React and Node.js experience...\"
  }"
```

### Response Format

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "updatedResume": "Optimized resume text...",
  "originalLength": 250,
  "updatedLength": 380,
  "timestamp": "2025-12-21T10:30:00.000Z"
}
```

## Cost Estimation

**Per Resume Update**:
- Bedrock (Claude Sonnet): ~$0.047
- Lambda execution: ~$0.00002
- API Gateway: ~$0.0000035
- S3 storage (7-day retention): ~$0.000023
- DynamoDB write: ~$0.0000125
- **Total**: ~**$0.05 per update**

**Monthly Costs** (100 updates):
- Bedrock: $4.70
- Lambda: $0.002
- API Gateway: $0.35
- S3: $1.00
- DynamoDB: $1.25
- **Total**: ~**$7.30/month**

## Development Commands

* `npm run deploy`       - Build everything and deploy (recommended)
* `npm run build:all`    - Build Lambda and CDK
* `npm run build:lambda` - Build Lambda functions only
* `npm run build`        - Compile CDK TypeScript
* `npm run watch`        - Watch mode for CDK
* `npm run test`         - Run tests
* `npm run clean`        - Remove compiled CDK files
* `npm run clean:lambda` - Remove compiled Lambda files
* `npm run clean:all`    - Clean everything + remove node_modules/cdk.out/output
* `cdk deploy`           - Deploy stack
* `cdk diff`             - Show changes
* `cdk synth`            - Generate CloudFormation
* `cdk destroy`          - Remove stack

## Project Structure

```
bedrock-stack-2/
├── lib/
│   └── bedrock-stack-2-stack.ts           # CDK infrastructure (S3, DynamoDB, Lambda, API Gateway)
├── lambda/
│   ├── resumeUpdater.ts                   # Main Lambda for resume processing
│   ├── upload.ts                          # Lambda for presigned URL generation
│   ├── package.json                       # Lambda dependencies
│   └── tsconfig.json                      # TypeScript config for Lambda
├── data/
│   ├── resume_1.txt                       # Sample resume
│   └── jd_1.txt                           # Sample job description
├── doc/
│   ├── bedrock-ai-app-examples-claude.md  # Bedrock guides
│   └── resume-updater-evaluation-claude.md # Architecture design doc
├── test-resume-updater.sh                 # Simple text input test
├── test-with-data.sh                      # Automated test with data files
├── test-file-upload.sh                    # File upload flow test
└── README.md
```

## Next Steps

See `doc/resume-updater-evaluation-claude.md` for:
- Adding file upload (PDF/DOCX support)
- Match score calculation
- ATS optimization
- Web UI development
- Production enhancements
