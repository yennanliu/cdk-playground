package com.yen.maze_be_1.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Random;

@RestController
public class MazeController {

    @GetMapping("/generate-maze")
    public int[][] generateMaze(@RequestParam int rows, @RequestParam int cols) {
        int[][] maze = new int[rows][cols];
        Random random = new Random();

        for (int i = 0; i < rows; i++) {
            for (int j = 0; j < cols; j++) {
                maze[i][j] = random.nextInt(2); // 0 for path, 1 for wall
            }
        }

        // Ensure start and end points are paths
        maze[0][0] = 0;
        maze[rows - 1][cols - 1] = 0;

        return maze;
    }
}