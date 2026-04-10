import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { issueToken } from '../shared/auth-util';
import { queryByPk } from '../shared/dynamo-util';

const HIERARCHY_TABLE = process.env.HIERARCHY_TABLE!;

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'POST' && event.path === '/auth/verify') {
    const { phone } = JSON.parse(event.body || '{}');
    if (!phone) return json(400, { error: 'phone is required' });

    // Look up employee by phone via GSI
    const items = await queryByPk(HIERARCHY_TABLE, phone, 'phone-index', 'phone');
    if (items.length === 0) return json(401, { error: 'Employee not found' });

    const emp = items[0];
    const empId = (emp.SK as string).replace('EMP#', '');
    const teamId = (emp.PK as string).replace('TEAM#', '');
    const deptId = (emp.deptId as string) || 'unknown';

    const token = issueToken(empId, teamId, deptId, phone);
    return json(200, { token, empId, teamId, deptId });
  }

  return json(404, { error: 'Not found' });
}
