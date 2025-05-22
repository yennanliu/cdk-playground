package com.yen.maze_be_1;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class MazeBe1Application {
	
	private static final Logger logger = LoggerFactory.getLogger(MazeBe1Application.class);

	public static void main(String[] args) {
		logger.info("Starting Maze Application");
		SpringApplication.run(MazeBe1Application.class, args);
		logger.info("Maze Application started successfully");
	}

}
