import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

interface UpdateRequest {
  resumeText: string;
  jobDescription: string;
  options?: {
    tone?: 'professional' | 'casual' | 'executive';
    format?: 'markdown' | 'plain';
  };
}

interface UpdateResponse {
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
    if (!request.resumeText || !request.jobDescription) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Both resumeText and jobDescription are required'
        })
      };
    }

    // Build prompt for Claude
    const prompt = buildPrompt(
      request.resumeText,
      request.jobDescription,
      request.options
    );

    console.log('Calling Bedrock with prompt length:', prompt.length);

    // Call Bedrock
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

    console.log('Successfully updated resume');

    // Prepare response
    const updateResponse: UpdateResponse = {
      updatedResume,
      originalLength: request.resumeText.length,
      updatedLength: updatedResume.length,
      timestamp: new Date().toISOString()
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
