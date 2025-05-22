package com.yen.maze_be_1;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Random;

@SpringBootApplication
public class MazeBe1Application {

	public static void main(String[] args) {
		SpringApplication.run(MazeBe1Application.class, args);
	}

}
