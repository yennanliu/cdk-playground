// HTTP API Lambda authorizer (SIMPLE response) — validates the HMAC token from /login.
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import * as crypto from 'crypto';

const sm = new SecretsManagerClient({});
let signingKey: string | undefined;

async function getSigningKey() {
  if (!signingKey) {
    const res = await sm.send(new GetSecretValueCommand({ SecretId: process.env.SECRET_ARN! }));
    signingKey = JSON.parse(res.SecretString!).signingKey;
  }
  return signingKey!;
}

export async function handler(event: any) {
  const header: string = event.headers?.authorization ?? event.headers?.Authorization ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  return { isAuthorized: await verify(token) };
}

async function verify(token: string): Promise<boolean> {
  const [expStr, sig] = token.split('.');
  if (!expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;

  const expected = crypto.createHmac('sha256', await getSigningKey()).update(expStr).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
