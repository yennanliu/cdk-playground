package com.yen.maze_be_1.controller;

import com.yen.maze_be_1.model.Maze;
import com.yen.maze_be_1.service.MazeService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Random;

@RestController
@RequestMapping("/api/maze")
@CrossOrigin(origins = "*")
public class MazeController {

    @Autowired
    private MazeService mazeService;

    @PostMapping("/generate")
    public ResponseEntity<Maze> generateMaze(@RequestBody Map<String, Integer> request) {
        int width = request.get("width");
        int height = request.get("height");
        
        // Generate maze using existing logic
        int[][] maze = generateMazeArray(width, height);
        
        // Create and save maze entity
        Maze mazeEntity = new Maze();
        mazeEntity.setName("Maze " + System.currentTimeMillis());
        mazeEntity.setWidth(width);
        mazeEntity.setHeight(height);
        mazeEntity.setMazeData(convertMazeToString(maze));
        
        return ResponseEntity.ok(mazeService.saveMaze(mazeEntity));
    }

    @PostMapping("/solve")
    public ResponseEntity<String> solveMaze(@RequestBody Map<String, List<List<Integer>>> request) {
        List<List<Integer>> mazeList = request.get("maze");
        int rows = mazeList.size();
        int cols = mazeList.get(0).size();
        
        // Convert List<List<Integer>> to int[][]
        int[][] maze = new int[rows][cols];
        for (int i = 0; i < rows; i++) {
            for (int j = 0; j < cols; j++) {
                maze[i][j] = mazeList.get(i).get(j);
            }
        }

        boolean[][] visited = new boolean[rows][cols];
        StringBuilder path = new StringBuilder();

        if (dfs(maze, 0, 0, rows, cols, visited, path)) {
            return ResponseEntity.ok("Solved Path: " + path.toString());
        } else {
            return ResponseEntity.ok("Maze cannot be solved.");
        }
    }

    @GetMapping
    public ResponseEntity<List<Maze>> getAllMazes() {
        return ResponseEntity.ok(mazeService.getAllMazes());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Maze> getMazeById(@PathVariable Long id) {
        return mazeService.getMazeById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteMaze(@PathVariable Long id) {
        mazeService.deleteMaze(id);
        return ResponseEntity.ok().build();
    }

    // Existing maze generation methods
    private int[][] generateMazeArray(int width, int height) {
        int[][] maze = new int[height][width];
        Random random = new Random();

        for (int i = 0; i < height; i++) {
            for (int j = 0; j < width; j++) {
                maze[i][j] = random.nextDouble() < 0.7 ? 0 : 1; // 70% chance for space (0), 30% for blocker (1)
            }
        }

        // Ensure start and end points are paths
        maze[0][0] = 0;
        maze[height - 1][width - 1] = 0;

        return maze;
    }

    private String convertMazeToString(int[][] maze) {
        StringBuilder sb = new StringBuilder();
        for (int[] row : maze) {
            for (int cell : row) {
                sb.append(cell);
            }
            sb.append("\n");
        }
        return sb.toString();
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