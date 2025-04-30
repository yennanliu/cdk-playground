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

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Get the short URL ID from the path parameter
    const shortUrlId = event.pathParameters?.shortUrl;

    if (!shortUrlId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Short URL ID is required" }),
      };
    }

    // Lookup the original URL in DynamoDB
    const params = {
      TableName: tableName,
      Key: {
        short_url_id: shortUrlId,
      },
    };

    const result = await dynamoDb.get(params).promise();

    // If the short URL doesn't exist
    if (!result.Item) {
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Short URL not found" }),
      };
    }

    const originalUrl = result.Item.original_url;

    // Determine whether to return JSON or redirect based on Accept header
    const acceptHeader =
      event.headers["Accept"] || event.headers["accept"] || "";

    if (acceptHeader.includes("application/json")) {
      // Return the original URL as JSON
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          originalUrl,
          shortUrlId,
        }),
      };
    } else {
      // Redirect to the original URL (HTTP 302 - Found)
      return {
        statusCode: 302,
        headers: {
          Location: originalUrl,
          "Access-Control-Allow-Origin": "*",
        },
        body: "",
      };
    }
  } catch (error) {
    console.error("Error resolving URL:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Failed to resolve URL" }),
    };
  }
};
