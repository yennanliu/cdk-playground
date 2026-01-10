# Quick Start Guide

Deploy and test your AI Music Generation stack in 5 minutes.

## Step 1: Install Dependencies

```bash
npm install
cd lambda/generate-music && npm install && cd ../..
```

## Step 2: Compile Lambda Code

```bash
cd lambda/generate-music
npx tsc
cd ../..
```

## Step 3: Build CDK

```bash
npm run build
```

## Step 4: Deploy

```bash
# First time only - bootstrap CDK
cdk bootstrap

# Deploy the stack
cdk deploy
```

Save the outputs from the deployment:
- `GenerateEndpoint`: Your API endpoint URL

## Step 5: Test (Mock Mode)

Without Replicate API token, test the infrastructure:

```bash
./test-api.sh <YOUR_GENERATE_ENDPOINT>
```

This will create silent WAV files in S3 to verify everything works.

## Step 6: Add Replicate API Token (Optional)

To generate real music:

1. Sign up at https://replicate.com
2. Get your API token
3. Update Lambda environment:

```bash
# Get the Lambda function name
aws lambda list-functions | grep GenerateMusicFunction

# Update environment variable
aws lambda update-function-configuration \
  --function-name <YourStackName-GenerateMusicFunction-XXXXX> \
  --environment Variables="{REPLICATE_API_TOKEN=your_token_here,MUSIC_BUCKET_NAME=your_bucket_name}"
```

4. Test again:

```bash
./test-api.sh <YOUR_GENERATE_ENDPOINT>
```

## Example Usage

```bash
curl -X POST https://xxxxx.execute-api.us-east-1.amazonaws.com/prod/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "upbeat electronic dance music",
    "duration": 30,
    "genre": "electronic"
  }'
```

Response:
```json
{
  "message": "Music generated successfully",
  "s3_url": "https://ai-music-gen-xxxxx.s3.amazonaws.com/music/abc-123.wav",
  "file_key": "music/abc-123.wav",
  "prompt": "electronic music: upbeat electronic dance music",
  "duration": 30
}
```

Download and play:
```bash
curl -o music.wav "https://ai-music-gen-xxxxx.s3.amazonaws.com/music/abc-123.wav"
open music.wav  # macOS
# or
xdg-open music.wav  # Linux
```

## Clean Up

```bash
cdk destroy
```

## Troubleshooting

### "Cannot find module" errors during Lambda compilation
```bash
cd lambda/generate-music
npm install
cd ../..
```

### CDK build errors
```bash
npm run clean
npm run build
```

### Lambda timeout in mock mode
Mock generation should be instant. If you see timeouts, check CloudWatch logs:
```bash
aws logs tail /aws/lambda/<YourFunctionName> --follow
```

### 403 Forbidden on S3 URL
The bucket is not public by default. Update bucket policy or use pre-signed URLs:
```bash
aws s3 presign s3://your-bucket-name/music/file.wav --expires-in 3600
```

## Next Steps

- Add authentication (API Gateway API Keys)
- Implement async processing for longer songs
- Add CloudFront for better audio delivery
- Create a web UI for the API
- Monitor costs with AWS Cost Explorer
