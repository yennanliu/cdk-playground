"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const crypto_1 = require("crypto");
// Use require for pdf-parse to avoid TypeScript type issues
const pdfParse = require('pdf-parse');
// AWS clients
const bedrockClient = new client_bedrock_runtime_1.BedrockRuntimeClient({
    region: process.env.AWS_REGION || 'ap-northeast-1'
});
const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION || 'ap-northeast-1' });
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });
/**
 * Lambda handler for resume updating
 */
const handler = async (event) => {
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
        const request = JSON.parse(event.body);
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
        const prompt = buildPrompt(resumeText, request.jobDescription, request.options);
        console.log('Calling Bedrock with prompt length:', prompt.length);
        // Call Bedrock with regional inference profile
        const command = new client_bedrock_runtime_1.InvokeModelCommand({
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
        const updateId = (0, crypto_1.randomUUID)();
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
        }
        catch (error) {
            console.error('Failed to save history (non-fatal):', error);
        }
        // Prepare response
        const updateResponse = {
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
    }
    catch (error) {
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
exports.handler = handler;
/**
 * Fetch resume from S3
 */
async function getResumeFromS3(key) {
    const command = new client_s3_1.GetObjectCommand({
        Bucket: process.env.RESUME_BUCKET,
        Key: key
    });
    const response = await s3Client.send(command);
    if (!response.Body) {
        throw new Error('Failed to read file from S3');
    }
    // Convert stream to buffer
    const chunks = [];
    const stream = response.Body;
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    // Handle PDF files with proper parsing
    if (key.toLowerCase().endsWith('.pdf')) {
        try {
            console.log('Parsing PDF file...');
            const data = await pdfParse(buffer);
            console.log(`PDF parsed: ${data.numpages} pages, ${data.text.length} characters`);
            return data.text;
        }
        catch (error) {
            console.error('PDF parsing failed:', error);
            throw new Error('Failed to parse PDF file. Please ensure it is a valid PDF.');
        }
    }
    // Handle text files
    return buffer.toString('utf-8');
}
/**
 * Save update to DynamoDB history
 */
async function saveToHistory(data) {
    const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days TTL
    const command = new client_dynamodb_1.PutItemCommand({
        TableName: process.env.HISTORY_TABLE,
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
function buildPrompt(resume, jobDescription, options) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzdW1lVXBkYXRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInJlc3VtZVVwZGF0ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNEVBQTJGO0FBQzNGLGtEQUFnRTtBQUNoRSw4REFBMEU7QUFFMUUsbUNBQW9DO0FBRXBDLDREQUE0RDtBQUM1RCxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUM7QUFFdEMsY0FBYztBQUNkLE1BQU0sYUFBYSxHQUFHLElBQUksNkNBQW9CLENBQUM7SUFDN0MsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLGdCQUFnQjtDQUNuRCxDQUFDLENBQUM7QUFDSCxNQUFNLFFBQVEsR0FBRyxJQUFJLG9CQUFRLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksZ0JBQWdCLEVBQUUsQ0FBQyxDQUFDO0FBQ3RGLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxnQkFBZ0IsRUFBRSxDQUFDLENBQUM7QUFxQmhHOztHQUVHO0FBQ0ksTUFBTSxPQUFPLEdBQUcsS0FBSyxFQUFFLEtBQTJCLEVBQWtDLEVBQUU7SUFDM0YsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUUvRCxJQUFJLENBQUM7UUFDSCxxQkFBcUI7UUFDckIsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUNoQixPQUFPO2dCQUNMLFVBQVUsRUFBRSxHQUFHO2dCQUNmLE9BQU8sRUFBRSxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRTtnQkFDL0MsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUs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QixFQUFFLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUM1QyxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFTLFdBQVcsQ0FDbEIsTUFBYyxFQUNkLGNBQXNCLEVBQ3RCLE9BQWtDO0lBRWxDLE1BQU0sSUFBSSxHQUFHLE9BQU8sRUFBRSxJQUFJLElBQUksY0FBYyxDQUFDO0lBQzdDLE1BQU0sTUFBTSxHQUFHLE9BQU8sRUFBRSxNQUFNLElBQUksVUFBVSxDQUFDO0lBRTdDLE9BQU87Ozs7Ozs7Z0JBT08sSUFBSTs7OztlQUlMLE1BQU07Ozs7RUFJbkIsTUFBTTs7O0VBR04sY0FBYzs7c0tBRXNKLENBQUM7QUFDdkssQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEJlZHJvY2tSdW50aW1lQ2xpZW50LCBJbnZva2VNb2RlbENvbW1hbmQgfSBmcm9tIFwiQGF3cy1zZGsvY2xpZW50LWJlZHJvY2stcnVudGltZVwiO1xuaW1wb3J0IHsgUzNDbGllbnQsIEdldE9iamVjdENvbW1hbmQgfSBmcm9tIFwiQGF3cy1zZGsvY2xpZW50LXMzXCI7XG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCwgUHV0SXRlbUNvbW1hbmQgfSBmcm9tIFwiQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiXCI7XG5pbXBvcnQgeyBBUElHYXRld2F5UHJveHlFdmVudCwgQVBJR2F0ZXdheVByb3h5UmVzdWx0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnY3J5cHRvJztcblxuLy8gVXNlIHJlcXVpcmUgZm9yIHBkZi1wYXJzZSB0byBhdm9pZCBUeXBlU2NyaXB0IHR5cGUgaXNzdWVzXG5jb25zdCBwZGZQYXJzZSA9IHJlcXVpcmUoJ3BkZi1wYXJzZScpO1xuXG4vLyBBV1MgY2xpZW50c1xuY29uc3QgYmVkcm9ja0NsaWVudCA9IG5ldyBCZWRyb2NrUnVudGltZUNsaWVudCh7XG4gIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAnYXAtbm9ydGhlYXN0LTEnXG59KTtcbmNvbnN0IHMzQ2xpZW50ID0gbmV3IFMzQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICdhcC1ub3J0aGVhc3QtMScgfSk7XG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ2FwLW5vcnRoZWFzdC0xJyB9KTtcblxuaW50ZXJmYWNlIFVwZGF0ZVJlcXVlc3Qge1xuICByZXN1bWVUZXh0Pzogc3RyaW5nO1xuICByZXN1bWVTM0tleT86IHN0cmluZztcbiAgam9iRGVzY3JpcHRpb246IHN0cmluZztcbiAgb3B0aW9ucz86IHtcbiAgICB0b25lPzogJ3Byb2Zlc3Npb25hbCcgfCAnY2FzdWFsJyB8ICdleGVjdXRpdmUnO1xuICAgIGZvcm1hdD86ICdtYXJrZG93bicgfCAncGxhaW4nO1xuICB9O1xuICB1c2VySWQ/OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBVcGRhdGVSZXNwb25zZSB7XG4gIGlkOiBzdHJpbmc7XG4gIHVwZGF0ZWRSZXN1bWU6IHN0cmluZztcbiAgb3JpZ2luYWxMZW5ndGg6IG51bWJlcjtcbiAgdXBkYXRlZExlbmd0aDogbnVtYmVyO1xuICB0aW1lc3RhbXA6IHN0cmluZztcbn1cblxuLyoqXG4gKiBMYW1iZGEgaGFuZGxlciBmb3IgcmVzdW1lIHVwZGF0aW5nXG4gKi9cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiA9PiB7XG4gIGNvbnNvbGUubG9nKCdSZWNlaXZlZCBldmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xuXG4gIHRyeSB7XG4gICAgLy8gUGFyc2UgcmVxdWVzdCBib2R5XG4gICAgaWYgKCFldmVudC5ib2R5KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnUmVxdWVzdCBib2R5IGlzIHJlcXVpcmVkJyB9KVxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjb25zdCByZXF1ZXN0OiBVcGRhdGVSZXF1ZXN0ID0gSlNPTi5wYXJzZShldmVudC5ib2R5KTtcblxuICAgIC8vIFZhbGlkYXRlIGlucHV0XG4gICAgaWYgKCFyZXF1ZXN0LmpvYkRlc2NyaXB0aW9uKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnam9iRGVzY3JpcHRpb24gaXMgcmVxdWlyZWQnIH0pXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIEdldCByZXN1bWUgdGV4dCAtIGVpdGhlciBmcm9tIGRpcmVjdCBpbnB1dCBvciBTM1xuICAgIGxldCByZXN1bWVUZXh0ID0gcmVxdWVzdC5yZXN1bWVUZXh0O1xuXG4gICAgaWYgKHJlcXVlc3QucmVzdW1lUzNLZXkgJiYgIXJlc3VtZVRleHQpIHtcbiAgICAgIGNvbnNvbGUubG9nKCdGZXRjaGluZyByZXN1bWUgZnJvbSBTMzonLCByZXF1ZXN0LnJlc3VtZVMzS2V5KTtcbiAgICAgIHJlc3VtZVRleHQgPSBhd2FpdCBnZXRSZXN1bWVGcm9tUzMocmVxdWVzdC5yZXN1bWVTM0tleSk7XG4gICAgfVxuXG4gICAgaWYgKCFyZXN1bWVUZXh0KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgZXJyb3I6ICdFaXRoZXIgcmVzdW1lVGV4dCBvciByZXN1bWVTM0tleSBtdXN0IGJlIHByb3ZpZGVkJ1xuICAgICAgICB9KVxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBCdWlsZCBwcm9tcHQgZm9yIENsYXVkZVxuICAgIGNvbnN0IHByb21wdCA9IGJ1aWxkUHJvbXB0KFxuICAgICAgcmVzdW1lVGV4dCxcbiAgICAgIHJlcXVlc3Quam9iRGVzY3JpcHRpb24sXG4gICAgICByZXF1ZXN0Lm9wdGlvbnNcbiAgICApO1xuXG4gICAgY29uc29sZS5sb2coJ0NhbGxpbmcgQmVkcm9jayB3aXRoIHByb21wdCBsZW5ndGg6JywgcHJvbXB0Lmxlbmd0aCk7XG5cbiAgICAvLyBDYWxsIEJlZHJvY2sgd2l0aCByZWdpb25hbCBpbmZlcmVuY2UgcHJvZmlsZVxuICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlTW9kZWxDb21tYW5kKHtcbiAgICAgIG1vZGVsSWQ6IFwiYXBhYy5hbnRocm9waWMuY2xhdWRlLTMtNS1zb25uZXQtMjAyNDA2MjAtdjE6MFwiLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBhbnRocm9waWNfdmVyc2lvbjogXCJiZWRyb2NrLTIwMjMtMDUtMzFcIixcbiAgICAgICAgbWF4X3Rva2VuczogNDAwMCxcbiAgICAgICAgdGVtcGVyYXR1cmU6IDAuNyxcbiAgICAgICAgbWVzc2FnZXM6IFt7XG4gICAgICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICAgICAgY29udGVudDogcHJvbXB0XG4gICAgICAgIH1dXG4gICAgICB9KVxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBiZWRyb2NrQ2xpZW50LnNlbmQoY29tbWFuZCk7XG4gICAgY29uc3QgcmVzdWx0ID0gSlNPTi5wYXJzZShCdWZmZXIuZnJvbShyZXNwb25zZS5ib2R5KS50b1N0cmluZygpKTtcbiAgICBjb25zdCB1cGRhdGVkUmVzdW1lID0gcmVzdWx0LmNvbnRlbnRbMF0udGV4dDtcblxuICAgIGNvbnNvbGUubG9nKCdTdWNjZXNzZnVsbHkgdXBkYXRlZCByZXN1bWUnKTtcblxuICAgIC8vIEdlbmVyYXRlIHVuaXF1ZSBJRCBmb3IgdGhpcyB1cGRhdGVcbiAgICBjb25zdCB1cGRhdGVJZCA9IHJhbmRvbVVVSUQoKTtcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBEYXRlLm5vdygpO1xuXG4gICAgLy8gU2F2ZSB0byBEeW5hbW9EQiBoaXN0b3J5IChvcHRpb25hbCwgYmVzdCBlZmZvcnQpXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHNhdmVUb0hpc3Rvcnkoe1xuICAgICAgICBpZDogdXBkYXRlSWQsXG4gICAgICAgIHVzZXJJZDogcmVxdWVzdC51c2VySWQgfHwgJ2Fub255bW91cycsXG4gICAgICAgIHRpbWVzdGFtcCxcbiAgICAgICAgb3JpZ2luYWxMZW5ndGg6IHJlc3VtZVRleHQubGVuZ3RoLFxuICAgICAgICB1cGRhdGVkTGVuZ3RoOiB1cGRhdGVkUmVzdW1lLmxlbmd0aCxcbiAgICAgICAgczNLZXk6IHJlcXVlc3QucmVzdW1lUzNLZXlcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gc2F2ZSBoaXN0b3J5IChub24tZmF0YWwpOicsIGVycm9yKTtcbiAgICB9XG5cbiAgICAvLyBQcmVwYXJlIHJlc3BvbnNlXG4gICAgY29uc3QgdXBkYXRlUmVzcG9uc2U6IFVwZGF0ZVJlc3BvbnNlID0ge1xuICAgICAgaWQ6IHVwZGF0ZUlkLFxuICAgICAgdXBkYXRlZFJlc3VtZSxcbiAgICAgIG9yaWdpbmFsTGVuZ3RoOiByZXN1bWVUZXh0Lmxlbmd0aCxcbiAgICAgIHVwZGF0ZWRMZW5ndGg6IHVwZGF0ZWRSZXN1bWUubGVuZ3RoLFxuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSh0aW1lc3RhbXApLnRvSVNPU3RyaW5nKClcbiAgICB9O1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJ1xuICAgICAgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHVwZGF0ZVJlc3BvbnNlKVxuICAgIH07XG5cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBwcm9jZXNzaW5nIHJlcXVlc3Q6JywgZXJyb3IpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcbiAgICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBlcnJvcjogJ0ludGVybmFsIHNlcnZlciBlcnJvcicsXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InXG4gICAgICB9KVxuICAgIH07XG4gIH1cbn07XG5cbi8qKlxuICogRmV0Y2ggcmVzdW1lIGZyb20gUzNcbiAqL1xuYXN5bmMgZnVuY3Rpb24gZ2V0UmVzdW1lRnJvbVMzKGtleTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgY29tbWFuZCA9IG5ldyBHZXRPYmplY3RDb21tYW5kKHtcbiAgICBCdWNrZXQ6IHByb2Nlc3MuZW52LlJFU1VNRV9CVUNLRVQhLFxuICAgIEtleToga2V5XG4gIH0pO1xuXG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgczNDbGllbnQuc2VuZChjb21tYW5kKTtcblxuICBpZiAoIXJlc3BvbnNlLkJvZHkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byByZWFkIGZpbGUgZnJvbSBTMycpO1xuICB9XG5cbiAgLy8gQ29udmVydCBzdHJlYW0gdG8gYnVmZmVyXG4gIGNvbnN0IGNodW5rczogVWludDhBcnJheVtdID0gW107XG4gIGNvbnN0IHN0cmVhbSA9IHJlc3BvbnNlLkJvZHkgYXMgYW55O1xuXG4gIGZvciBhd2FpdCAoY29uc3QgY2h1bmsgb2Ygc3RyZWFtKSB7XG4gICAgY2h1bmtzLnB1c2goY2h1bmspO1xuICB9XG5cbiAgY29uc3QgYnVmZmVyID0gQnVmZmVyLmNvbmNhdChjaHVua3MpO1xuXG4gIC8vIEhhbmRsZSBQREYgZmlsZXMgd2l0aCBwcm9wZXIgcGFyc2luZ1xuICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkuZW5kc1dpdGgoJy5wZGYnKSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zb2xlLmxvZygnUGFyc2luZyBQREYgZmlsZS4uLicpO1xuICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHBkZlBhcnNlKGJ1ZmZlcik7XG4gICAgICBjb25zb2xlLmxvZyhgUERGIHBhcnNlZDogJHtkYXRhLm51bXBhZ2VzfSBwYWdlcywgJHtkYXRhLnRleHQubGVuZ3RofSBjaGFyYWN0ZXJzYCk7XG4gICAgICByZXR1cm4gZGF0YS50ZXh0O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdQREYgcGFyc2luZyBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gcGFyc2UgUERGIGZpbGUuIFBsZWFzZSBlbnN1cmUgaXQgaXMgYSB2YWxpZCBQREYuJyk7XG4gICAgfVxuICB9XG5cbiAgLy8gSGFuZGxlIHRleHQgZmlsZXNcbiAgcmV0dXJuIGJ1ZmZlci50b1N0cmluZygndXRmLTgnKTtcbn1cblxuLyoqXG4gKiBTYXZlIHVwZGF0ZSB0byBEeW5hbW9EQiBoaXN0b3J5XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHNhdmVUb0hpc3RvcnkoZGF0YToge1xuICBpZDogc3RyaW5nO1xuICB1c2VySWQ6IHN0cmluZztcbiAgdGltZXN0YW1wOiBudW1iZXI7XG4gIG9yaWdpbmFsTGVuZ3RoOiBudW1iZXI7XG4gIHVwZGF0ZWRMZW5ndGg6IG51bWJlcjtcbiAgczNLZXk/OiBzdHJpbmc7XG59KTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHR0bCA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKDMwICogMjQgKiA2MCAqIDYwKTsgLy8gMzAgZGF5cyBUVExcblxuICBjb25zdCBjb21tYW5kID0gbmV3IFB1dEl0ZW1Db21tYW5kKHtcbiAgICBUYWJsZU5hbWU6IHByb2Nlc3MuZW52LkhJU1RPUllfVEFCTEUhLFxuICAgIEl0ZW06IHtcbiAgICAgIGlkOiB7IFM6IGRhdGEuaWQgfSxcbiAgICAgIHRpbWVzdGFtcDogeyBOOiBkYXRhLnRpbWVzdGFtcC50b1N0cmluZygpIH0sXG4gICAgICB1c2VySWQ6IHsgUzogZGF0YS51c2VySWQgfSxcbiAgICAgIG9yaWdpbmFsTGVuZ3RoOiB7IE46IGRhdGEub3JpZ2luYWxMZW5ndGgudG9TdHJpbmcoKSB9LFxuICAgICAgdXBkYXRlZExlbmd0aDogeyBOOiBkYXRhLnVwZGF0ZWRMZW5ndGgudG9TdHJpbmcoKSB9LFxuICAgICAgczNLZXk6IHsgUzogZGF0YS5zM0tleSB8fCAnJyB9LFxuICAgICAgdHRsOiB7IE46IHR0bC50b1N0cmluZygpIH1cbiAgICB9XG4gIH0pO1xuXG4gIGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKGNvbW1hbmQpO1xuICBjb25zb2xlLmxvZygnU2F2ZWQgdG8gaGlzdG9yeTonLCBkYXRhLmlkKTtcbn1cblxuLyoqXG4gKiBCdWlsZCB0aGUgcHJvbXB0IGZvciBDbGF1ZGVcbiAqL1xuZnVuY3Rpb24gYnVpbGRQcm9tcHQoXG4gIHJlc3VtZTogc3RyaW5nLFxuICBqb2JEZXNjcmlwdGlvbjogc3RyaW5nLFxuICBvcHRpb25zPzogVXBkYXRlUmVxdWVzdFsnb3B0aW9ucyddXG4pOiBzdHJpbmcge1xuICBjb25zdCB0b25lID0gb3B0aW9ucz8udG9uZSB8fCAncHJvZmVzc2lvbmFsJztcbiAgY29uc3QgZm9ybWF0ID0gb3B0aW9ucz8uZm9ybWF0IHx8ICdtYXJrZG93bic7XG5cbiAgcmV0dXJuIGBZb3UgYXJlIGFuIGV4cGVydCByZXN1bWUgd3JpdGVyIGFuZCBjYXJlZXIgY29hY2guIFlvdXIgdGFzayBpcyB0byB1cGRhdGUgdGhlIHByb3ZpZGVkIHJlc3VtZSB0byBiZXR0ZXIgbWF0Y2ggdGhlIGpvYiBkZXNjcmlwdGlvbiB3aGlsZSBtYWludGFpbmluZyB0cnV0aGZ1bG5lc3MgYW5kIHRoZSBjYW5kaWRhdGUncyBhY3R1YWwgZXhwZXJpZW5jZS5cblxuSU5TVFJVQ1RJT05TOlxuMS4gQW5hbHl6ZSB0aGUgam9iIGRlc2NyaXB0aW9uIHRvIGlkZW50aWZ5IGtleSByZXF1aXJlbWVudHMsIHNraWxscywgYW5kIGtleXdvcmRzXG4yLiBVcGRhdGUgdGhlIHJlc3VtZSB0byBlbXBoYXNpemUgcmVsZXZhbnQgZXhwZXJpZW5jZSBhbmQgc2tpbGxzXG4zLiBSZXBocmFzZSBidWxsZXQgcG9pbnRzIHRvIGFsaWduIHdpdGggam9iIGRlc2NyaXB0aW9uIGxhbmd1YWdlICh1c2Ugc2ltaWxhciB0ZXJtaW5vbG9neSBhbmQga2V5d29yZHMpXG40LiBBZGQgcmVsZXZhbnQga2V5d29yZHMgbmF0dXJhbGx5IHdoZXJlIGFwcHJvcHJpYXRlIChubyBrZXl3b3JkIHN0dWZmaW5nKVxuNS4gTWFpbnRhaW4gYSAke3RvbmV9IHRvbmUgdGhyb3VnaG91dFxuNi4gS2VlcCBhbGwgaW5mb3JtYXRpb24gdHJ1dGhmdWwgLSBkbyBOT1QgZmFicmljYXRlIGV4cGVyaWVuY2Ugb3IgYWRkIHNraWxscyB0aGUgY2FuZGlkYXRlIGRvZXNuJ3QgaGF2ZVxuNy4gUHJlc2VydmUgdGhlIHJlc3VtZSBzdHJ1Y3R1cmUgKHNlY3Rpb25zLCBkYXRlcywgY29tcGFueSBuYW1lcywgZXRjLilcbjguIFVzZSBzdHJvbmcgYWN0aW9uIHZlcmJzIGFuZCBxdWFudGlmeSBhY2hpZXZlbWVudHMgd2hlcmUgdGhlIG9yaWdpbmFsIHJlc3VtZSBkb2VzXG45LiBPdXRwdXQgaW4gJHtmb3JtYXR9IGZvcm1hdFxuMTAuIEZvY3VzIG9uIG1ha2luZyBleGlzdGluZyBleHBlcmllbmNlIG1vcmUgcmVsZXZhbnQgdG8gdGhlIHRhcmdldCByb2xlXG5cbkNVUlJFTlQgUkVTVU1FOlxuJHtyZXN1bWV9XG5cblRBUkdFVCBKT0IgREVTQ1JJUFRJT046XG4ke2pvYkRlc2NyaXB0aW9ufVxuXG5QbGVhc2UgcHJvdmlkZSB0aGUgdXBkYXRlZCByZXN1bWUgbm93LiBNYWtlIHN1cmUgdG8ga2VlcCB0aGUgc2FtZSBzdHJ1Y3R1cmUgYW5kIHNlY3Rpb25zLCBidXQgb3B0aW1pemUgdGhlIHdvcmRpbmcgYW5kIGVtcGhhc2lzIHRvIGJldHRlciBtYXRjaCB0aGUgam9iIHJlcXVpcmVtZW50czpgO1xufVxuIl19