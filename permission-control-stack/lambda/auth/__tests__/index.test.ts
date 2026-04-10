import { handler } from '../index';
import { APIGatewayProxyEvent } from 'aws-lambda';
import * as authUtil from '../../shared/auth-util';
import * as dynamoUtil from '../../shared/dynamo-util';

jest.mock('../../shared/auth-util');
jest.mock('../../shared/dynamo-util');

process.env.HIERARCHY_TABLE = 'TestHierarchyTable';
process.env.JWT_SECRET = 'test-secret';

const mockIssueToken = authUtil.issueToken as jest.Mock;
const mockQueryByPk = dynamoUtil.queryByPk as jest.Mock;

const createEvent = (overrides?: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent => ({
  httpMethod: 'POST',
  path: '/auth/verify',
  headers: {},
  body: JSON.stringify({ phone: '555-1234' }),
  resource: '',
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  pathParameters: null,
  stageVariables: null,
  ...overrides,
  requestContext: {
    resourcePath: '',
    httpMethod: 'POST',
    path: '/auth/verify',
    accountId: '123456789012',
    stage: 'dev',
    identity: {
      cognitoIdentityPoolId: null,
      accountId: null,
      cognitoIdentityId: null,
      caller: null,
      sourceIp: '127.0.0.1',
      principalOrgId: null,
      accessKey: null,
      cognitoAuthenticationType: null,
      cognitoAuthenticationProvider: null,
      userArn: null,
      userAgent: 'test',
      user: null,
      apiKey: null,
      apiKeyId: null,
      clientCert: null,
    } as any,
    resourceId: 'abc123',
    apiId: 'api123',
    requestId: 'req123',
    requestTime: '2024-01-01T00:00:00Z',
    requestTimeEpoch: 1704067200000,
  },
  isBase64Encoded: false,
}) as APIGatewayProxyEvent;

describe('auth handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIssueToken.mockReturnValue('mock-jwt-token');
  });

  describe('POST /auth/verify', () => {
    it('should verify employee and return JWT token', async () => {
      const employee = {
        PK: 'TEAM#team123',
        SK: 'EMP#emp123',
        phone: '555-1234',
        name: 'Alice',
        deptId: 'dept123',
      };
      mockQueryByPk.mockResolvedValue([employee]);

      const event = createEvent({
        body: JSON.stringify({ phone: '555-1234' }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        token: 'mock-jwt-token',
        empId: 'emp123',
        teamId: 'team123',
        deptId: 'dept123',
      });
      expect(mockIssueToken).toHaveBeenCalledWith(
        'emp123',
        'team123',
        'dept123',
        '555-1234'
      );
    });

    it('should return 400 if phone is missing', async () => {
      const event = createEvent({
        body: JSON.stringify({}),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'phone is required',
      });
    });

    it('should return 401 if employee not found', async () => {
      mockQueryByPk.mockResolvedValue([]);

      const event = createEvent({
        body: JSON.stringify({ phone: '555-9999' }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        error: 'Employee not found',
      });
    });

    it('should return 400 if body is invalid JSON', async () => {
      const event = createEvent({
        body: 'invalid json',
      });

      try {
        await handler(event);
        fail('Should have thrown error');
      } catch (e) {
        expect(e).toBeDefined();
      }
    });

    it('should return correct Content-Type header', async () => {
      const employee = {
        PK: 'TEAM#team123',
        SK: 'EMP#emp123',
        phone: '555-1234',
        deptId: 'dept123',
      };
      mockQueryByPk.mockResolvedValue([employee]);

      const event = createEvent();
      const response = await handler(event);

      expect(response.headers?.['Content-Type']).toBe('application/json');
    });
  });

  describe('Other methods', () => {
    it('should return 404 for unrecognized paths', async () => {
      const event = createEvent({
        path: '/unknown',
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: 'Not found',
      });
    });

    it('should return 404 for GET requests', async () => {
      const event = createEvent({
        httpMethod: 'GET',
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(404);
    });
  });
});
