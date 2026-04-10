import { APIGatewayProxyEvent } from 'aws-lambda';

process.env.HIERARCHY_TABLE = 'HierarchyTable';
process.env.ROLE_TABLE = 'RoleTable';
process.env.ROLE_ASSIGNMENT_TABLE = 'RoleAssignmentTable';
process.env.JWT_SECRET = 'test-secret';

jest.mock('../../shared/auth-util');
jest.mock('../../shared/dynamo-util');

import { handler } from '../index';
import * as authUtil from '../../shared/auth-util';
import * as dynamoUtil from '../../shared/dynamo-util';

const mockVerifyToken = authUtil.verifyToken as jest.Mock;
const mockQueryByPkSk = dynamoUtil.queryByPkSk as jest.Mock;
const mockQueryByPk = dynamoUtil.queryByPk as jest.Mock;
const mockPutItem = dynamoUtil.putItem as jest.Mock;
const mockDeleteItem = dynamoUtil.deleteItem as jest.Mock;

const createEvent = (overrides?: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent => ({
  httpMethod: 'GET',
  path: '/hierarchy',
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
    path: '/hierarchy',
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

describe('hierarchy handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockReturnValue({
      empId: 'admin-emp',
      teamId: 'admin-team',
      deptId: 'admin-dept',
      phone: '555-0000',
    });
    mockPutItem.mockResolvedValue(undefined);
    mockDeleteItem.mockResolvedValue(undefined);
  });

  describe('Authentication & Authorization', () => {
    it('should return 401 if token is invalid', async () => {
      mockVerifyToken.mockReturnValue(null);

      const event = createEvent({
        httpMethod: 'POST',
        path: '/hierarchy/departments',
        body: JSON.stringify({ id: 'dept1', name: 'Engineering' }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        error: 'Unauthorized',
      });
    });
  });

  describe('GET /hierarchy', () => {
    it('should list departments', async () => {
      const departments = [
        { PK: 'ROOT', SK: 'DEPT#eng', name: 'Engineering' },
        { PK: 'ROOT', SK: 'DEPT#sales', name: 'Sales' },
      ];
      mockQueryByPkSk.mockResolvedValue(departments);

      const event = createEvent();
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).departments).toEqual(departments);
      expect(mockQueryByPkSk).toHaveBeenCalledWith('HierarchyTable', 'ROOT', 'DEPT#');
    });
  });

  describe('POST /hierarchy/departments', () => {
    it('should create a department', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        path: '/hierarchy/departments',
        body: JSON.stringify({ id: 'eng', name: 'Engineering' }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        id: 'eng',
        name: 'Engineering',
      });
      expect(mockPutItem).toHaveBeenCalledWith('HierarchyTable', {
        PK: 'ROOT',
        SK: 'DEPT#eng',
        entityType: 'department',
        name: 'Engineering',
      });
    });

    it('should return 400 if id or name is missing', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        path: '/hierarchy/departments',
        body: JSON.stringify({ id: 'eng' }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'id and name required',
      });
    });

    it('should return 401 if not authenticated', async () => {
      mockVerifyToken.mockReturnValue(null);

      const event = createEvent({
        httpMethod: 'POST',
        path: '/hierarchy/departments',
        body: JSON.stringify({ id: 'eng', name: 'Engineering' }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Teams', () => {
    it('should list teams for a department', async () => {
      const teams = [
        { PK: 'DEPT#eng', SK: 'TEAM#backend', name: 'Backend' },
        { PK: 'DEPT#eng', SK: 'TEAM#frontend', name: 'Frontend' },
      ];
      mockQueryByPkSk.mockResolvedValue(teams);

      const event = createEvent({
        httpMethod: 'GET',
        path: '/hierarchy/teams',
        queryStringParameters: { deptId: 'eng' },
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).teams).toEqual(teams);
    });

    it('should return 400 if deptId is missing for GET teams', async () => {
      const event = createEvent({
        httpMethod: 'GET',
        path: '/hierarchy/teams',
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'deptId required',
      });
    });

    it('should create a team', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        path: '/hierarchy/teams',
        body: JSON.stringify({ id: 'backend', name: 'Backend Team', deptId: 'eng' }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        id: 'backend',
        name: 'Backend Team',
        deptId: 'eng',
      });
      expect(mockPutItem).toHaveBeenCalledWith('HierarchyTable', {
        PK: 'DEPT#eng',
        SK: 'TEAM#backend',
        entityType: 'team',
        name: 'Backend Team',
      });
    });

    it('should return 400 if required fields are missing when creating team', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        path: '/hierarchy/teams',
        body: JSON.stringify({ id: 'backend', deptId: 'eng' }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Employees', () => {
    it('should list employees for a team', async () => {
      const employees = [
        { PK: 'TEAM#backend', SK: 'EMP#alice', name: 'Alice', phone: '555-1001' },
        { PK: 'TEAM#backend', SK: 'EMP#bob', name: 'Bob', phone: '555-1002' },
      ];
      mockQueryByPkSk.mockResolvedValue(employees);

      const event = createEvent({
        httpMethod: 'GET',
        path: '/hierarchy/employees',
        queryStringParameters: { teamId: 'backend' },
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).employees).toEqual(employees);
    });

    it('should return 400 if teamId is missing for GET employees', async () => {
      const event = createEvent({
        httpMethod: 'GET',
        path: '/hierarchy/employees',
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'teamId required',
      });
    });

    it('should create an employee', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        path: '/hierarchy/employees',
        body: JSON.stringify({
          id: 'alice',
          name: 'Alice',
          teamId: 'backend',
          deptId: 'eng',
          phone: '555-1001',
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        id: 'alice',
        name: 'Alice',
        teamId: 'backend',
        deptId: 'eng',
        phone: '555-1001',
      });
      expect(mockPutItem).toHaveBeenCalledWith('HierarchyTable', {
        PK: 'TEAM#backend',
        SK: 'EMP#alice',
        entityType: 'employee',
        name: 'Alice',
        phone: '555-1001',
        deptId: 'eng',
      });
    });

    it('should return 400 if required fields are missing when creating employee', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        path: '/hierarchy/employees',
        body: JSON.stringify({
          id: 'alice',
          name: 'Alice',
          teamId: 'backend',
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Roles', () => {
    it('should create a role with permissions', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        path: '/roles',
        body: JSON.stringify({
          name: 'viewer',
          permissions: ['dataset:read'],
          datasets: ['*'],
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('viewer');
      expect(body.permissions).toEqual(['dataset:read']);
    });

    it('should return 400 if name or permissions are missing', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        path: '/roles',
        body: JSON.stringify({
          name: 'viewer',
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
    });

    it('should get a role by name', async () => {
      const role = {
        PK: 'ROLE#viewer',
        SK: 'ROLE#viewer',
        permissions: ['dataset:read'],
        datasets: ['*'],
      };
      mockQueryByPk.mockResolvedValue([role]);

      const event = createEvent({
        httpMethod: 'GET',
        path: '/roles',
        queryStringParameters: { name: 'viewer' },
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).role).toEqual(role);
    });

    it('should return 400 if name is missing for GET role', async () => {
      const event = createEvent({
        httpMethod: 'GET',
        path: '/roles',
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Role Assignment', () => {
    it('should assign a role to an entity', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        path: '/roles/assign',
        body: JSON.stringify({
          entityId: 'DEPT#eng',
          roleName: 'viewer',
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        entityId: 'DEPT#eng',
        roleName: 'viewer',
      });
      expect(mockPutItem).toHaveBeenCalled();
    });

    it('should return 400 if entityId or roleName is missing for POST assign', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        path: '/roles/assign',
        body: JSON.stringify({
          entityId: 'DEPT#eng',
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
    });

    it('should revoke a role from an entity', async () => {
      const event = createEvent({
        httpMethod: 'DELETE',
        path: '/roles/assign',
        body: JSON.stringify({
          entityId: 'DEPT#eng',
          roleName: 'viewer',
        }),
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        deleted: true,
      });
      expect(mockDeleteItem).toHaveBeenCalledWith('RoleAssignmentTable', {
        PK: 'DEPT#eng',
        SK: 'ROLE#viewer',
      });
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
