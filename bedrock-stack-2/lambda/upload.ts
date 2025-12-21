import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'ap-northeast-1' });

interface UploadRequest {
  fileName: string;
  contentType?: string;
}

interface UploadResponse {
  uploadUrl: string;
  key: string;
  expiresIn: number;
}

/**
 * Lambda handler for generating presigned S3 upload URLs
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Received upload request:', JSON.stringify(event, null, 2));

  try {
    // Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Request body is required' })
      };
    }

    const request: UploadRequest = JSON.parse(event.body);

    // Validate input
    if (!request.fileName) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'fileName is required' })
      };
    }

    // Sanitize file name and generate S3 key
    const timestamp = Date.now();
    const sanitizedFileName = request.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `uploads/${timestamp}-${sanitizedFileName}`;

    // Determine content type
    const contentType = request.contentType || getContentType(request.fileName);

    // Generate presigned URL for upload (valid for 5 minutes)
    const command = new PutObjectCommand({
      Bucket: process.env.RESUME_BUCKET!,
      Key: key,
      ContentType: contentType
    });

    const expiresIn = 300; // 5 minutes
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });

    console.log('Generated presigned URL for key:', key);

    const response: UploadResponse = {
      uploadUrl,
      key,
      expiresIn
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Error generating presigned URL:', error);

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to generate upload URL',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

/**
 * Determine content type from file extension
 */
function getContentType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop();

  const contentTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/msword',
    'txt': 'text/plain'
  };

  return contentTypes[ext || ''] || 'application/octet-stream';
}
