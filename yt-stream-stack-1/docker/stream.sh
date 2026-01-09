#!/bin/bash

set -e

echo "Starting YouTube streaming service..."
echo "Music Bucket: ${MUSIC_BUCKET}"
echo "AWS Region: ${AWS_REGION}"

# Check if required environment variables are set
if [ -z "$YOUTUBE_STREAM_KEY" ]; then
    echo "ERROR: YOUTUBE_STREAM_KEY is not set"
    exit 1
fi

if [ -z "$MUSIC_BUCKET" ]; then
    echo "ERROR: MUSIC_BUCKET is not set"
    exit 1
fi

# Create local directories
mkdir -p /tmp/music
mkdir -p /tmp/images

echo "Downloading music files from S3..."
aws s3 sync s3://${MUSIC_BUCKET}/music/ /tmp/music/ || true

echo "Downloading background image from S3..."
aws s3 cp s3://${MUSIC_BUCKET}/background.jpg /tmp/images/background.jpg || {
    echo "No background image found, creating a default one..."
    # Create a simple black background if no image exists
    ffmpeg -f lavfi -i color=c=black:s=1280x720:d=1 -frames:v 1 /tmp/images/background.jpg
}

# Count music files
MUSIC_COUNT=$(find /tmp/music -type f \( -name "*.mp3" -o -name "*.wav" -o -name "*.m4a" \) | wc -l)
echo "Found ${MUSIC_COUNT} music files"

if [ "$MUSIC_COUNT" -eq 0 ]; then
    echo "WARNING: No music files found. Creating test tone..."
    # Generate a test tone if no music files exist
    ffmpeg -f lavfi -i "sine=frequency=440:duration=60" -c:a libmp3lame /tmp/music/test-tone.mp3
fi

# Create playlist file with 1000 repetitions for continuous 24/7 streaming
echo "Creating playlist..."
PLAYLIST_FILE="/tmp/playlist.txt"
rm -f $PLAYLIST_FILE

# Repeat the playlist 1000 times to ensure continuous streaming
for i in $(seq 1 1000); do
    find /tmp/music -type f \( -name "*.mp3" -o -name "*.wav" -o -name "*.m4a" \) | sort | while read file; do
        echo "file '$file'" >> $PLAYLIST_FILE
    done
done

echo "Playlist created with $(wc -l < $PLAYLIST_FILE) entries (looped for 24/7 streaming)"

# YouTube RTMP URL
RTMP_URL="rtmp://a.rtmp.youtube.com/live2/${YOUTUBE_STREAM_KEY}"

echo "Starting FFmpeg stream to YouTube..."
echo "Stream will loop indefinitely..."

# Start streaming with FFmpeg in an infinite loop
# -re: Read input at native frame rate
# -f concat: Concatenate input files
# -safe 0: Allow unsafe file paths
# -i: Input playlist
# -loop 1: Loop background image
# -i: Background image input
# -c:v libx264: H.264 video codec
# -preset veryfast: Encoding speed
# -b:v 2000k: Video bitrate
# -maxrate 2000k: Max bitrate
# -bufsize 4000k: Buffer size
# -pix_fmt yuv420p: Pixel format (required for YouTube)
# -g 60: GOP size (2 seconds at 30fps)
# -c:a aac: AAC audio codec
# -b:a 128k: Audio bitrate
# -ar 44100: Audio sample rate
# -f flv: Flash Video format for RTMP

# Infinite loop to restart stream if it stops
while true; do
    echo "Starting stream ($(date))..."

    ffmpeg -re \
        -f concat \
        -safe 0 \
        -i "$PLAYLIST_FILE" \
        -loop 1 \
        -i /tmp/images/background.jpg \
        -c:v libx264 \
        -preset veryfast \
        -b:v 2000k \
        -maxrate 2000k \
        -bufsize 4000k \
        -pix_fmt yuv420p \
        -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
        -g 60 \
        -r 30 \
        -c:a aac \
        -b:a 128k \
        -ar 44100 \
        -ac 2 \
        -f flv \
        "$RTMP_URL"

    EXIT_CODE=$?
    echo "Stream stopped with exit code: $EXIT_CODE"

    # Wait 5 seconds before restarting to avoid hammering YouTube on errors
    echo "Restarting in 5 seconds..."
    sleep 5
done
