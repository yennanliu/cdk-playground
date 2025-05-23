import { Context, APIGatewayTokenAuthorizerEvent, Callback, APIGatewayAuthorizerResult } from "aws-lambda";

export const handler = function (
    event: APIGatewayTokenAuthorizerEvent, 
    context: Context, 
    callback: Callback<APIGatewayAuthorizerResult>
) {
    console.log('Authorizer event:', JSON.stringify(event, null, 2));
    
    let token = event.authorizationToken;
    
    // Remove 'Bearer ' prefix if present
    if (token?.startsWith('Bearer ')) {
        token = token.substring(7);
    }
    
    try {
        // Simple token validation logic
        // In a real scenario, you would validate JWT tokens, check against a database, etc.
        switch (token) {
            case 'allow':
            case 'valid-token-123':
                console.log('Token valid, allowing access');
                callback(null, generatePolicy('user', 'Allow', event.methodArn));
                break;
            case 'deny':
            case 'invalid-token':
                console.log('Token invalid, denying access');
                callback(null, generatePolicy('user', 'Deny', event.methodArn));
                break;
            case 'unauthorized':
                console.log('Unauthorized token');
                callback("Unauthorized");   // Return a 401 Unauthorized response
                break;
            default:
                // For any other token, we can check if it's a valid format
                if (token && token.length > 10 && token.includes('-')) {
                    // Simple heuristic for token validation
                    console.log('Token appears valid, allowing access');
                    callback(null, generatePolicy('user', 'Allow', event.methodArn));
                } else {
                    console.log('Invalid token format');
                    callback("Error: Invalid token"); // Return a 500 Invalid token response
                }
        }
    } catch (error) {
        console.error('Error processing authorization:', error);
        callback("Error: Authorization failed");
    }
};

const generatePolicy = function (principalId: string, effect: 'Allow' | 'Deny', resource: string): APIGatewayAuthorizerResult {
    return {
        principalId: principalId,
        policyDocument: {
            Version: '2012-10-17',
            Statement: [{
                Action: 'execute-api:Invoke',
                Effect: effect,
                Resource: resource
            }]
        },
        context: {
            // You can add additional context here that will be passed to your Lambda
            tokenValidated: 'true',
            userId: principalId,
            timestamp: new Date().toISOString()
        }
    };
};