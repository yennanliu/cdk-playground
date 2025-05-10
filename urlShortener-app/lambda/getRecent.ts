import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

// Initialize DynamoDB client
const client = new DynamoDBClient({});
const dynamoDb = DynamoDBDocumentClient.from(client);
const tableName = process.env.TABLE_NAME || "";
const maxResults = 10;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Scan the table to get recent URLs
    const params = {
      TableName: tableName,
      Limit: maxResults,
      // Sort by created_at in descending order
      ScanIndexForward: false,
    };

    const result = await dynamoDb.send(new ScanCommand(params));

    // Sort items by created_at in descending order
    const items = result.Items || [];
    items.sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // Return the recent URLs
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        items: items.slice(0, maxResults).map(item => ({
          shortUrlId: item.short_url_id,
          originalUrl: item.original_url,
          createdAt: item.created_at,
        })),
      }),
    };
  } catch (error) {
    console.error("Error getting recent URLs:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Failed to get recent URLs" }),
    };
  }
}; 