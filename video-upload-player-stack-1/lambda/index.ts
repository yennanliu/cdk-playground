import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';
import { S3 } from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';

const dynamoDB = new DynamoDB.DocumentClient();
const s3 = new S3();

const VIDEO_TABLE_NAME = process.env.VIDEO_TABLE_NAME!;
const VIDEO_BUCKET_NAME = process.env.VIDEO_BUCKET_NAME!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    const path = event.path;
    const httpMethod = event.httpMethod;

    // Handle CORS preflight requests
    if (httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        },
        body: '',
      };
    }

    // Handle different API endpoints
    if (path === '/upload-url' && httpMethod === 'GET') {
      return await handleGetUploadUrl(event);
    } else if (path === '/videos' && httpMethod === 'GET') {
      return await handleListVideos(event);
    } else if (path === '/videos' && httpMethod === 'POST') {
      return await handleSaveVideoMetadata(event);
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
      body: JSON.stringify({ message: 'Internal Server Error', error: error instanceof Error ? error.message : String(error) }),
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
  try {
    const userId = event.queryStringParameters?.userId || 'anonymous';
    console.log('Listing videos for userId:', userId);

    const params = {
      TableName: VIDEO_TABLE_NAME,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
    };

    const result = await dynamoDB.query(params).promise();
    console.log('DynamoDB query result:', result);

    // Generate playback URLs for each video
    const videosWithUrls = await Promise.all(
      (result.Items || []).map(async (video) => {
        try {
          const playbackUrl = await s3.getSignedUrlPromise('getObject', {
            Bucket: VIDEO_BUCKET_NAME,
            Key: video.s3Key,
            Expires: 3600,
          });
          return {
            ...video,
            playbackUrl,
          };
        } catch (error) {
          console.error('Error generating playback URL for video:', video.videoId, error);
          return {
            ...video,
            playbackUrl: null,
          };
        }
      })
    );

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify(videosWithUrls),
    };
  } catch (error) {
    console.error('Error in handleListVideos:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({ message: 'Failed to list videos', error: error instanceof Error ? error.message : String(error) }),
    };
  }
}

async function handleSaveVideoMetadata(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify({ message: 'Request body is required' }),
      };
    }

    const videoData = JSON.parse(event.body);
    const { videoId, userId, title, s3Key } = videoData;

    if (!videoId || !userId || !title || !s3Key) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify({ message: 'Missing required fields' }),
      };
    }

    const params = {
      TableName: VIDEO_TABLE_NAME,
      Item: {
        userId,
        videoId,
        title,
        s3Key,
        createdAt: new Date().toISOString(),
      },
    };

    await dynamoDB.put(params).promise();
    console.log('Video metadata saved:', params.Item);
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({ message: 'Video metadata saved successfully' }),
    };
  } catch (error) {
    console.error('Error saving video metadata:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({ message: 'Failed to save video metadata', error: error instanceof Error ? error.message : String(error) }),
    };
  }
}

async function handleGetVideo(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
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
        userId,
        videoId,
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
  } catch (error) {
    console.error('Error getting video:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({ message: 'Failed to get video', error: error instanceof Error ? error.message : String(error) }),
    };
  }
} 