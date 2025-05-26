import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// AWS Lambda function to handle operations
/** NOTE !!! 
     *  
     * AWS CDK expects `lambda code` written in javascript (instead of typescript)
     * so we need to compile the typescript code to javascript first
     * then we are able to refer to the compiled javascript code
     * as below
     * 
     *  1) add `lambda-crudl/tsconfig.lambda.json` 
     *  2) compile the typescript code to javascript : npx tsc -p tsconfig.lambda.json
     *  3) cdk deploy
     */


const s3 = new S3Client({});

export const handler = async (event: any = {}): Promise<any> => {
    const timestamp = new Date().toISOString();
    const bucketName = process.env.BUCKET_NAME;
    const key = `timestamp-${timestamp}.txt`;

    // Save the entire event as the file content (JSON string)
    console.log(`>>> event: ${JSON.stringify(event)}`);
    // const event2 = {
    //     'a': addEventListener, 'b': event, 'c': timestamp, 'd': bucketName, 'e': key, 'f': process.env.BUCKET_NAME
    //     , 'g': process.env.AWS_REGION, 'h': process.env.AWS_LAMBDA_FUNCTION_NAME, 'i': process.env.AWS_LAMBDA_FUNCTION_VERSION
    // };
    const event2 = {
        a: 'addEventListener',
        c: timestamp,
        d: bucketName,
        e: key,
    }
    console.log(`>>> event2: ${JSON.stringify(event2)}`);
    const bodyContent = JSON.stringify(event2);

    const putParams = {
        Bucket: bucketName,
        Key: key,
        Body: bodyContent,
        ContentType: 'application/json',
    };

    try {
        await s3.send(new PutObjectCommand(putParams));
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Content saved', key }),
        };
    } catch (err) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: (err as Error)?.message || String(err) }),
        };
    }
};
