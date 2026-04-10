import { handler } from '../index';
import { APIGatewayProxyEvent } from 'aws-lambda';
import * as authUtil from '../../shared/auth-util';
import * as dynamoUtil from '../../shared/dynamo-util';

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');
jest.mock('../../shared/auth-util');
jest.mock('../../shared/dynamo-util');

process.env.ROLE_TABLE = 'RoleTable';
process.env.ROLE_ASSIGNMENT_TABLE = 'RoleAssignmentTable';
process.env.DATASET_BUCKET = 'datasets-bucket';
process.env.JWT_SECRET = 'test-secret';

const mockVerifyToken = authUtil.verifyToken as jest.Mock;
const mockQueryByPk = dynamoUtil.queryByPk as jest.Mock;
const mockGetItem = dynamoUtil.getItem as jest.Mock;

const createEvent = (overrides?: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent => ({
  httpMethod: 'GET',
  path: '/datasets',
  headers: { Authorization: 'Bearer mock-token' },
  body: null,
  resource: '',
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  pathParameters: null,
  stageVariables: null,
  ...overrides,
  requestContext: {
    resourcePath: '',
    httpMethod: 'GET',
    path: '/datasets',
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

describe('dataset handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockReturnValue({
      empId: 'emp123',
      teamId: 'team123',
      deptId: 'dept123',
      phone: '555-1234',
    });
    // Setup default S3 mock
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    getSignedUrl.mockResolvedValue('https://s3.example.com/presigned-url');
  });

  describe('Authentication', () => {
    it('should return 401 if token is invalid', async () => {
      mockVerifyToken.mockReturnValue(null);

      const event = createEvent();
      const response = await handler(event);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        error: 'Unauthorized',
      });
    });

    it('should return 401 if Authorization header is missing', async () => {
      const event = createEvent({
        headers: {},
      });

      mockVerifyToken.mockReturnValue(null);
      const response = await handler(event);

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /datasets', () => {
    it('should return 403 if user lacks read permission', async () => {
      // No roles assigned
      mockQueryByPk.mockResolvedValue([]);

      const event = createEvent();
      const response = await handler(event);

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body)).toEqual({
        error: 'Forbidden',
      });
    });
  });

  describe('GET /datasets/{id}', () => {
    it('should return presigned download URL if authorized', async () => {
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      getSignedUrl.mockResolvedValue('https://s3.example.com/presigned-url');

      // Mock role assignments
      mockQueryByPk.mockImplementation((table, pk) => {
        if (pk.includes('EMP#')) return Promise.resolve([]);
        if (pk.includes('TEAM#')) return Promise.resolve([{ SK: 'ROLE#editor' }]);
        return Promise.resolve([]);
      });

      // Mock role definition
      mockGetItem.mockResolvedValue({
        PK: 'ROLE#editor',
        permissions: ['dataset:read', 'dataset:write'],
        datasets: ['dataset-123'],
      });

      const event = createEvent({
        httpMethod: 'GET',
        path: '/datasets/{id}',
        pathParameters: { id: 'dataset-123' } as any,
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.datasetId).toBe('dataset-123');
      expect(body.downloadUrl).toBeDefined();
    });

    it('should return 403 if user lacks read permission for dataset', async () => {
      mockQueryByPk.mockResolvedValue([]);

      const event = createEvent({
        httpMethod: 'GET',
        path: '/datasets/{id}',
        pathParameters: { id: 'dataset-123' } as any,
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(403);
    });

    it('should allow access to specific dataset if in allowed list', async () => {
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      getSignedUrl.mockResolvedValue('https://s3.example.com/presigned-url');

      mockQueryByPk.mockImplementation((table, pk) => {
        if (pk === 'EMP#emp123') return Promise.resolve([{ SK: 'ROLE#viewer' }]);
        return Promise.resolve([]);
      });

      mockGetItem.mockResolvedValue({
        PK: 'ROLE#viewer',
        permissions: ['dataset:read'],
        datasets: ['dataset-123', 'dataset-456'],
      });

      const event = createEvent({
        httpMethod: 'GET',
        path: '/datasets/{id}',
        pathParameters: { id: 'dataset-123' } as any,
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
    });
  });

  describe('PUT /datasets/{id}', () => {
    it('should return presigned upload URL if authorized', async () => {
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      getSignedUrl.mockResolvedValue('https://s3.example.com/presigned-upload');

      mockQueryByPk.mockImplementation((table, pk) => {
        if (pk === 'EMP#emp123') return Promise.resolve([{ SK: 'ROLE#editor' }]);
        return Promise.resolve([]);
      });

      mockGetItem.mockResolvedValue({
        PK: 'ROLE#editor',
        permissions: ['dataset:write'],
        datasets: ['*'],
      });

      const event = createEvent({
        httpMethod: 'PUT',
        path: '/datasets/{id}',
        pathParameters: { id: 'dataset-123' } as any,
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.datasetId).toBe('dataset-123');
      expect(body.uploadUrl).toBeDefined();
    });

    it('should return 403 if user lacks write permission', async () => {
      mockQueryByPk.mockResolvedValue([]);

      const event = createEvent({
        httpMethod: 'PUT',
        path: '/datasets/{id}',
        pathParameters: { id: 'dataset-123' } as any,
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(403);
    });
  });

  describe('Other methods', () => {
    it('should return 404 for unrecognized paths', async () => {
      const event = createEvent({
        path: '/unknown',
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(404);
    });
  });
});
