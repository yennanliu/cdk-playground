import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { verifyToken } from '../shared/auth-util';
import { queryByPk, getItem } from '../shared/dynamo-util';

const ROLE_TABLE = process.env.ROLE_TABLE!;
const ROLE_ASSIGNMENT_TABLE = process.env.ROLE_ASSIGNMENT_TABLE!;
const DATASET_BUCKET = process.env.DATASET_BUCKET!;

const s3 = new S3Client({});

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

interface ResolvedPermissions {
  permissions: Set<string>;
  datasets: Set<string>;
}

async function resolvePermissions(empId: string, teamId: string, deptId: string): Promise<ResolvedPermissions> {
  // Query role assignments at all 3 hierarchy levels
  const [empRoles, teamRoles, deptRoles] = await Promise.all([
    queryByPk(ROLE_ASSIGNMENT_TABLE, `EMP#${empId}`),
    queryByPk(ROLE_ASSIGNMENT_TABLE, `TEAM#${teamId}`),
    queryByPk(ROLE_ASSIGNMENT_TABLE, `DEPT#${deptId}`),
  ]);

  const allRoleNames = [...empRoles, ...teamRoles, ...deptRoles].map(
    (r) => (r.SK as string).replace('ROLE#', '')
  );

  // Fetch role definitions
  const roles = await Promise.all(
    [...new Set(allRoleNames)].map((name) =>
      getItem(ROLE_TABLE, { PK: `ROLE#${name}`, SK: `ROLE#${name}` })
    )
  );

  const permissions = new Set<string>();
  const datasets = new Set<string>();

  for (const role of roles) {
    if (!role) continue;
    for (const p of (role.permissions as string[])) permissions.add(p);
    for (const d of (role.datasets as string[])) datasets.add(d);
  }

  return { permissions, datasets };
}

function canAccess(resolved: ResolvedPermissions, datasetId: string, action: string): boolean {
  if (!resolved.permissions.has(action)) return false;
  if (resolved.datasets.has('*')) return true;
  return resolved.datasets.has(datasetId);
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const claims = verifyToken(event.headers['Authorization'] || event.headers['authorization']);
  if (!claims) return json(401, { error: 'Unauthorized' });

  const { empId, teamId, deptId } = claims;
  const method = event.httpMethod;
  const datasetId = event.pathParameters?.id;

  // GET /datasets — list accessible datasets
  if (event.path === '/datasets' && method === 'GET') {
    const resolved = await resolvePermissions(empId, teamId, deptId);
    if (!resolved.permissions.has('dataset:read')) return json(403, { error: 'Forbidden' });

    // If wildcard access, list all; otherwise list allowed
    if (resolved.datasets.has('*')) {
      const res = await s3.send(new ListObjectsV2Command({ Bucket: DATASET_BUCKET, Delimiter: '/' }));
      const prefixes = (res.CommonPrefixes ?? []).map((p) => p.Prefix?.replace('/', ''));
      return json(200, { datasets: prefixes });
    }
    return json(200, { datasets: [...resolved.datasets] });
  }

  // GET /datasets/{id} — get presigned download URL
  if (datasetId && method === 'GET') {
    const resolved = await resolvePermissions(empId, teamId, deptId);
    if (!canAccess(resolved, datasetId, 'dataset:read')) return json(403, { error: 'Forbidden' });

    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: DATASET_BUCKET, Key: `${datasetId}/data`,
    }), { expiresIn: 3600 });
    return json(200, { datasetId, downloadUrl: url });
  }

  // PUT /datasets/{id} — get presigned upload URL
  if (datasetId && method === 'PUT') {
    const resolved = await resolvePermissions(empId, teamId, deptId);
    if (!canAccess(resolved, datasetId, 'dataset:write')) return json(403, { error: 'Forbidden' });

    const url = await getSignedUrl(s3, new PutObjectCommand({
      Bucket: DATASET_BUCKET, Key: `${datasetId}/data`,
    }), { expiresIn: 3600 });
    return json(200, { datasetId, uploadUrl: url });
  }

  return json(404, { error: 'Not found' });
}
