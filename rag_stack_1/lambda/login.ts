// POST /login — checks the shared password and mints a short-lived HMAC token.
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import * as crypto from 'crypto';

const sm = new SecretsManagerClient({});
let cached: { password: string; signingKey: string } | undefined;

const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12h

async function getSecret() {
  if (!cached) {
    const res = await sm.send(new GetSecretValueCommand({ SecretId: process.env.SECRET_ARN! }));
    cached = JSON.parse(res.SecretString!);
  }
  return cached!;
}

export async function handler(event: any) {
  let password: string | undefined;
  try { password = JSON.parse(event.body ?? '{}').password; } catch { /* ignore */ }

  const secret = await getSecret();
  if (!password || password !== secret.password) {
    return resp(401, { error: 'invalid password' });
  }

  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const sig = crypto.createHmac('sha256', secret.signingKey).update(String(exp)).digest('hex');
  return resp(200, { token: `${exp}.${sig}`, expiresAt: exp });
}

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
