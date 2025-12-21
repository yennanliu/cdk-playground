# Resume Updater AI - Project Evaluation

## Project Overview

**Goal**: Build an AI-powered resume updater that takes a resume and job description as input, then outputs an optimized resume tailored to that specific job.

**Input**:
- User's existing resume (PDF/DOCX/Text)
- Target job description (text)

**Output**:
- Updated resume optimized for the job description
- Highlighted changes (optional)
- Match score (optional)

---

## Feasibility Assessment: ✅ HIGHLY FEASIBLE

This is an **IDEAL** use case for AWS Bedrock, specifically Claude models. Here's why:

### Strengths
- **Perfect match for Claude's capabilities**: Document understanding, professional writing, instruction following
- **Simple architecture**: No complex RAG, no vector databases needed
- **Single-turn interaction**: One request → one response (no conversation state)
- **Long context handling**: Claude can handle full resumes + JDs (up to 200K tokens)
- **Structured output**: Can format in Markdown, plain text, or JSON

### Challenges (Minor)
- **Document parsing**: Need to extract text from PDF/DOCX (solvable with Textract or libraries)
- **Formatting preservation**: May need post-processing to maintain resume format
- **File size limits**: Lambda has 6MB payload limit for API Gateway (can use S3 for larger files)

### Verdict: **8.5/10** - Very practical and straightforward to build

---

## Effort Estimation

### Option 1: Minimal MVP (Text Input Only)
**Timeline**: 2-3 days
- Lambda function with Bedrock integration: 4 hours
- API Gateway setup: 2 hours
- CDK infrastructure: 3 hours
- Testing and prompt refinement: 8 hours
- **Total**: ~17 hours

### Option 2: With File Upload (PDF/DOCX Support)
**Timeline**: 4-5 days
- Everything from MVP: 17 hours
- S3 integration for file uploads: 3 hours
- Document parsing (Textract or pdf-parse): 4 hours
- File handling logic: 3 hours
- Additional testing: 5 hours
- **Total**: ~32 hours

### Option 3: Production-Ready with UI
**Timeline**: 7-10 days
- Backend from Option 2: 32 hours
- React/Next.js frontend: 12 hours
- Authentication (Cognito): 4 hours
- User history (DynamoDB): 4 hours
- S3 hosting + CloudFront: 2 hours
- End-to-end testing: 6 hours
- **Total**: ~60 hours

---

## Architecture Options

### Architecture 1: Minimal API (Simplest)

```
Client → API Gateway → Lambda → Bedrock Claude → Response
```

**Components**:
- API Gateway (REST API)
- Lambda function (Node.js/Python)
- Bedrock Claude Sonnet

**Pros**:
- Fastest to build (1-2 days)
- Lowest cost
- Easy to test

**Cons**:
- Text input only
- No file storage
- No user history

**Cost**: ~$0.10-0.50 per resume update

---

### Architecture 2: With File Upload (Recommended)

```
Client → API Gateway → Lambda (parse) → S3 (optional) → Lambda (process) → Bedrock → Response
                                                                           ↓
                                                                        DynamoDB (history)
```

**Components**:
- API Gateway (with binary support)
- S3 bucket for file uploads
- Lambda for document parsing
- Lambda for Bedrock processing
- DynamoDB for storing results
- Bedrock Claude Sonnet

**Pros**:
- Accepts PDF/DOCX files
- Stores history for users
- Production-ready
- Scalable

**Cons**:
- More complex
- Slightly higher cost

**Cost**: ~$0.15-0.60 per resume update + storage

---

### Architecture 3: Full Web Application

```
CloudFront → S3 (React App) → API Gateway → Lambda → Bedrock
                                    ↓              ↓
                                Cognito      DynamoDB (user data)
                                    ↓
                              S3 (documents)
```

**Components**:
- CloudFront + S3 for static hosting
- Cognito for authentication
- API Gateway
- Lambda functions
- DynamoDB for user data
- S3 for document storage
- Bedrock Claude

**Pros**:
- Complete user experience
- User accounts and history
- Professional UI
- Multi-device support

**Cons**:
- Longest development time
- Higher operational complexity

**Cost**: ~$0.20-0.70 per resume + hosting (~$5-10/month)

---

## Recommended Tech Stack

### Backend
```typescript
// Core dependencies
{
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "^3.x",
    "@aws-sdk/client-s3": "^3.x",
    "@aws-sdk/client-textract": "^3.x",      // For PDF parsing
    "@aws-sdk/client-dynamodb": "^3.x",
    "pdf-parse": "^1.1.1",                   // Alternative PDF parser
    "mammoth": "^1.6.0",                     // For DOCX parsing
    "marked": "^9.1.0"                       // For markdown formatting
  }
}
```

### Infrastructure
```typescript
// CDK dependencies
{
  "dependencies": {
    "aws-cdk-lib": "^2.x",
    "constructs": "^10.x"
  }
}
```

### Frontend (Optional)
```typescript
// React + TypeScript
{
  "dependencies": {
    "react": "^18.x",
    "axios": "^1.x",
    "react-dropzone": "^14.x",              // File upload
    "react-diff-viewer": "^3.x"             // Show changes
  }
}
```

---

## Implementation Details

### Step 1: Lambda Function (Core Logic)

```typescript
// lambda/resumeUpdater.ts
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import pdf from 'pdf-parse';

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const s3Client = new S3Client({ region: process.env.AWS_REGION });

interface UpdateRequest {
  resumeText?: string;      // Direct text input
  resumeS3Key?: string;     // Or S3 file reference
  jobDescription: string;
  options?: {
    tone?: 'professional' | 'casual' | 'executive';
    highlights?: boolean;   // Show what changed
    format?: 'markdown' | 'plain' | 'json';
  };
}

export const handler = async (event: any) => {
  const request: UpdateRequest = JSON.parse(event.body);

  // 1. Get resume text
  let resumeText = request.resumeText;
  if (request.resumeS3Key && !resumeText) {
    resumeText = await getResumeFromS3(request.resumeS3Key);
  }

  if (!resumeText) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No resume provided' }) };
  }

  // 2. Build prompt for Claude
  const prompt = buildPrompt(resumeText, request.jobDescription, request.options);

  // 3. Call Bedrock
  const command = new InvokeModelCommand({
    modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 4000,
      temperature: 0.7,
      messages: [{
        role: "user",
        content: prompt
      }]
    })
  });

  const response = await bedrockClient.send(command);
  const result = JSON.parse(Buffer.from(response.body).toString());
  const updatedResume = result.content[0].text;

  // 4. Return response
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      updatedResume,
      originalLength: resumeText.length,
      updatedLength: updatedResume.length,
      timestamp: new Date().toISOString()
    })
  };
};

async function getResumeFromS3(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: process.env.RESUME_BUCKET!,
    Key: key
  });

  const response = await s3Client.send(command);
  const buffer = await response.Body?.transformToByteArray();

  if (!buffer) throw new Error('Failed to read file from S3');

  // Handle PDF parsing
  if (key.endsWith('.pdf')) {
    const data = await pdf(Buffer.from(buffer));
    return data.text;
  }

  // Plain text
  return Buffer.from(buffer).toString('utf-8');
}

function buildPrompt(resume: string, jobDescription: string, options?: any): string {
  const tone = options?.tone || 'professional';
  const format = options?.format || 'markdown';

  return `You are an expert resume writer and career coach. Your task is to update the provided resume to better match the job description while maintaining truthfulness and the candidate's actual experience.

INSTRUCTIONS:
1. Analyze the job description to identify key requirements, skills, and keywords
2. Update the resume to emphasize relevant experience and skills
3. Rephrase bullet points to align with job description language
4. Add relevant keywords naturally (no keyword stuffing)
5. Maintain a ${tone} tone throughout
6. Keep all information truthful - do NOT fabricate experience
7. Preserve the resume structure (sections, dates, etc.)
8. Output in ${format} format

CURRENT RESUME:
${resume}

JOB DESCRIPTION:
${jobDescription}

Please provide the updated resume now:`;
}
```

---

### Step 2: CDK Stack

```typescript
// lib/resume-updater-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class ResumeUpdaterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for resume uploads
    const resumeBucket = new s3.Bucket(this, 'ResumeBucket', {
      cors: [{
        allowedOrigins: ['*'],
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
        allowedHeaders: ['*']
      }],
      lifecycleRules: [{
        expiration: cdk.Duration.days(7), // Clean up old resumes
      }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    // DynamoDB for storing results (optional)
    const resultsTable = new dynamodb.Table(this, 'ResultsTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Lambda function
    const resumeUpdaterLambda = new lambda.Function(this, 'ResumeUpdaterFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'resumeUpdater.handler',
      code: lambda.Code.fromAsset('lambda', {
        bundling: {
          image: lambda.Runtime.NODEJS_20_X.bundlingImage,
          command: [
            'bash', '-c',
            'npm install && cp -r /asset-input/* /asset-output/'
          ]
        }
      }),
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      environment: {
        RESUME_BUCKET: resumeBucket.bucketName,
        RESULTS_TABLE: resultsTable.tableName,
        AWS_REGION: this.region
      }
    });

    // Grant permissions
    resumeUpdaterLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['arn:aws:bedrock:*::foundation-model/anthropic.claude-*']
    }));

    resumeBucket.grantRead(resumeUpdaterLambda);
    resultsTable.grantWriteData(resumeUpdaterLambda);

    // API Gateway
    const api = new apigateway.RestApi(this, 'ResumeUpdaterAPI', {
      restApiName: 'Resume Updater Service',
      description: 'API for AI-powered resume updates',
      binaryMediaTypes: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS
      }
    });

    const updateResource = api.root.addResource('update');
    updateResource.addMethod('POST', new apigateway.LambdaIntegration(resumeUpdaterLambda));

    // Lambda for file upload (generates presigned URLs)
    const uploadLambda = new lambda.Function(this, 'UploadFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
        const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

        exports.handler = async (event) => {
          const s3Client = new S3Client({ region: process.env.AWS_REGION });
          const fileName = JSON.parse(event.body).fileName;
          const key = \`uploads/\${Date.now()}-\${fileName}\`;

          const command = new PutObjectCommand({
            Bucket: process.env.RESUME_BUCKET,
            Key: key,
            ContentType: 'application/pdf'
          });

          const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

          return {
            statusCode: 200,
            body: JSON.stringify({ uploadUrl, key })
          };
        };
      `),
      environment: {
        RESUME_BUCKET: resumeBucket.bucketName
      }
    });

    resumeBucket.grantPut(uploadLambda);

    const uploadResource = api.root.addResource('upload');
    uploadResource.addMethod('POST', new apigateway.LambdaIntegration(uploadLambda));

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Resume Updater API URL'
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: resumeBucket.bucketName,
      description: 'S3 Bucket for resumes'
    });
  }
}
```

---

### Step 3: Testing with cURL

```bash
# Test 1: Direct text input
curl -X POST https://your-api-url/update \
  -H "Content-Type: application/json" \
  -d '{
    "resumeText": "John Doe\nSoftware Engineer\n\nExperience:\n- Built web applications using React\n- Worked with REST APIs",
    "jobDescription": "We are looking for a Full Stack Developer with React and Node.js experience to build scalable web applications.",
    "options": {
      "tone": "professional",
      "format": "markdown"
    }
  }'

# Test 2: With file upload
# Step 2a: Get presigned URL
curl -X POST https://your-api-url/upload \
  -H "Content-Type: application/json" \
  -d '{"fileName": "resume.pdf"}'

# Step 2b: Upload file to S3
curl -X PUT "presigned-url-from-above" \
  --upload-file resume.pdf

# Step 2c: Process the uploaded resume
curl -X POST https://your-api-url/update \
  -H "Content-Type: application/json" \
  -d '{
    "resumeS3Key": "uploads/1234567890-resume.pdf",
    "jobDescription": "Job description here..."
  }'
```

---

## Advanced Features (Optional)

### 1. ATS (Applicant Tracking System) Optimization

Add to prompt:
```typescript
const atsPrompt = `
Additionally, optimize the resume for ATS systems:
- Use standard section headings (Experience, Education, Skills)
- Avoid tables, images, or complex formatting
- Include exact keyword matches from job description
- Use standard date formats (MM/YYYY)
`;
```

### 2. Match Score Calculation

```typescript
// Add second Bedrock call for analysis
const scorePrompt = `Analyze how well this resume matches the job description.
Provide a match score (0-100) and key strengths/gaps.

Resume: ${updatedResume}
Job Description: ${jobDescription}

Output JSON format:
{
  "matchScore": 85,
  "strengths": ["React experience", "Leadership skills"],
  "gaps": ["No AWS experience mentioned"],
  "recommendations": ["Add cloud certifications section"]
}`;
```

### 3. Multiple Resume Versions

Generate different versions:
- **Conservative**: Minimal changes, stays close to original
- **Optimized**: Significant rewording for best match
- **Aggressive**: Maximum keyword optimization

### 4. Cover Letter Generation

Add another endpoint:
```typescript
POST /generate-cover-letter
{
  "resumeText": "...",
  "jobDescription": "...",
  "companyName": "Google",
  "style": "enthusiastic" | "formal" | "storytelling"
}
```

---

## Cost Analysis

### Per Resume Update (Estimated)

**Using Claude Sonnet**:
- Input: ~2,000 tokens (resume) + ~1,000 tokens (JD) = 3,000 tokens
- Output: ~2,500 tokens (updated resume)
- Cost: (3,000 × $0.000003) + (2,500 × $0.000015) = **$0.047 per update**

**Other AWS costs** (per update):
- Lambda execution: $0.0000002 (512MB, 10s) ≈ $0.00002
- API Gateway: $0.0000035
- S3 storage: $0.000023 per GB/month
- DynamoDB: $0.0000125 per write

**Total**: ~**$0.05 per resume update**

**Monthly costs** (100 updates):
- Bedrock: $4.70
- Lambda: $0.002
- API Gateway: $0.35
- S3: $1.00
- DynamoDB: $1.25
- **Total**: ~**$7.30/month**

---

## Risk Assessment

### Technical Risks: LOW
- **API limits**: Bedrock has generous quotas, easy to request increases
- **Lambda timeout**: 60 seconds is enough for most resumes
- **File size**: Most resumes are <1MB, well within limits

### Business Risks: MEDIUM
- **Quality consistency**: AI output quality varies - needs good prompts
- **User expectations**: Users may expect perfect results
- **Privacy concerns**: Handling sensitive resume data (use encryption)

### Mitigation:
- Implement retry logic for Bedrock timeouts
- Add human review option for critical applications
- Clear privacy policy, data retention (7 days recommended)
- Add disclaimer about AI-generated content

---

## Competitive Analysis

### Similar Products:
1. **Jobscan**: Resume optimization with ATS scoring ($49-90/month)
2. **Resume Worded**: AI feedback and rewriting ($19-49/month)
3. **Teal**: Resume builder with AI ($29-79/month)

### Your Advantage:
- **Lower cost**: Can charge $5-15/month competitively
- **Customization**: Full control over prompts and features
- **Privacy**: Self-hosted, no third-party data sharing
- **Integration**: Can integrate with LinkedIn, job boards

---

## Development Roadmap

### Phase 1: MVP (Week 1-2)
- [ ] Set up CDK stack with Lambda + Bedrock
- [ ] Implement core resume update logic
- [ ] Text input API endpoint
- [ ] Basic testing and prompt refinement
- [ ] Deploy to staging

### Phase 2: File Upload (Week 3)
- [ ] Add S3 integration
- [ ] Implement PDF parsing (Textract or pdf-parse)
- [ ] DOCX support (mammoth)
- [ ] Presigned URL upload flow
- [ ] Error handling improvements

### Phase 3: Enhanced Features (Week 4)
- [ ] Match score calculation
- [ ] ATS optimization mode
- [ ] Multiple resume versions
- [ ] History storage in DynamoDB
- [ ] Rate limiting

### Phase 4: UI (Week 5-6)
- [ ] React frontend with drag-and-drop upload
- [ ] Side-by-side comparison view
- [ ] Cognito authentication
- [ ] User dashboard with history
- [ ] Deploy frontend to S3 + CloudFront

### Phase 5: Polish (Week 7-8)
- [ ] Advanced prompt engineering
- [ ] Cover letter generation
- [ ] Email integration
- [ ] Export to PDF with formatting
- [ ] Analytics dashboard
- [ ] Production deployment

---

## Recommended Next Steps

### To Get Started:

1. **Enable Bedrock Access** (5 minutes)
   - Go to AWS Bedrock console
   - Enable Claude Sonnet model
   - Verify access in your region

2. **Clone and Modify Current Stack** (1 hour)
   ```bash
   cd bedrock-stack-1
   # Update lib/bedrock-stack-1-stack.ts with resume updater code
   npm install
   cdk synth
   ```

3. **Create Lambda Function** (2 hours)
   ```bash
   mkdir lambda
   cd lambda
   npm init -y
   npm install @aws-sdk/client-bedrock-runtime pdf-parse
   # Create resumeUpdater.ts
   ```

4. **Deploy and Test** (1 hour)
   ```bash
   npm run build
   cdk deploy
   # Test with cURL
   ```

5. **Iterate on Prompt** (ongoing)
   - Test with various resumes and JDs
   - Refine prompt for better results
   - Add guardrails and validation

---

## Final Recommendation

**Should you build this? YES! ✅**

**Why:**
- **Quick to build**: MVP in 2-3 days
- **Low cost**: ~$0.05 per resume update
- **Real value**: Solves a common pain point
- **Good learning project**: Covers core AWS + AI patterns
- **Monetization potential**: $5-15/month subscription feasible
- **Scalable**: Architecture handles 1-10,000+ users

**Best approach**: Start with **Architecture 2** (with file upload)
- Production-ready
- Not overly complex
- Allows for future enhancements
- Good balance of features and development time

**Estimated total effort**: 4-5 days for a solid MVP with file upload support.

---

## Sample Output

**Original Resume Bullet**:
> "Developed web applications using JavaScript frameworks"

**After AI Optimization for React Developer role**:
> "Architected and delivered scalable web applications using React, implementing component-based architecture and state management solutions that improved user engagement by streamlining interactive features"

The AI naturally:
- Added specific framework mentioned in JD (React)
- Used stronger action verbs (Architected, delivered)
- Added concrete outcomes and technical depth
- Maintained truthfulness while optimizing presentation

---

**Ready to build? This is a great project to start with!**
