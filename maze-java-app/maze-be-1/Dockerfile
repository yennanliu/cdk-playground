# Use Amazon Corretto JDK 17 as base image
FROM --platform=linux/amd64 amazoncorretto:17-alpine

# Set the working directory in the container
WORKDIR /app

# Copy the Spring Boot JAR file into the container
COPY target/maze-be-1-0.0.1-SNAPSHOT.jar app.jar

# Expose the port the app runs on
EXPOSE 8080

# Command to run the application
ENTRYPOINT ["java", "-jar", "app.jar"]