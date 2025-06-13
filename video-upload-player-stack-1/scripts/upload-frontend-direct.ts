import * as s3 from 'aws-sdk/clients/s3';
import * as fs from 'fs';
import * as path from 'path';

const s3Client = new s3();

async function uploadFrontend() {
    // Get bucket name from command line argument
    const bucketName = process.argv[2];
    if (!bucketName) {
        console.error('Please provide bucket name as argument');
        console.error('Usage: ts-node upload-frontend-direct.ts <bucket-name>');
        process.exit(1);
    }

    console.log(`Uploading to bucket: ${bucketName}`);

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
        }

        try {
            await s3Client.putObject({
                Bucket: bucketName,
                Key: file,
                Body: fileContent,
                ContentType: contentType,
                CacheControl: 'max-age=31536000'
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