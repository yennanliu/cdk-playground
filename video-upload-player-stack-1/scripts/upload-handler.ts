import { CloudFormationCustomResourceEvent } from 'aws-lambda';
import * as s3 from 'aws-sdk/clients/s3';
import * as fs from 'fs';
import * as path from 'path';

const s3Client = new s3();

export const handler = async (event: CloudFormationCustomResourceEvent) => {
    const bucketName = process.env.BUCKET_NAME;
    if (!bucketName) {
        throw new Error('BUCKET_NAME environment variable is required');
    }

    const frontendDir = path.join(__dirname, '../frontend');
    const files = fs.readdirSync(frontendDir);

    for (const file of files) {
        const filePath = path.join(frontendDir, file);
        const fileContent = fs.readFileSync(filePath);

        // Determine content type
        let contentType = 'application/octet-stream';
        if (file.endsWith('.html')) {
            contentType = 'text/html';
        } else if (file.endsWith('.css')) {
            contentType = 'text/css';
        } else if (file.endsWith('.js')) {
            contentType = 'application/javascript';
        } else if (file.endsWith('.json')) {
            contentType = 'application/json';
        } else if (file.endsWith('.png')) {
            contentType = 'image/png';
        } else if (file.endsWith('.jpg') || file.endsWith('.jpeg')) {
            contentType = 'image/jpeg';
        } else if (file.endsWith('.gif')) {
            contentType = 'image/gif';
        } else if (file.endsWith('.svg')) {
            contentType = 'image/svg+xml';
        }

        try {
            await s3Client.putObject({
                Bucket: bucketName,
                Key: file,
                Body: fileContent,
                ContentType: contentType,
                CacheControl: 'max-age=31536000', // 1 year cache for static assets
                ACL: 'public-read'
            }).promise();

            console.log(`Uploaded ${file} to S3 with content type ${contentType}`);
        } catch (error) {
            console.error(`Error uploading ${file}:`, error);
            throw error;
        }
    }

    // Verify the upload
    try {
        const objects = await s3Client.listObjects({
            Bucket: bucketName
        }).promise();

        console.log('\nUploaded files:');
        objects.Contents?.forEach(obj => {
            console.log(`- ${obj.Key} (${obj.Size} bytes)`);
        });
    } catch (error) {
        console.error('Error listing bucket contents:', error);
        throw error;
    }

    return {
        PhysicalResourceId: 'FrontendUpload',
        Data: {
            Message: 'Frontend files uploaded successfully'
        }
    };
}; 