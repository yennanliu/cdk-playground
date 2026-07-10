# Simple AI Music Generation Architecture

## Minimal Design

```
┌─────────────┐      ┌──────────────┐      ┌─────────────────┐
│   API GW    │─────▶│   Lambda     │─────▶│   SageMaker     │
│  POST /gen  │      │  (Trigger)   │      │   Endpoint      │
└─────────────┘      └──────────────┘      │  (MusicGen)     │
                                            └─────────────────┘
                                                     │
                                                     ▼
                                            ┌─────────────────┐
                                            │   S3 Bucket     │
                                            │  music-output/  │
                                            └─────────────────┘
```

## Components

1. **API Gateway**: Single POST endpoint `/generate`
2. **Lambda Function**: Receives prompt, calls SageMaker, saves to S3
3. **SageMaker Endpoint**: Hosts MusicGen model (from HuggingFace/AWS Marketplace)
4. **S3 Bucket**: Stores generated audio files

## Request Flow

```json
POST /generate
{
  "prompt": "upbeat electronic dance music with heavy bass",
  "duration": 30
}

Response:
{
  "s3_url": "s3://bucket/music-output/abc123.wav",
  "public_url": "https://bucket.s3.amazonaws.com/music-output/abc123.wav"
}
```

## Model Options

### Option 1: SageMaker with HuggingFace MusicGen (Recommended)
- Model: `facebook/musicgen-small` or `facebook/musicgen-medium`
- Instance: `ml.g4dn.xlarge` (~$0.736/hour)
- Generation time: 30-60 seconds per track
- Quality: Good for 30s clips

### Option 2: Lambda Container with Lightweight Model
- Model: MusicGen-small (CPU optimized)
- Memory: 10GB
- Timeout: 15 minutes
- Cost: Pay per execution only
- Quality: Lower, slower, but no idle costs

## Cost Breakdown

**SageMaker Approach:**
- Endpoint: $0.736/hour (24/7) = ~$530/month idle
- Or: Use Serverless Inference (no idle cost)
- S3: ~$0.023/GB/month
- API Gateway: $3.50/million requests

**Serverless Inference (Better):**
- No idle costs
- $0.20 per inference hour
- ~$0.05-0.10 per generation
- Auto-scales to zero

## CDK Implementation

```typescript
// Minimal stack with 3 constructs:
1. S3 Bucket (public read)
2. SageMaker Serverless Endpoint (MusicGen)
3. Lambda + API Gateway (orchestrator)
```

## No Status Tracking Needed

- Synchronous: Lambda waits for generation, returns S3 URL immediately
- Simple: No job tracking, no DynamoDB, no polling
- Fast: 30-60 second response time acceptable

## Trade-offs

**Pros:**
- Minimal architecture (3 AWS services)
- No operational complexity
- Pay-per-use with Serverless Inference
- Easy to understand and maintain

**Cons:**
- Limited to ~30-60 second audio clips
- Client must wait for response (1-2 min)
- For longer music, need to chain multiple calls
