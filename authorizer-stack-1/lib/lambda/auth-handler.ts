import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { compare, hash } from 'bcryptjs';

const dynamoDb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});
const TABLE_NAME = process.env.USERS_TABLE!;
const JWT_SECRET_ARN = process.env.JWT_SECRET_ARN!;

let cachedJwtSecret: string | null = null;

interface User {
    email: string;
    password: string;
    role: string;
}

async function getJwtSecret(): Promise<string> {
    if (cachedJwtSecret) return cachedJwtSecret;

    const response = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: JWT_SECRET_ARN })
    );
    const secretString = response.SecretString!;
    const secret = JSON.parse(secretString).secret;
    cachedJwtSecret = secret;
    return secret;
}

async function verifyToken(token: string): Promise<any> {
    const secret = await getJwtSecret();
    return new Promise((resolve, reject) => {
        jwt.verify(token, secret, (err: any, decoded: any) => {
            if (err) reject(err);
            else resolve(decoded);
        });
    });
}

async function generateToken(user: { email: string; role: string }): Promise<string> {
    const secret = await getJwtSecret();
    return jwt.sign(
        { email: user.email, role: user.role },
        secret,
        { expiresIn: '1h' }
    );
}

async function handleLogin(email: string, password: string): Promise<APIGatewayProxyResult> {
    const result = await dynamoDb.send(
        new GetCommand({
            TableName: TABLE_NAME,
            Key: { email }
        })
    );

    const user = result.Item as User;
    if (!user || !await bcrypt.compare(password, user.password)) {
        return {
            statusCode: 401,
            body: JSON.stringify({ message: 'Invalid credentials' })
        };
    }

    const token = await generateToken({ email: user.email, role: user.role });
    return {
        statusCode: 200,
        body: JSON.stringify({ token, user: { email: user.email, role: user.role } })
    };
}

async function verifyAuth(event: APIGatewayProxyEvent): Promise<{
    isAuthorized: boolean;
    user?: { email: string; role: string };
    message?: string;
}> {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return { isAuthorized: false, message: 'Missing or invalid token' };
    }

    try {
        const token = authHeader.split(' ')[1];
        const decoded = await verifyToken(token);
        return { isAuthorized: true, user: decoded };
    } catch (error) {
        return { isAuthorized: false, message: 'Invalid token' };
    }
}

async function handleVerifyToken(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const authResult = await verifyAuth(event);
    if (!authResult.isAuthorized) {
        return {
            statusCode: 401,
            body: JSON.stringify({ message: authResult.message })
        };
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ user: authResult.user })
    };
}

async function handleListMembers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const authResult = await verifyAuth(event);
    if (!authResult.isAuthorized) {
        return {
            statusCode: 401,
            body: JSON.stringify({ message: 'Authentication required' })
        };
    }

    const result = await dynamoDb.send(
        new ScanCommand({
            TableName: TABLE_NAME,
            ProjectionExpression: 'email, #role',
            ExpressionAttributeNames: {
                '#role': 'role'
            }
        })
    );

    return {
        statusCode: 200,
        body: JSON.stringify(result.Items)
    };
}

async function handleAddMember(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    
    if (!body.email || !body.password) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Email and password are required' })
        };
    }

    // Set default role to 'user' if not provided
    const role = body.role || 'user';

    const hashedPassword = await bcrypt.hash(body.password, 10);
    await dynamoDb.send(
        new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                email: body.email,
                password: hashedPassword,
                role: role
            },
            ConditionExpression: 'attribute_not_exists(email)'
        })
    );

    return {
        statusCode: 201,
        body: JSON.stringify({ message: 'Member created successfully' })
    };
}

async function handleDeleteMember(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const authResult = await verifyAuth(event);
    if (!authResult.isAuthorized || authResult.user?.role !== 'admin') {
        return {
            statusCode: 403,
            body: JSON.stringify({ message: 'Unauthorized' })
        };
    }

    const email = event.pathParameters?.email;
    if (!email) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Email is required' })
        };
    }

    await dynamoDb.send(
        new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { email }
        })
    );

    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Member deleted successfully' })
    };
}

async function getUserFromToken(event: APIGatewayProxyEvent): Promise<{ email: string; role: string } | null> {
    const authHeader = event.headers['Authorization'] || event.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.split(' ')[1];
    try {
        const secret = await getJwtSecret();
        const decoded = jwt.verify(token, secret) as { email: string; role: string };
        return decoded;
    } catch (error) {
        return null;
    }
}

async function updatePassword(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        // Get user from JWT token
        const user = await getUserFromToken(event);
        if (!user) {
            return {
                statusCode: 401,
                body: JSON.stringify({ message: 'Unauthorized' })
            };
        }

        const body = JSON.parse(event.body || '{}');
        const { currentPassword, newPassword } = body;

        // Validate input
        if (!currentPassword || !newPassword) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Current password and new password are required' })
            };
        }

        // Get user from DynamoDB
        const userRecord = await dynamoDb.send(new GetCommand({
            TableName: process.env.USERS_TABLE!,
            Key: { email: user.email }
        }));

        if (!userRecord.Item) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: 'User not found' })
            };
        }

        // Verify current password
        const isPasswordValid = await compare(currentPassword, userRecord.Item.password);
        if (!isPasswordValid) {
            return {
                statusCode: 401,
                body: JSON.stringify({ message: 'Current password is incorrect' })
            };
        }

        // Hash new password
        const hashedPassword = await hash(newPassword, 10);

        // Update password in DynamoDB
        await dynamoDb.send(new UpdateCommand({
            TableName: process.env.USERS_TABLE!,
            Key: { email: user.email },
            UpdateExpression: 'set password = :password',
            ExpressionAttributeValues: {
                ':password': hashedPassword
            }
        }));

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Password updated successfully' })
        };
    } catch (error) {
        console.error('Error updating password:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal server error' })
        };
    }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        // Debug logging
        console.log('Received event:', JSON.stringify(event, null, 2));
        
        // Add CORS headers to all responses
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'OPTIONS,POST,GET,DELETE,PUT',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization'
        };

        // Handle OPTIONS requests (CORS preflight)
        // for user profile update, we need to allow OPTIONS requests
        if (event.httpMethod === 'OPTIONS') {
            return { statusCode: 204, headers, body: '' };
        }

        // Safely handle path - it might be in different places depending on API Gateway setup
        const path = (event.path || event.requestContext?.path || event.resource || '').toLowerCase();
        const method = event.httpMethod;

        console.log('Processing path:', path, 'method:', method);

        let response: APIGatewayProxyResult;

        if (path === '/auth/login' && method === 'POST') {
            const { email, password } = JSON.parse(event.body || '{}');
            response = await handleLogin(email, password);
        } else if (path === '/auth/verify' && method === 'POST') {
            response = await handleVerifyToken(event);
        } else if (path === '/members' && method === 'GET') {
            response = await handleListMembers(event);
        } else if (path === '/members' && method === 'POST') {
            response = await handleAddMember(event);
        } else if (path.startsWith('/members/') && method === 'DELETE') {
            response = await handleDeleteMember(event);
        } else if (event.resource === '/members/password' && event.httpMethod === 'PUT') {
            response = await updatePassword(event);
        } else {
            response = {
                statusCode: 404,
                body: JSON.stringify({ 
                    message: 'Not Found',
                    receivedPath: path,
                    receivedMethod: method,
                    availablePaths: ['/auth/login', '/auth/verify', '/members', '/members/{email}', '/members/password']
                })
            };
        }

        return { ...response, headers };
    } catch (error: any) {
        console.error('Error:', error);
        console.error('Event that caused error:', JSON.stringify(event, null, 2));
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET,DELETE,PUT',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization'
            },
            body: JSON.stringify({ message: 'Internal Server Error', error: error.message })
        };
    }
};
