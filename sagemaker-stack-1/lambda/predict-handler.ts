import { SageMakerRuntimeClient, InvokeEndpointCommand } from '@aws-sdk/client-sagemaker-runtime';

const client = new SageMakerRuntimeClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });
const ENDPOINT_NAME = process.env.ENDPOINT_NAME;

interface HousePredictionInput {
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  year_built: number;
}

interface SageMakerResponse {
  predicted_price: number;
  model_version: string;
}

interface APIGatewayEvent {
  body: string | null;
  headers: Record<string, string>;
}

interface APIGatewayResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export const handler = async (event: APIGatewayEvent): Promise<APIGatewayResponse> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  try {
    // Validate endpoint name
    if (!ENDPOINT_NAME) {
      throw new Error('ENDPOINT_NAME environment variable is not set');
    }

    // Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Request body is required',
        }),
      };
    }

    let requestData: HousePredictionInput;
    try {
      requestData = JSON.parse(event.body);
    } catch (error) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Invalid JSON in request body',
        }),
      };
    }

    // Validate input
    const { bedrooms, bathrooms, sqft, year_built } = requestData;

    if (
      typeof bedrooms !== 'number' ||
      typeof bathrooms !== 'number' ||
      typeof sqft !== 'number' ||
      typeof year_built !== 'number'
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Invalid input. Required fields: bedrooms, bathrooms, sqft, year_built (all numbers)',
        }),
      };
    }

    // Basic validation
    if (bedrooms < 0 || bathrooms < 0 || sqft < 0 || year_built < 1900 || year_built > 2100) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Input values out of reasonable range',
        }),
      };
    }

    // Invoke SageMaker endpoint
    console.log(`Invoking SageMaker endpoint: ${ENDPOINT_NAME}`);
    console.log('Request data:', requestData);

    const command = new InvokeEndpointCommand({
      EndpointName: ENDPOINT_NAME,
      ContentType: 'application/json',
      Accept: 'application/json',
      Body: JSON.stringify(requestData),
    });

    const response = await client.send(command);

    // Parse SageMaker response
    const responseBody = new TextDecoder().decode(response.Body);
    console.log('SageMaker response:', responseBody);

    const prediction: SageMakerResponse = JSON.parse(responseBody);

    // Return successful response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        predicted_price: Math.round(prediction.predicted_price),
        model_version: prediction.model_version,
        input: requestData,
        timestamp: new Date().toISOString(),
      }),
    };

  } catch (error) {
    console.error('Error:', error);

    // Check for specific SageMaker errors
    if (error instanceof Error) {
      if (error.name === 'ValidationException') {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({
            error: 'SageMaker endpoint not found or not ready',
            details: error.message,
          }),
        };
      }

      if (error.name === 'ModelError') {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            error: 'Model inference error',
            details: error.message,
          }),
        };
      }
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
