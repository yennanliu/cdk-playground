# Known Limitations

## API Gateway Timeout (29 seconds)

API Gateway has a **hard limit of 29 seconds** for integration timeouts. This means:

### Mock Mode (Works Fine)
- Instant generation of silent WAV files
- No timeout issues
- Perfect for testing infrastructure

### Real Music Generation (Will Timeout)
- Replicate API typically takes 30s-2 minutes to generate music
- **The API Gateway will timeout after 29 seconds**
- Lambda will continue running in the background
- Music will still be generated and saved to S3
- **But the HTTP response will fail with a timeout error**

## Solutions

### Option 1: Use Async Processing (Recommended)

Modify the architecture to be async:

```
1. POST /generate → Returns job ID immediately
2. Lambda continues processing in background
3. GET /status/{jobId} → Check generation status
4. GET /download/{jobId} → Download completed music
```

This requires:
- DynamoDB table for job tracking
- Additional Lambda functions for status/download endpoints
- More complex but production-ready

### Option 2: Use Lambda Function URL (Simple)

Replace API Gateway with Lambda Function URL:
- No 29-second timeout (up to 15 minutes)
- Simpler architecture
- Synchronous response works

```typescript
// In CDK stack
const fnUrl = generateMusicFn.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.POST],
  },
});

new CfnOutput(this, 'FunctionUrl', {
  value: fnUrl.url,
});
```

### Option 3: Reduce Generation Time

- Use shorter durations (max 30 seconds)
- Use faster models
- Accept timeout but still retrieve from S3 later

## Current Status

The current implementation:
- ✅ Works perfectly in **mock mode**
- ⚠️ Will timeout in **real mode** (but files still generate)
- 💡 For production, implement Option 1 or 2 above

## Testing Real Music Generation

Even with timeout, you can:
1. Make API call (will timeout after 29s)
2. Wait 2-3 minutes
3. Check S3 bucket manually
4. Files will be there if Lambda succeeded

```bash
# List files in bucket
aws s3 ls s3://ai-music-gen-187326049035-ap-northeast-1/music/

# Download a file
aws s3 cp s3://ai-music-gen-187326049035-ap-northeast-1/music/FILE_ID.wav ./music.wav
```

## Recommendation

For MVP testing: **Use Option 2 (Lambda Function URL)** - simplest solution that removes the 29-second limit.
