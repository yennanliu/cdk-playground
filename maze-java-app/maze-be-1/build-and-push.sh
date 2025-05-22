#!/bin/bash
set -e

# Set Java 17 as the Java version to use
export JAVA_HOME="/Users/yennanliu/Library/Java/JavaVirtualMachines/corretto-17.0.8/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"

echo "Using Java version:"
java -version

# Build the Spring Boot application
./mvnw clean package -DskipTests

# Build the Docker image for AMD64 platform (standard EC2 instances)
docker buildx build --platform=linux/amd64 -t yennanliu/maze-app:latest .

# Push the image to Docker Hub
docker push yennanliu/maze-app:latest

echo "Image built and pushed successfully!" 