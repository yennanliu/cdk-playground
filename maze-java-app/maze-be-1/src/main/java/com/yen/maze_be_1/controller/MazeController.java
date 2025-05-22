package com.yen.maze_be_1.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

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

    @PostMapping("/solve-maze")
    public String solveMaze(@RequestBody int[][] maze) {
        int rows = maze.length;
        int cols = maze[0].length;

        boolean[][] visited = new boolean[rows][cols];
        StringBuilder path = new StringBuilder();

        if (dfs(maze, 0, 0, rows, cols, visited, path)) {
            return "Solved Path: " + path.toString();
        } else {
            return "Maze cannot be solved.";
        }
    }

    private boolean dfs(int[][] maze, int x, int y, int rows, int cols, boolean[][] visited, StringBuilder path) {
        if (x < 0 || y < 0 || x >= rows || y >= cols || maze[x][y] == 1 || visited[x][y]) {
            return false;
        }

        if (x == rows - 1 && y == cols - 1) {
            path.append("(").append(x).append(",").append(y).append(")");
            return true;
        }

        visited[x][y] = true;
        path.append("(").append(x).append(",").append(y).append(") -> ");

        // Explore all directions: right, down, left, up
        if (dfs(maze, x, y + 1, rows, cols, visited, path) ||
            dfs(maze, x + 1, y, rows, cols, visited, path) ||
            dfs(maze, x, y - 1, rows, cols, visited, path) ||
            dfs(maze, x - 1, y, rows, cols, visited, path)) {
            return true;
        }

        // Backtrack
        path.setLength(path.length() - 7); // Remove last " -> "
        visited[x][y] = false;
        return false;
    }
}