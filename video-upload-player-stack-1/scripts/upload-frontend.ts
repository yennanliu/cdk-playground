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

        try {
            await s3Client.putObject({
                Bucket: bucketName,
                Key: file,
                Body: fileContent,
                ContentType: file.endsWith('.html') ? 'text/html' : 
                           file.endsWith('.css') ? 'text/css' : 
                           file.endsWith('.js') ? 'application/javascript' : 
                           'application/octet-stream'
            }).promise();

            console.log(`Uploaded ${file} to S3`);
        } catch (error) {
            console.error(`Error uploading ${file}:`, error);
        }
    }
}

uploadFrontend().catch(console.error); 