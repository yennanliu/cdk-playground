import { createHmac } from 'crypto';

const SECRET = process.env.JWT_SECRET || 'default-secret-change-me';

interface JwtPayload {
  empId: string;
  teamId: string;
  deptId: string;
  phone: string;
  iat: number;
  exp: number;
}

function base64url(data: string): string {
  return Buffer.from(data).toString('base64url');
}

function sign(payload: object): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verify(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expected = createHmac('sha256', SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  if (signature !== expected) return null;

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as JwtPayload;
  if (payload.exp < Date.now() / 1000) return null;

  return payload;
}

export function issueToken(empId: string, teamId: string, deptId: string, phone: string): string {
  const now = Math.floor(Date.now() / 1000);
  return sign({ empId, teamId, deptId, phone, iat: now, exp: now + 3600 });
}

export function verifyToken(authHeader: string | undefined): JwtPayload | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return verify(authHeader.slice(7));
}
