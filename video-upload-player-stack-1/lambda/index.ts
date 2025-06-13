import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';
import { S3 } from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';

const dynamoDB = new DynamoDB.DocumentClient();
const s3 = new S3();

const VIDEO_TABLE_NAME = process.env.VIDEO_TABLE_NAME!;
const VIDEO_BUCKET_NAME = process.env.VIDEO_BUCKET_NAME!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const path = event.path;
    const httpMethod = event.httpMethod;

    // Handle different API endpoints
    if (path === '/upload-url' && httpMethod === 'GET') {
      return await handleGetUploadUrl(event);
    } else if (path === '/videos' && httpMethod === 'GET') {
      return await handleListVideos(event);
    } else if (path.match(/\/videos\/[^/]+$/) && httpMethod === 'GET') {
      return await handleGetVideo(event);
    }

    return {
      statusCode: 404,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({ message: 'Not Found' }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};

async function handleGetUploadUrl(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = event.queryStringParameters?.userId || 'anonymous';
  const fileName = event.queryStringParameters?.fileName;
  
  if (!fileName) {
    return {
      statusCode: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({ message: 'fileName is required' }),
    };
  }

  const videoId = uuidv4();
  const s3Key = `videos/${userId}/${videoId}/${fileName}`;

  const signedUrl = await s3.getSignedUrlPromise('putObject', {
    Bucket: VIDEO_BUCKET_NAME,
    Key: s3Key,
    Expires: 3600, // URL expires in 1 hour
    ContentType: 'video/*',
  });

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true,
    },
    body: JSON.stringify({
      uploadUrl: signedUrl,
      videoId,
      s3Key,
    }),
  };
}

async function handleListVideos(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = event.queryStringParameters?.userId || 'anonymous';

  const params = {
    TableName: VIDEO_TABLE_NAME,
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': userId,
    },
  };

  const result = await dynamoDB.query(params).promise();

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true,
    },
    body: JSON.stringify(result.Items),
  };
}

async function handleGetVideo(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const videoId = event.pathParameters?.videoId;
  const userId = event.queryStringParameters?.userId || 'anonymous';

  if (!videoId) {
    return {
      statusCode: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({ message: 'videoId is required' }),
    };
  }

  const params = {
    TableName: VIDEO_TABLE_NAME,
    Key: {
      videoId,
      userId,
    },
  };

  const result = await dynamoDB.get(params).promise();

  if (!result.Item) {
    return {
      statusCode: 404,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({ message: 'Video not found' }),
    };
  }

  // Generate a signed URL for video playback
  const signedUrl = await s3.getSignedUrlPromise('getObject', {
    Bucket: VIDEO_BUCKET_NAME,
    Key: result.Item.s3Key,
    Expires: 3600, // URL expires in 1 hour
  });

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true,
    },
    body: JSON.stringify({
      ...result.Item,
      playbackUrl: signedUrl,
    }),
  };
} 