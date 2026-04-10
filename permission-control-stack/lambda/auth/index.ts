import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { issueToken } from '../shared/auth-util';
import { queryByPk } from '../shared/dynamo-util';

const HIERARCHY_TABLE = process.env.HIERARCHY_TABLE!;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'POST' && event.path === '/auth/verify') {
    const { phone } = JSON.parse(event.body || '{}');
    if (!phone) return json(400, { error: 'phone is required' });

    // Look up employee by phone via GSI
    const items = await queryByPk(HIERARCHY_TABLE, phone, 'phone-index', 'phone');

    let empId: string, teamId: string, deptId: string;
    if (items.length > 0) {
      const emp = items[0];
      empId = (emp.SK as string).replace('EMP#', '');
      teamId = (emp.PK as string).replace('TEAM#', '');
      deptId = (emp.deptId as string) || 'unknown';
    } else {
      // Guest login — issue token with guest identity
      empId = `guest-${Date.now()}`;
      teamId = 'guest';
      deptId = 'guest';
    }

    const token = issueToken(empId, teamId, deptId, phone);
    return json(200, { token, empId, teamId, deptId, guest: items.length === 0 });
  }

  return json(404, { error: 'Not found' });
}
