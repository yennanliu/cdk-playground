import * as s3 from 'aws-sdk/clients/s3';
import * as fs from 'fs';
import * as path from 'path';

const s3Client = new s3();

async function uploadFrontend() {
    const bucketName = process.env.FRONTEND_BUCKET_NAME;
    if (!bucketName) {
        console.error('FRONTEND_BUCKET_NAME environment variable is required');
        process.exit(1);
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
    }
}

uploadFrontend().catch(console.error); 