# YouTube 24/7 Music Streaming Stack

A simple and elegant AWS CDK stack for running a 24/7 music streaming service on YouTube using ECS Fargate and FFmpeg.

## Architecture

- **S3 Bucket**: Stores music files and background images
- **ECS Fargate**: Runs FFmpeg container serverless
- **Secrets Manager**: Securely stores YouTube stream key
- **CloudWatch Logs**: Monitoring and debugging
- **Default VPC**: Uses existing VPC for simplicity

## Cost

Estimated monthly cost: **$20-25**
- ECS Fargate (24/7): ~$18/month
- S3 Storage: ~$0.23/month
- Secrets Manager: ~$0.40/month
- CloudWatch Logs: ~$0.50/month

## Prerequisites

1. AWS CLI configured with credentials
2. Node.js 18+ and npm installed
3. AWS CDK CLI installed (`npm install -g aws-cdk`)
4. YouTube account with live streaming enabled
5. YouTube stream key from YouTube Studio

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Bootstrap CDK (first-time only)

```bash
cdk bootstrap
```

### 3. Prepare Music Files

Create a folder structure in S3 (will be created after deployment):

```
s3://yt-stream-music-{account}-{region}/
  music/
    song1.mp3
    song2.mp3
    song3.mp3
  background.jpg
```

### 4. Get YouTube Stream Key

1. Go to [YouTube Studio](https://studio.youtube.com)
2. Navigate to **Create** > **Go Live**
3. Select **Stream** settings
4. Copy your **Stream Key** (keep it secret!)

### 5. Deploy the Stack

```bash
# Build TypeScript
npm run build

# Deploy to AWS
cdk deploy
```

After deployment, note the outputs:
- `MusicBucketName`: S3 bucket for uploading music
- `StreamKeySecretArn`: Secret ARN to update with your stream key
- `ClusterName`: ECS cluster name
- `ServiceName`: ECS service name

### 6. Upload Music Files

Upload your music files to the S3 bucket:

```bash
# Get bucket name from CDK output
BUCKET_NAME="yt-stream-music-{account}-{region}"

# Upload music files
aws s3 cp ./music/ s3://${BUCKET_NAME}/music/ --recursive

# Upload background image (1280x720 or 1920x1080 recommended)
aws s3 cp ./background.jpg s3://${BUCKET_NAME}/background.jpg
```

### 7. Update YouTube Stream Key

Update the Secrets Manager secret with your actual YouTube stream key:

```bash
aws secretsmanager update-secret \
  --secret-id youtube-stream-key \
  --secret-string '{"streamKey":"YOUR-YOUTUBE-STREAM-KEY-HERE"}'
```

### 8. Restart ECS Service

After updating the secret, restart the ECS service to pick up the new key:

```bash
aws ecs update-service \
  --cluster yt-stream-cluster \
  --service youtube-streamer-service \
  --force-new-deployment
```

### 9. Verify Stream

1. Check CloudWatch Logs:
```bash
aws logs tail /ecs/youtube-streamer --follow
```

2. Go to YouTube Studio and verify your stream is live

## Management Commands

### View Logs

```bash
# Tail logs in real-time
aws logs tail /ecs/youtube-streamer --follow

# View recent logs
aws logs tail /ecs/youtube-streamer --since 1h
```

### Stop Streaming

```bash
# Set desired count to 0
aws ecs update-service \
  --cluster yt-stream-cluster \
  --service youtube-streamer-service \
  --desired-count 0
```

### Start Streaming

```bash
# Set desired count to 1
aws ecs update-service \
  --cluster yt-stream-cluster \
  --service youtube-streamer-service \
  --desired-count 1
```

### Update Music Library

```bash
# Sync new music files
aws s3 sync ./music/ s3://${BUCKET_NAME}/music/

# Restart service to reload playlist
aws ecs update-service \
  --cluster yt-stream-cluster \
  --service youtube-streamer-service \
  --force-new-deployment
```

### Debug with ECS Exec

```bash
# Get task ID
TASK_ID=$(aws ecs list-tasks \
  --cluster yt-stream-cluster \
  --service-name youtube-streamer-service \
  --query 'taskArns[0]' \
  --output text | cut -d'/' -f3)

# Connect to container
aws ecs execute-command \
  --cluster yt-stream-cluster \
  --task $TASK_ID \
  --container ffmpeg-streamer \
  --interactive \
  --command "/bin/bash"
```

## Updating the Stack

```bash
# Clean old builds
npm run clean

# Build TypeScript
npm run build

# Review changes
cdk diff

# Deploy updates
cdk deploy
```

## Cleanup

To completely remove the stack and all resources:

```bash
# Destroy the stack
cdk destroy

# Optionally, clean local files
npm run clean:all
```

**Note**: The S3 bucket and its contents will be automatically deleted due to `autoDeleteObjects: true`.

## Troubleshooting

### Stream Not Starting

1. Check CloudWatch Logs for errors
2. Verify YouTube stream key is correct
3. Ensure music files are uploaded to S3
4. Check ECS task status

### Stream Disconnects

ECS Fargate automatically restarts the task on failure. Check logs to identify the issue.

### Poor Stream Quality

Modify FFmpeg parameters in `docker/stream.sh`:
- Increase `-b:v` (video bitrate)
- Change `-preset` to `medium` or `slow`
- Increase resolution in background image

### High Costs

- Use Spot instances (requires EC2 instead of Fargate)
- Reduce Fargate CPU/memory allocation
- Optimize log retention period

## Advanced Configuration

### Custom FFmpeg Settings

Edit `docker/stream.sh` to customize:
- Video resolution and bitrate
- Audio bitrate and quality
- GOP size and frame rate
- Add audio visualizer or animated background

### Multiple Streams

Deploy multiple instances of the stack with different stream keys:

```bash
cdk deploy --context streamName=stream1
cdk deploy --context streamName=stream2
```

### Playlist Randomization

Modify `docker/stream.sh` to shuffle the playlist:

```bash
find /tmp/music -type f \( -name "*.mp3" -o -name "*.wav" -o -name "*.m4a" \) | shuf | while read file; do
    echo "file '$file'" >> $PLAYLIST_FILE
done
```

## Architecture Details

For detailed system design documentation, see [doc/system-design.md](doc/system-design.md).

## License

MIT

## Support

For issues or questions, refer to the [troubleshooting section](#troubleshooting) or check CloudWatch Logs for detailed error messages.
