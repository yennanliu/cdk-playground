# AWS System Design for 24/7 YouTube Music Streaming

## Overview

This document describes the system architecture for running a 24/7 music streaming service on YouTube using AWS infrastructure.

## Architecture Diagram

```
┌─────────────┐
│  S3 Bucket  │ ──► Music files + background image
└─────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│   ECS Fargate Task (FFmpeg)          │
│   - Loop through playlist            │
│   - Encode audio + static image      │
│   - Stream to YouTube RTMP           │
└──────────────────────────────────────┘
       │
       ▼
┌─────────────────┐
│ Secrets Manager │ ──► YouTube stream key
└─────────────────┘
       │
       ▼
┌─────────────────┐
│   CloudWatch    │ ──► Monitoring & logs
└─────────────────┘
```

## Recommended Solution: ECS Fargate + FFmpeg

### Key Components

#### 1. ECS Fargate Task
- **Purpose**: Run FFmpeg container serverless
- **Benefits**:
  - No EC2 instance management
  - Auto-restart on failure
  - Pay only for runtime
  - Integrated with AWS ecosystem
- **Configuration**:
  - Task CPU: 512-1024 (0.5-1 vCPU)
  - Task Memory: 1024-2048 MB
  - Desired count: 1
  - Auto-restart policy enabled

#### 2. S3 Bucket
- **Purpose**: Store media assets
- **Contents**:
  - Music library (MP3/WAV files)
  - Background image/video for visual stream
  - Optional: Playlist configuration files
- **Access**: ECS task IAM role with S3 read permissions

#### 3. FFmpeg Streaming Container
- **Base Image**: `jrottenberg/ffmpeg` or custom image
- **Streaming Command**:
```bash
ffmpeg -re -stream_loop -1 \
  -i "concat:song1.mp3|song2.mp3|song3.mp3" \
  -i background.jpg \
  -c:v libx264 -preset veryfast -b:v 2000k \
  -c:a aac -b:a 128k \
  -f flv rtmp://a.rtmp.youtube.com/live2/${YOUTUBE_STREAM_KEY}
```

- **Parameters Explained**:
  - `-re`: Read input at native frame rate
  - `-stream_loop -1`: Loop indefinitely
  - `-c:v libx264`: H.264 video codec
  - `-preset veryfast`: Encoding speed/quality tradeoff
  - `-b:v 2000k`: Video bitrate (2 Mbps)
  - `-c:a aac`: AAC audio codec
  - `-b:a 128k`: Audio bitrate (128 kbps)
  - `-f flv`: Flash Video format for RTMP

#### 4. AWS Secrets Manager
- **Purpose**: Securely store YouTube stream key
- **Secret Format**:
```json
{
  "youtube_stream_key": "xxxx-xxxx-xxxx-xxxx"
}
```
- **Access**: ECS task IAM role with secrets read permission
- **Injection**: Environment variable in ECS task definition

#### 5. CloudWatch
- **Logs**: ECS task stdout/stderr for debugging
- **Metrics**:
  - CPU/Memory utilization
  - Task health status
- **Alarms**:
  - Task stopped/failed
  - High CPU/memory usage
  - Network errors

#### 6. VPC & Networking
- **VPC**: Default or custom VPC
- **Subnets**: Public subnet with internet gateway (for RTMP egress)
- **Security Group**: Allow outbound to YouTube RTMP (port 1935)

## Data Flow

1. ECS Fargate task starts
2. Task retrieves YouTube stream key from Secrets Manager
3. Task downloads music files from S3 bucket
4. FFmpeg encodes audio with static background image
5. Stream pushed to YouTube RTMP endpoint
6. YouTube processes and broadcasts stream
7. On failure, ECS auto-restarts the task
8. CloudWatch captures logs and metrics

## YouTube RTMP Configuration

### Stream Endpoints
- **Primary**: `rtmp://a.rtmp.youtube.com/live2/[stream-key]`
- **Backup**: `rtmp://b.rtmp.youtube.com/live2?backup=1/[stream-key]`

### Recommended Settings
- **Video Codec**: H.264
- **Video Bitrate**: 1500-4000 kbps (1080p: 3000-4000 kbps, 720p: 1500-2500 kbps)
- **Resolution**: 1920x1080 or 1280x720
- **Frame Rate**: 30 fps
- **Audio Codec**: AAC
- **Audio Bitrate**: 128 kbps
- **Audio Sample Rate**: 48 kHz

## Cost Estimation

### ECS Fargate (24/7)
- vCPU: 0.5 vCPU × $0.04048/hour × 730 hours = ~$14.77/month
- Memory: 1 GB × $0.004445/hour × 730 hours = ~$3.24/month
- **Total Compute**: ~$18/month

### S3 Storage
- 10 GB music library: ~$0.23/month
- Data transfer to internet: ~$0.09/GB (minimal for metadata)

### Secrets Manager
- 1 secret: $0.40/month

### CloudWatch Logs
- ~1 GB logs: ~$0.50/month

### Total Monthly Cost: ~$20-25/month

## Alternative Architectures

### Option 2: EC2 Spot Instance

**Architecture**:
```
┌─────────┐
│   S3    │ ──► Music files
└─────────┘
     │
     ▼
┌──────────────────┐
│  EC2 Spot (t3a)  │
│  - systemd       │
│  - FFmpeg        │
└──────────────────┘
     │
     ▼
┌────────────┐
│  YouTube   │
└────────────┘
```

**Pros**:
- More stable (less interruptions)
- Lower cost (~$5-10/month with spot)
- Direct control over streaming process

**Cons**:
- Manual instance management
- Need to handle spot interruptions
- More operational overhead

### Option 3: AWS MediaLive (Enterprise)

**Architecture**:
```
┌─────┐     ┌─────────────┐     ┌──────────────┐     ┌─────────┐
│ S3  │ ──► │ MediaLive   │ ──► │ MediaPackage │ ──► │ YouTube │
└─────┘     └─────────────┘     └──────────────┘     └─────────┘
```

**Pros**:
- Professional-grade streaming
- Fully managed AWS service
- Advanced features (failover, redundancy)

**Cons**:
- Very expensive (~$200-300/month)
- Overkill for simple use case

## Deployment Strategy

### Prerequisites
1. YouTube account with live streaming enabled
2. YouTube stream key from YouTube Studio
3. Music files prepared and uploaded to S3
4. Background image/video prepared

### Deployment Steps
1. Create S3 bucket and upload music files
2. Store YouTube stream key in Secrets Manager
3. Build and push FFmpeg Docker image to ECR
4. Deploy ECS cluster and task definition via CDK
5. Start ECS service
6. Monitor CloudWatch logs
7. Verify stream on YouTube

## Monitoring & Maintenance

### Health Checks
- ECS task health status
- CloudWatch log analysis for FFmpeg errors
- YouTube stream health in YouTube Studio

### Common Issues & Solutions
| Issue | Solution |
|-------|----------|
| Stream disconnects | ECS auto-restart handles this |
| Poor video quality | Increase bitrate in FFmpeg command |
| High costs | Use Spot instances or optimize container resources |
| Music repetition | Implement playlist randomization |
| Copyright strikes | Use royalty-free music only |

### Scaling Considerations
- **Multiple streams**: Deploy multiple ECS tasks with different stream keys
- **Different regions**: Deploy to multiple AWS regions for redundancy
- **Dynamic playlists**: Use Lambda to update playlist from S3

## Security Best Practices

1. **Stream Key Protection**:
   - Never hardcode stream keys
   - Use Secrets Manager with rotation
   - Restrict IAM permissions

2. **S3 Bucket**:
   - Enable encryption at rest
   - Restrict public access
   - Use VPC endpoints for ECS access

3. **Network**:
   - Use security groups to limit outbound traffic
   - Consider NAT Gateway for private subnet deployment

4. **IAM**:
   - Least privilege principle
   - Separate roles for ECS task and execution

## Future Enhancements

1. **Dynamic Playlist**: Lambda function to update music rotation
2. **Visualization**: Add audio visualizer or animated background
3. **Chat Integration**: Lambda + API Gateway for YouTube chat interaction
4. **Analytics**: Store stream metrics in DynamoDB
5. **Multi-platform**: Extend to Twitch, Facebook Live
6. **Failover**: Secondary stream with different encoder settings

## Conclusion

The **ECS Fargate + FFmpeg** approach provides the best balance of:
- Simplicity (minimal components)
- Cost-effectiveness (~$20-25/month)
- Reliability (auto-restart)
- Maintainability (managed service)

This architecture is production-ready for a 24/7 YouTube music streaming service while keeping infrastructure simple and elegant.
