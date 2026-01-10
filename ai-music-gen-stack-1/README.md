# AI Music Generation Stack

A simple and elegant AWS CDK stack for generating AI music using Replicate's MusicGen API.

## Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────────┐
│   API GW    │─────▶│   Lambda     │─────▶│  Replicate API  │
│  POST /gen  │      │  (Trigger)   │      │   (MusicGen)    │
└─────────────┘      └──────────────┘      └─────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   S3 Bucket     │
                    │  music-output/  │
                    └─────────────────┘
```

## Components

1. **API Gateway**: Single POST endpoint `/generate`
2. **Lambda Function**: Orchestrates music generation and S3 storage
3. **S3 Bucket**: Stores generated audio files
4. **Replicate API**: External AI music generation service

## Prerequisites

- AWS CLI configured
- Node.js 18+ and npm
- AWS CDK CLI installed (`npm install -g aws-cdk`)
- Replicate API token (get one at https://replicate.com)

## Setup

### 1. Install Dependencies

```bash
# Install CDK dependencies
npm install

# Install Lambda dependencies
cd lambda/generate-music
npm install
cd ../..
```

### 2. Compile Lambda Function

```bash
cd lambda/generate-music
npx tsc
cd ../..
```

### 3. Set Environment Variable

You need to set your Replicate API token. You can either:

**Option A: Set as environment variable before deployment**
```bash
export REPLICATE_API_TOKEN=your_token_here
```

**Option B: Update the Lambda environment in the stack after deployment**
```bash
aws lambda update-function-configuration \
  --function-name <FunctionName> \
  --environment Variables={REPLICATE_API_TOKEN=your_token_here,MUSIC_BUCKET_NAME=bucket_name}
```

### 4. Deploy

```bash
# Bootstrap CDK (first time only)
cdk bootstrap

# Deploy the stack
cdk deploy
```

After deployment, you'll see outputs:
- **ApiUrl**: Base URL for the API
- **GenerateEndpoint**: Full URL for the /generate endpoint
- **MusicBucketName**: Name of the S3 bucket

## Usage

### Generate Music

```bash
curl -X POST https://YOUR_API_URL/prod/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "upbeat electronic dance music with heavy bass",
    "duration": 30,
    "genre": "electronic"
  }'
```

### Request Body

```json
{
  "prompt": "description of the music you want",
  "duration": 30,
  "genre": "rock"
}
```

**Fields:**
- `prompt` (required): Description of the music to generate
- `duration` (optional): Length in seconds (default: 30, max: 30 for free tier)
- `genre` (optional): Genre tag to prepend to prompt

### Response

```json
{
  "message": "Music generated successfully",
  "s3_url": "https://ai-music-gen-xxxxx.s3.amazonaws.com/music/uuid.wav",
  "file_key": "music/uuid.wav",
  "prompt": "electronic music: upbeat electronic dance music with heavy bass",
  "duration": 30
}
```

### Example Prompts

```bash
# Rock music
curl -X POST $ENDPOINT -H "Content-Type: application/json" \
  -d '{"prompt": "heavy metal guitar riff with drums", "genre": "rock"}'

# Electronic
curl -X POST $ENDPOINT -H "Content-Type: application/json" \
  -d '{"prompt": "ambient synth pad with soft beats", "genre": "electronic"}'

# Classical
curl -X POST $ENDPOINT -H "Content-Type: application/json" \
  -d '{"prompt": "piano and strings, emotional and calm", "genre": "classical"}'
```

## Mock Mode (Testing without Replicate API)

If you don't set `REPLICATE_API_TOKEN`, the Lambda will generate mock (silent) WAV files for testing:

```bash
cdk deploy  # Deploy without setting token
```

This is useful for:
- Testing the infrastructure
- Validating S3 uploads
- Testing API Gateway integration

## Cost Estimation

- **Replicate API**: ~$0.005-0.02 per 30s generation
- **Lambda**: ~$0.01 per request (15-minute execution)
- **API Gateway**: $3.50 per million requests
- **S3**: ~$0.023/GB/month storage
- **Data Transfer**: ~$0.09/GB out

**Estimated cost per song**: $0.06-0.15

## Development

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run watch
```

### Test

```bash
npm test
```

### Clean Up

```bash
cdk destroy
```

## Troubleshooting

### Lambda timeout

If music generation takes longer than 15 minutes, you'll get a timeout. Consider:
- Using shorter durations
- Implementing async processing with SQS

### API Gateway timeout

API Gateway has a 29-second timeout. For longer generations:
- Lambda processes asynchronously
- Return job ID immediately
- Add a separate endpoint to check status

### Replicate API rate limits

Free tier has rate limits. Consider:
- Adding exponential backoff
- Implementing request queuing
- Upgrading to paid tier

## Future Enhancements

- Add authentication (API keys, Cognito)
- Implement async processing with SQS
- Add job status tracking
- Support longer audio (3-5 minutes)
- Add multiple model support
- Cache popular prompts
- Add CloudFront CDN for audio delivery

## Resources

- [Replicate MusicGen Docs](https://replicate.com/meta/musicgen)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Architecture Design Doc](./AI_MUSIC_GENERATION_DESIGN.md)
- [Simple Architecture Doc](./SIMPLE_ARCHITECTURE.md)
