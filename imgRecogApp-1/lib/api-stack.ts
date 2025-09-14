import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface ApiStackProps extends StackProps {
  imageBucket: s3.Bucket;
  resultsTable: dynamodb.Table;
}

export class ApiStack extends Stack {
  public readonly api: apigateway.RestApi;
  public readonly processImageFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Lambda function for processing images
    this.processImageFunction = new lambda.Function(this, 'ProcessImageFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const dynamodb = new AWS.DynamoDB.DocumentClient();
const rekognition = new AWS.Rekognition();

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const httpMethod = event.httpMethod;
    const path = event.path;

    if (httpMethod === 'POST' && path === '/upload-url') {
      return await generatePresignedUrl(event);
    } else if (httpMethod === 'POST' && path === '/process-image') {
      return await processImage(event);
    } else if (httpMethod === 'GET' && path.startsWith('/results/')) {
      return await getResults(event);
    }

    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Not found' })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function generatePresignedUrl(event) {
  const body = JSON.parse(event.body || '{}');
  const { fileName, fileType } = body;

  if (!fileName || !fileType) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'fileName and fileType are required' })
    };
  }

  const imageId = Date.now().toString();
  const key = \`images/\${imageId}-\${fileName}\`;

  const presignedUrl = s3.getSignedUrl('putObject', {
    Bucket: process.env.BUCKET_NAME,
    Key: key,
    ContentType: fileType,
    Expires: 300
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      uploadUrl: presignedUrl,
      imageId: imageId,
      key: key
    })
  };
}

async function processImage(event) {
  const body = JSON.parse(event.body || '{}');
  const { imageId, key } = body;

  if (!imageId || !key) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'imageId and key are required' })
    };
  }

  // Analyze image with Rekognition
  const rekognitionParams = {
    Image: {
      S3Object: {
        Bucket: process.env.BUCKET_NAME,
        Name: key
      }
    },
    MaxLabels: 10,
    MinConfidence: 70
  };

  const rekognitionResult = await rekognition.detectLabels(rekognitionParams).promise();

  // Store results in DynamoDB
  const dynamoParams = {
    TableName: process.env.TABLE_NAME,
    Item: {
      imageId: imageId,
      userId: 'anonymous',
      timestamp: new Date().toISOString(),
      key: key,
      labels: rekognitionResult.Labels,
      processedAt: new Date().toISOString()
    }
  };

  await dynamodb.put(dynamoParams).promise();

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      imageId: imageId,
      labels: rekognitionResult.Labels
    })
  };
}

async function getResults(event) {
  const imageId = event.pathParameters?.imageId;

  if (!imageId) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'imageId is required' })
    };
  }

  const params = {
    TableName: process.env.TABLE_NAME,
    Key: {
      imageId: imageId
    }
  };

  const result = await dynamodb.get(params).promise();

  if (!result.Item) {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Results not found' })
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(result.Item)
  };
}
      `),
      timeout: Duration.seconds(30),
      environment: {
        BUCKET_NAME: props.imageBucket.bucketName,
        TABLE_NAME: props.resultsTable.tableName,
      },
    });

    // Grant permissions to Lambda function
    props.imageBucket.grantReadWrite(this.processImageFunction);
    props.resultsTable.grantReadWriteData(this.processImageFunction);

    // Grant Rekognition permissions
    this.processImageFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['rekognition:DetectLabels'],
        resources: ['*'],
      })
    );

    // API Gateway
    this.api = new apigateway.RestApi(this, 'ImageRecognitionApi', {
      restApiName: 'Image Recognition API',
      description: 'API for image recognition service',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // Lambda integration
    const lambdaIntegration = new apigateway.LambdaIntegration(this.processImageFunction);

    // API routes
    this.api.root.addResource('upload-url').addMethod('POST', lambdaIntegration);
    this.api.root.addResource('process-image').addMethod('POST', lambdaIntegration);

    const resultsResource = this.api.root.addResource('results');
    resultsResource.addResource('{imageId}').addMethod('GET', lambdaIntegration);
  }
}