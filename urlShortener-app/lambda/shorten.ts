import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDB } from "aws-sdk";

// Initialize DynamoDB client
/** NOTE !!!
 *
 * AWS CDK expects `lambda code` written in javascript (instead of typescript)
 * so we need to compile the typescript code to javascript first
 * then we are able to refer to the compiled javascript code
 * as below
 *
 *  1) add `lambda-crudl/tsconfig.lambda.json`
 *  2) compile the typescript code to javascript : npx tsc -p tsconfig.lambda.json
 *  3) cdk deploy
 */
const dynamoDb = new DynamoDB.DocumentClient();
const tableName = process.env.TABLE_NAME || "";
const shortUrlLength = parseInt(process.env.SHORT_URL_LENGTH || "7", 10);

// Function to generate a random short URL key
const generateShortUrl = (length: number): string => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Function to check if a short URL already exists
const shortUrlExists = async (shortUrl: string): Promise<boolean> => {
  const params = {
    TableName: tableName,
    Key: {
      short_url_id: shortUrl,
    },
  };

  const result = await dynamoDb.get(params).promise();
  return !!result.Item;
};

// Handler function for the Lambda
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Parse the request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Request body is required" }),
      };
    }

    const { url, expiration } = JSON.parse(event.body);

    // Validate URL
    if (!url) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "URL is required" }),
      };
    }

    try {
      // Validate that the URL is properly formatted
      new URL(url);
    } catch (error) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Invalid URL format" }),
      };
    }

    // Generate a unique short URL
    let shortUrl = "";
    let isUnique = false;

    while (!isUnique) {
      shortUrl = generateShortUrl(shortUrlLength);
      isUnique = !(await shortUrlExists(shortUrl));
    }

    // Calculate expiration time if provided
    let expirationTime: number | undefined;
    if (expiration) {
      const ttl = parseInt(expiration, 10);
      if (!isNaN(ttl) && ttl > 0) {
        expirationTime = Math.floor(Date.now() / 1000) + ttl;
      }
    }

    // Store the URL mapping in DynamoDB
    const params = {
      TableName: tableName,
      Item: {
        short_url_id: shortUrl,
        original_url: url,
        created_at: new Date().toISOString(),
        ...(expirationTime && { expiration_time: expirationTime }),
      },
    };

    await dynamoDb.put(params).promise();

    // Build the short URL path (excluding domain)
    const apiGatewayUrl = event.headers.Host || "";
    const apiStage = event.requestContext?.stage
      ? `/${event.requestContext.stage}`
      : "";
    const shortUrlPath = `/url/${shortUrl}`;

    // Return the shortened URL
    return {
      statusCode: 201,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        shortUrl,
        shortUrlPath,
        fullShortUrl: `https://${apiGatewayUrl}${apiStage}${shortUrlPath}`,
        originalUrl: url,
        ...(expirationTime && {
          expiresAt: new Date(expirationTime * 1000).toISOString(),
        }),
      }),
    };
  } catch (error) {
    console.error("Error shortening URL:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Failed to shorten URL" }),
    };
  }
};
