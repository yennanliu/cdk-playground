# Resume Updater - AI-Powered Resume Optimization

An AWS CDK application that uses Amazon Bedrock (Claude) to optimize resumes for specific job descriptions.

## What It Does

Takes your resume and a job description, then uses AI to:
- Emphasize relevant experience and skills
- Align language with job requirements
- Add appropriate keywords naturally
- Maintain truthfulness (no fabrication)
- Preserve structure and formatting

## Architecture

```
Client → API Gateway → Lambda → Amazon Bedrock (Claude Sonnet) → Updated Resume
```

**Components:**
- Lambda function with Bedrock integration
- API Gateway REST API endpoint
- IAM roles with Bedrock permissions

## Prerequisites

1. **AWS Region**
   - Deploy to **us-east-1** (recommended - best model availability)
   - Alternative: us-west-2, ap-northeast-1 (Tokyo)
   - Set your region: `export AWS_REGION=us-east-1`

2. **Enable Bedrock Model Access**
   - Go to AWS Bedrock Console (in your target region)
   - Navigate to Model access
   - Enable "Claude 3 Sonnet" model
   - Wait for approval (usually instant)

3. **Install Dependencies**
   ```bash
   npm install
   ```

## Deployment

```bash
# Build and deploy
npm run build
cdk deploy

# Note the API URL from output
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

### Response Format

```json
{
  "updatedResume": "Optimized resume text...",
  "originalLength": 250,
  "updatedLength": 380,
  "timestamp": "2025-12-21T10:30:00.000Z"
}
```

## Cost Estimation

- **Per update**: ~$0.05 (Bedrock + Lambda + API Gateway)
- **100 updates/month**: ~$7.30/month

## Development Commands

* `npm run build`     - Compile TypeScript
* `npm run watch`     - Watch mode
* `npm run test`      - Run tests
* `npm run clean`     - Remove compiled .js/.d.ts files
* `npm run clean:all` - Clean + remove node_modules/cdk.out
* `cdk deploy`        - Deploy stack
* `cdk diff`          - Show changes
* `cdk synth`         - Generate CloudFormation
* `cdk destroy`       - Remove stack

## Project Structure

```
bedrock-stack-1/
├── lib/
│   └── bedrock-stack-1-stack.ts    # CDK infrastructure
├── lambda/
│   └── resumeUpdater.ts            # Lambda function
├── doc/
│   ├── bedrock-ai-app-examples-claude.md       # Bedrock guides
│   └── resume-updater-evaluation-claude.md     # Design doc
└── README.md
```

## Next Steps

See `doc/resume-updater-evaluation-claude.md` for:
- Adding file upload (PDF/DOCX support)
- Match score calculation
- ATS optimization
- Web UI development
- Production enhancements
