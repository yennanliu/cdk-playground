import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { verifyToken } from '../shared/auth-util';
import { putItem, getItem, queryByPk, queryByPkSk, deleteItem } from '../shared/dynamo-util';

const HIERARCHY_TABLE = process.env.HIERARCHY_TABLE!;
const ROLE_ASSIGNMENT_TABLE = process.env.ROLE_ASSIGNMENT_TABLE!;
const ROLE_TABLE = process.env.ROLE_TABLE!;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function requireAdmin(event: APIGatewayProxyEvent): APIGatewayProxyResult | null {
  const claims = verifyToken(event.headers['Authorization'] || event.headers['authorization']);
  if (!claims) return json(401, { error: 'Unauthorized' });
  // In production, check admin role here
  return null;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const path = event.path;

  // --- Departments ---
  if (path === '/hierarchy' && method === 'GET') {
    const items = await queryByPkSk(HIERARCHY_TABLE, 'ROOT', 'DEPT#');
    return json(200, { departments: items });
  }

  if (path === '/hierarchy/departments' && method === 'POST') {
    const err = requireAdmin(event);
    if (err) return err;
    const { id, name } = JSON.parse(event.body || '{}');
    if (!id || !name) return json(400, { error: 'id and name required' });
    await putItem(HIERARCHY_TABLE, {
      PK: 'ROOT', SK: `DEPT#${id}`, entityType: 'department', name,
    });
    return json(201, { id, name });
  }

  // --- Teams ---
  if (path === '/hierarchy/teams' && method === 'GET') {
    const deptId = event.queryStringParameters?.deptId;
    if (!deptId) return json(400, { error: 'deptId required' });
    const items = await queryByPkSk(HIERARCHY_TABLE, `DEPT#${deptId}`, 'TEAM#');
    return json(200, { teams: items });
  }

  if (path === '/hierarchy/teams' && method === 'POST') {
    const err = requireAdmin(event);
    if (err) return err;
    const { id, name, deptId } = JSON.parse(event.body || '{}');
    if (!id || !name || !deptId) return json(400, { error: 'id, name, deptId required' });
    await putItem(HIERARCHY_TABLE, {
      PK: `DEPT#${deptId}`, SK: `TEAM#${id}`, entityType: 'team', name,
    });
    return json(201, { id, name, deptId });
  }

  // --- Employees ---
  if (path === '/hierarchy/employees' && method === 'GET') {
    const teamId = event.queryStringParameters?.teamId;
    if (!teamId) return json(400, { error: 'teamId required' });
    const items = await queryByPkSk(HIERARCHY_TABLE, `TEAM#${teamId}`, 'EMP#');
    return json(200, { employees: items });
  }

  if (path === '/hierarchy/employees' && method === 'POST') {
    const err = requireAdmin(event);
    if (err) return err;
    const { id, name, teamId, deptId, phone } = JSON.parse(event.body || '{}');
    if (!id || !name || !teamId || !deptId || !phone)
      return json(400, { error: 'id, name, teamId, deptId, phone required' });
    await putItem(HIERARCHY_TABLE, {
      PK: `TEAM#${teamId}`, SK: `EMP#${id}`, entityType: 'employee', name, phone, deptId,
    });
    return json(201, { id, name, teamId, deptId, phone });
  }

  // --- Roles ---
  if (path === '/roles' && method === 'POST') {
    const err = requireAdmin(event);
    if (err) return err;
    const { name, permissions, datasets } = JSON.parse(event.body || '{}');
    if (!name || !permissions) return json(400, { error: 'name and permissions required' });
    await putItem(ROLE_TABLE, {
      PK: `ROLE#${name}`, SK: `ROLE#${name}`, permissions, datasets: datasets || ['*'],
    });
    return json(201, { name, permissions, datasets });
  }

  if (path === '/roles' && method === 'GET') {
    const err = requireAdmin(event);
    if (err) return err;
    const roleName = event.queryStringParameters?.name;
    if (!roleName) return json(400, { error: 'name required' });
    const items = await queryByPk(ROLE_TABLE, `ROLE#${roleName}`);
    return json(200, { role: items[0] || null });
  }

  // --- Permissions Lookup ---
  if (path === '/permissions' && method === 'GET') {
    const err = requireAdmin(event);
    if (err) return err;

    const empId = event.queryStringParameters?.empId;
    const teamId = event.queryStringParameters?.teamId;
    if (!empId || !teamId) return json(400, { error: 'empId and teamId required' });

    // Look up employee to get deptId
    const emp = await getItem(HIERARCHY_TABLE, { PK: `TEAM#${teamId}`, SK: `EMP#${empId}` });
    if (!emp) return json(404, { error: 'Employee not found' });
    const deptId = (emp.deptId as string) || 'unknown';

    // Query role assignments at all 3 hierarchy levels
    const [empRoles, teamRoles, deptRoles] = await Promise.all([
      queryByPk(ROLE_ASSIGNMENT_TABLE, `EMP#${empId}`),
      queryByPk(ROLE_ASSIGNMENT_TABLE, `TEAM#${teamId}`),
      queryByPk(ROLE_ASSIGNMENT_TABLE, `DEPT#${deptId}`),
    ]);

    // Build role assignment details with source level
    const roleEntries: { roleName: string; source: string; level: string }[] = [];
    for (const r of deptRoles) roleEntries.push({ roleName: (r.SK as string).replace('ROLE#', ''), source: deptId, level: 'department' });
    for (const r of teamRoles) roleEntries.push({ roleName: (r.SK as string).replace('ROLE#', ''), source: teamId, level: 'team' });
    for (const r of empRoles) roleEntries.push({ roleName: (r.SK as string).replace('ROLE#', ''), source: empId, level: 'employee' });

    // Fetch role definitions
    const uniqueRoles = [...new Set(roleEntries.map(r => r.roleName))];
    const roleDefs = await Promise.all(
      uniqueRoles.map(name => getItem(ROLE_TABLE, { PK: `ROLE#${name}`, SK: `ROLE#${name}` }))
    );
    const roleMap: Record<string, { permissions: string[]; datasets: string[] }> = {};
    for (const rd of roleDefs) {
      if (!rd) continue;
      const name = (rd.PK as string).replace('ROLE#', '');
      roleMap[name] = { permissions: rd.permissions as string[], datasets: rd.datasets as string[] };
    }

    // Merge all permissions and datasets
    const allPermissions = new Set<string>();
    const allDatasets = new Set<string>();
    for (const name of uniqueRoles) {
      const def = roleMap[name];
      if (!def) continue;
      for (const p of def.permissions) allPermissions.add(p);
      for (const d of def.datasets) allDatasets.add(d);
    }

    return json(200, {
      employee: { empId, teamId, deptId, name: emp.name, phone: emp.phone },
      roleAssignments: roleEntries.map(r => ({
        ...r,
        permissions: roleMap[r.roleName]?.permissions || [],
        datasets: roleMap[r.roleName]?.datasets || [],
      })),
      resolved: {
        permissions: [...allPermissions],
        datasets: [...allDatasets],
      },
    });
  }

  // --- Role Assignment ---
  if (path === '/roles/assign' && method === 'POST') {
    const err = requireAdmin(event);
    if (err) return err;
    const { entityId, roleName } = JSON.parse(event.body || '{}');
    // entityId can be DEPT#x, TEAM#x, or EMP#x
    if (!entityId || !roleName) return json(400, { error: 'entityId and roleName required' });
    await putItem(ROLE_ASSIGNMENT_TABLE, {
      PK: entityId, SK: `ROLE#${roleName}`, assignedAt: new Date().toISOString(),
    });
    return json(201, { entityId, roleName });
  }

  if (path === '/roles/assign' && method === 'DELETE') {
    const err = requireAdmin(event);
    if (err) return err;
    const { entityId, roleName } = JSON.parse(event.body || '{}');
    if (!entityId || !roleName) return json(400, { error: 'entityId and roleName required' });
    await deleteItem(ROLE_ASSIGNMENT_TABLE, { PK: entityId, SK: `ROLE#${roleName}` });
    return json(200, { deleted: true });
  }

  return json(404, { error: 'Not found' });
}
