#!/bin/bash

# Build the Spring Boot application
# ./mvnw clean package -DskipTests

# Build and push multi-architecture Docker image
docker buildx create --use
docker buildx build --platform linux/amd64,linux/arm64 -t yennanliu/maze-app:latest --push . 