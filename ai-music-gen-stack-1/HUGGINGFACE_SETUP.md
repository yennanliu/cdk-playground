# Hugging Face API Setup Guide

## Why Hugging Face?

✅ **FREE tier** - No credit card required
✅ **No billing** - Completely free for reasonable usage
✅ **Same model** - Uses Facebook's MusicGen
✅ **Fast** - Usually responds in 10-30 seconds
✅ **Reliable** - Hosted by Hugging Face

## Quick Setup (2 minutes)

### Step 1: Get API Token

1. Go to https://huggingface.co/settings/tokens
2. Sign up (free) if needed
3. Click **"New token"**
4. Name it: `music-gen-api`
5. Access: **Read** (default is fine)
6. Click **"Generate token"**
7. Copy your token (starts with `hf_...`)

### Step 2: Set Environment Variable

```bash
# Replace YOUR_HF_TOKEN with your actual token
aws lambda update-function-configuration \
  --function-name AiMusicGenStack1Stack-GenerateMusicFunction34CAECA-rCvg3diSIAuQ \
  --environment Variables="{HUGGINGFACE_API_TOKEN=YOUR_HF_TOKEN,MUSIC_BUCKET_NAME=ai-music-gen-187326049035-ap-northeast-1}"
```

### Step 3: Test!

```bash
curl -X POST "https://23kmqjsyka.execute-api.ap-northeast-1.amazonaws.com/prod/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "energetic rock music with electric guitar",
    "duration": 30,
    "genre": "rock"
  }'
```

## First Request Note

⚠️ **Model Loading**: The first request might take 20-60 seconds as the model loads into memory ("cold start").

If you see an error like:
```
"Model is loading. Estimated time: 20 seconds"
```

Just wait ~30 seconds and try again. Subsequent requests will be much faster!

## API Comparison

| Feature | Hugging Face | Replicate |
|---------|--------------|-----------|
| **Cost** | ✅ FREE | ❌ Paid ($0.005-0.02/request) |
| **Setup** | ✅ Token only | ❌ Requires billing |
| **Speed** | 🟡 10-30s (after warmup) | ✅ 10-20s |
| **Model** | facebook/musicgen-small | facebook/musicgen-large |
| **Quality** | 🟡 Good | ✅ Better |
| **Limits** | Rate limited (fair use) | Pay-per-use |
| **Cold Start** | ⚠️ 20-60s first time | ✅ No cold start |

## Models Available

The Lambda automatically uses:
- **facebook/musicgen-small** (default, fastest, free)

You can modify the code to use:
- `facebook/musicgen-medium` (better quality, slower)
- `facebook/musicgen-large` (best quality, slowest)

Edit line 174 in `lambda/generate-music/index.ts`:
```typescript
path: '/models/facebook/musicgen-medium',  // Change model here
```

## Rate Limits

Hugging Face free tier has fair-use rate limits:
- ~10-20 requests per minute
- ~1000 requests per month

For higher usage, consider:
1. Upgrade to Hugging Face Pro ($9/month)
2. Use Replicate (pay-per-use)
3. Deploy on SageMaker (AWS-native)

## Troubleshooting

### "Model is currently loading"
Wait 30-60 seconds and retry. First request wakes up the model.

### "Rate limit exceeded"
You've hit the free tier limit. Wait a few minutes or upgrade.

### "Invalid token"
Check your token:
1. Starts with `hf_`
2. Has Read access
3. Is active (not revoked)

### Timeout after 29 seconds
API Gateway times out. The music is still being generated!
- Check CloudWatch logs
- Music may still appear in S3
- Consider implementing async architecture (see LIMITATIONS.md)

## Example Prompts

```bash
# Electronic Dance Music
curl -X POST $ENDPOINT -d '{"prompt": "upbeat techno with heavy bass", "genre": "electronic"}'

# Rock
curl -X POST $ENDPOINT -d '{"prompt": "powerful guitar riffs with drums", "genre": "rock"}'

# Classical
curl -X POST $ENDPOINT -d '{"prompt": "peaceful piano melody", "genre": "classical"}'

# Jazz
curl -X POST $ENDPOINT -d '{"prompt": "smooth saxophone with walking bass", "genre": "jazz"}'

# Lo-fi
curl -X POST $ENDPOINT -d '{"prompt": "chill beats with vinyl crackle", "genre": "lofi"}'
```

## Pro Tips

1. **Be specific**: "Fast tempo rock with electric guitar solo" > "rock music"
2. **Genre helps**: Always include genre parameter for better results
3. **Keep it short**: 30 seconds is optimal for free tier
4. **Warm up**: First request is slow, subsequent ones are fast
5. **Cache prompts**: Popular prompts can be pre-generated and cached

## Next Steps

- ✅ Get token from Hugging Face
- ✅ Set environment variable
- ✅ Test with sample prompt
- 🎵 Generate music!

Need help? Check the logs:
```bash
aws logs tail /aws/lambda/AiMusicGenStack1Stack-GenerateMusicFunction34CAECA-rCvg3diSIAuQ --follow
```
