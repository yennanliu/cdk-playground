// POST /upload-url — returns a presigned S3 PUT URL so the browser uploads directly to S3.
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({});
const BUCKET = process.env.DOCS_BUCKET!;

export async function handler(event: any) {
  let filename: string | undefined;
  let contentType: string | undefined;
  try {
    const body = JSON.parse(event.body ?? '{}');
    filename = body.filename;
    contentType = body.contentType;
  } catch { /* ignore */ }

  if (!filename) return resp(400, { error: 'filename required' });

  const key = `uploads/${Date.now()}-${sanitize(filename)}`;
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 300 },
  );
  return resp(200, { url, key });
}

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
