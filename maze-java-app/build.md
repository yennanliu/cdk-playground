# Build

## Cmd

```bash

# compile java code to jar
mvn clean package


mvn clean package -DskipTests


# Step 1: Build the image
docker build -t maze-app:m4-air-1 .

# Step 2: Tag the image for Docker Hub (correctly)
docker tag maze-app:m4-air-1 yennanliu/maze-app:m4-air-1

# Step 3: Push the tagged image to Docker Hub
docker push yennanliu/maze-app:m4-air-1
```