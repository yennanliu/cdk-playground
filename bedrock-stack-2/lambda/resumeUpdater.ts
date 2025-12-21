import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'crypto';

// AWS clients
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'ap-northeast-1'
});
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'ap-northeast-1' });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });

interface UpdateRequest {
  resumeText?: string;
  resumeS3Key?: string;
  jobDescription: string;
  options?: {
    tone?: 'professional' | 'casual' | 'executive';
    format?: 'markdown' | 'plain';
  };
  userId?: string;
}

interface UpdateResponse {
  id: string;
  updatedResume: string;
  originalLength: number;
  updatedLength: number;
  timestamp: string;
}

/**
 * Lambda handler for resume updating
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    // Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Request body is required' })
      };
    }

    const request: UpdateRequest = JSON.parse(event.body);

    // Validate input
    if (!request.jobDescription) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'jobDescription is required' })
      };
    }

    // Get resume text - either from direct input or S3
    let resumeText = request.resumeText;

    if (request.resumeS3Key && !resumeText) {
      console.log('Fetching resume from S3:', request.resumeS3Key);
      resumeText = await getResumeFromS3(request.resumeS3Key);
    }

    if (!resumeText) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Either resumeText or resumeS3Key must be provided'
        })
      };
    }

    // Build prompt for Claude
    const prompt = buildPrompt(
      resumeText,
      request.jobDescription,
      request.options
    );

    console.log('Calling Bedrock with prompt length:', prompt.length);

    // Call Bedrock with regional inference profile
    const command = new InvokeModelCommand({
      modelId: "apac.anthropic.claude-3-5-sonnet-20240620-v1:0",
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

    console.log('Successfully updated resume');

    // Generate unique ID for this update
    const updateId = randomUUID();
    const timestamp = Date.now();

    // Save to DynamoDB history (optional, best effort)
    try {
      await saveToHistory({
        id: updateId,
        userId: request.userId || 'anonymous',
        timestamp,
        originalLength: resumeText.length,
        updatedLength: updatedResume.length,
        s3Key: request.resumeS3Key
      });
    } catch (error) {
      console.error('Failed to save history (non-fatal):', error);
    }

    // Prepare response
    const updateResponse: UpdateResponse = {
      id: updateId,
      updatedResume,
      originalLength: resumeText.length,
      updatedLength: updatedResume.length,
      timestamp: new Date(timestamp).toISOString()
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(updateResponse)
    };

  } catch (error) {
    console.error('Error processing request:', error);

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

/**
 * Fetch resume from S3
 */
async function getResumeFromS3(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: process.env.RESUME_BUCKET!,
    Key: key
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error('Failed to read file from S3');
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  const stream = response.Body as any;

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);

  // Handle PDF files (simple text extraction)
  if (key.toLowerCase().endsWith('.pdf')) {
    // For now, return raw buffer as text
    // In production, use pdf-parse library for better extraction
    return buffer.toString('utf-8');
  }

  // Handle text files
  return buffer.toString('utf-8');
}

/**
 * Save update to DynamoDB history
 */
async function saveToHistory(data: {
  id: string;
  userId: string;
  timestamp: number;
  originalLength: number;
  updatedLength: number;
  s3Key?: string;
}): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days TTL

  const command = new PutItemCommand({
    TableName: process.env.HISTORY_TABLE!,
    Item: {
      id: { S: data.id },
      timestamp: { N: data.timestamp.toString() },
      userId: { S: data.userId },
      originalLength: { N: data.originalLength.toString() },
      updatedLength: { N: data.updatedLength.toString() },
      s3Key: { S: data.s3Key || '' },
      ttl: { N: ttl.toString() }
    }
  });

  await dynamoClient.send(command);
  console.log('Saved to history:', data.id);
}

/**
 * Build the prompt for Claude
 */
function buildPrompt(
  resume: string,
  jobDescription: string,
  options?: UpdateRequest['options']
): string {
  const tone = options?.tone || 'professional';
  const format = options?.format || 'markdown';

  return `You are an expert resume writer and career coach. Your task is to update the provided resume to better match the job description while maintaining truthfulness and the candidate's actual experience.

INSTRUCTIONS:
1. Analyze the job description to identify key requirements, skills, and keywords
2. Update the resume to emphasize relevant experience and skills
3. Rephrase bullet points to align with job description language (use similar terminology and keywords)
4. Add relevant keywords naturally where appropriate (no keyword stuffing)
5. Maintain a ${tone} tone throughout
6. Keep all information truthful - do NOT fabricate experience or add skills the candidate doesn't have
7. Preserve the resume structure (sections, dates, company names, etc.)
8. Use strong action verbs and quantify achievements where the original resume does
9. Output in ${format} format
10. Focus on making existing experience more relevant to the target role

CURRENT RESUME:
${resume}

TARGET JOB DESCRIPTION:
${jobDescription}

Please provide the updated resume now. Make sure to keep the same structure and sections, but optimize the wording and emphasis to better match the job requirements:`;
}
