import { Context, APIGatewayEvent, APIGatewayProxyResult } from "aws-lambda";

export async function handler(
    event: APIGatewayEvent,
    _context: Context
): Promise<APIGatewayProxyResult> {
    console.log('Event:', JSON.stringify(event, null, 2));
    
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
            message: 'Healthy',
            timestamp: new Date().toISOString(),
            path: event.path,
            method: event.httpMethod
        })
    };
}