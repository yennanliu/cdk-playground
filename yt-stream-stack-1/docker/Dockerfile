FROM jrottenberg/ffmpeg:4.4-alpine

# Install AWS CLI and required tools
RUN apk add --no-cache \
    aws-cli \
    bash \
    curl

# Create app directory
WORKDIR /app

# Copy streaming script
COPY stream.sh /app/stream.sh
RUN chmod +x /app/stream.sh

# Override entrypoint and run bash script
ENTRYPOINT []
CMD ["/bin/bash", "/app/stream.sh"]
