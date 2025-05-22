package com.yen.maze_be_1.controller;

import com.yen.maze_be_1.model.Maze;
import com.yen.maze_be_1.service.MazeService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.HashMap;
import java.util.ArrayList;

@RestController
@RequestMapping("/api/maze")
@CrossOrigin(origins = "*")
public class MazeController {

    private static final Logger logger = LoggerFactory.getLogger(MazeController.class);

    @Autowired
    private MazeService mazeService;

    @PostMapping("/generate")
    public ResponseEntity<Maze> generateMaze(@RequestBody Map<String, Integer> request) {
        int width = request.get("width");
        int height = request.get("height");
        
        logger.info("Generating maze with dimensions: {}x{}", width, height);
        
        // Generate maze using existing logic
        int[][] maze = generateMazeArray(width, height);
        
        // Create and save maze entity
        Maze mazeEntity = new Maze();
        mazeEntity.setName("Maze " + System.currentTimeMillis());
        mazeEntity.setWidth(width);
        mazeEntity.setHeight(height);
        mazeEntity.setMazeData(convertMazeToString(maze));
        
        logger.debug("Maze generated successfully");
        //return ResponseEntity.ok(mazeService.saveMaze(mazeEntity));
        return ResponseEntity.ok(mazeEntity);
    }

    @PostMapping("/save")
    public ResponseEntity<Maze> saveMaze(@RequestBody Map<String, Object> request) {
        String name = (String) request.get("name");
        int width = (int) request.get("width");
        int height = (int) request.get("height");
        String mazeData = (String) request.get("mazeData");
        
        logger.info("Saving maze: {}, dimensions: {}x{}", name, width, height);
        
        Maze mazeEntity = new Maze();
        mazeEntity.setName(name);
        mazeEntity.setWidth(width);
        mazeEntity.setHeight(height);
        mazeEntity.setMazeData(mazeData);
        
        Maze savedMaze = mazeService.saveMaze(mazeEntity);
        logger.info("Maze saved with ID: {}", savedMaze.getId());
        
        return ResponseEntity.ok(savedMaze);
    }

    @PostMapping("/solve")
    public ResponseEntity<Map<String, Object>> solveMaze(@RequestBody Map<String, List<List<Integer>>> request) {
        List<List<Integer>> mazeList = request.get("maze");
        int rows = mazeList.size();
        int cols = mazeList.get(0).size();
        
        logger.info("Attempting to solve maze: {}x{}", rows, cols);
        
        // Convert List<List<Integer>> to int[][]
        int[][] maze = new int[rows][cols];
        for (int i = 0; i < rows; i++) {
            for (int j = 0; j < cols; j++) {
                maze[i][j] = mazeList.get(i).get(j);
            }
        }

        boolean[][] visited = new boolean[rows][cols];
        StringBuilder path = new StringBuilder();
        List<int[]> pathCoordinates = new ArrayList<>();

        Map<String, Object> response = new HashMap<>();
        
        if (dfs(maze, 0, 0, rows, cols, visited, path, pathCoordinates)) {
            logger.info("Maze solved successfully");
            
            // Create visual representation of solved maze
            int[][] solvedMaze = new int[rows][cols];
            for (int i = 0; i < rows; i++) {
                for (int j = 0; j < cols; j++) {
                    solvedMaze[i][j] = maze[i][j];
                }
            }
            
            // Mark path with special value 2
            for (int[] coord : pathCoordinates) {
                solvedMaze[coord[0]][coord[1]] = 2;  // 2 represents path
            }
            
            response.put("solved", true);
            response.put("path", path.toString());
            response.put("solvedMaze", solvedMaze);
            response.put("message", "Maze solved successfully");
            
            return ResponseEntity.ok(response);
        } else {
            logger.warn("Maze could not be solved");
            
            response.put("solved", false);
            response.put("message", "Maze cannot be solved");
            
            return ResponseEntity.ok(response);
        }
    }

    @GetMapping
    public ResponseEntity<List<Maze>> getAllMazes() {
        logger.info("Retrieving all mazes");
        List<Maze> mazes = mazeService.getAllMazes();
        logger.debug("Retrieved {} mazes", mazes.size());
        return ResponseEntity.ok(mazes);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Maze> getMazeById(@PathVariable Long id) {
        logger.info("Retrieving maze with ID: {}", id);
        return mazeService.getMazeById(id)
                .map(maze -> {
                    logger.debug("Found maze: {}", maze.getName());
                    return ResponseEntity.ok(maze);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteMaze(@PathVariable Long id) {
        logger.info("Deleting maze with ID: {}", id);
        mazeService.deleteMaze(id);
        logger.debug("Maze deleted successfully");
        return ResponseEntity.ok().build();
    }

    // Existing maze generation methods
    private int[][] generateMazeArray(int width, int height) {
        logger.debug("Generating maze array with dimensions: {}x{}", width, height);
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

    private boolean dfs(int[][] maze, int x, int y, int rows, int cols, boolean[][] visited, 
                         StringBuilder path, List<int[]> pathCoordinates) {
        if (x < 0 || y < 0 || x >= rows || y >= cols || maze[x][y] == 1 || visited[x][y]) {
            return false;
        }

        if (x == rows - 1 && y == cols - 1) {
            path.append("(").append(x).append(",").append(y).append(")");
            pathCoordinates.add(new int[]{x, y});
            logger.trace("Found path to exit at ({},{})", x, y);
            return true;
        }

        visited[x][y] = true;
        path.append("(").append(x).append(",").append(y).append(") -> ");
        pathCoordinates.add(new int[]{x, y});
        logger.trace("Visiting ({},{})", x, y);

        // Explore all directions: right, down, left, up
        if (dfs(maze, x, y + 1, rows, cols, visited, path, pathCoordinates) ||
            dfs(maze, x + 1, y, rows, cols, visited, path, pathCoordinates) ||
            dfs(maze, x, y - 1, rows, cols, visited, path, pathCoordinates) ||
            dfs(maze, x - 1, y, rows, cols, visited, path, pathCoordinates)) {
            return true;
        }

        // Backtrack
        path.setLength(path.length() - 7); // Remove last " -> "
        pathCoordinates.remove(pathCoordinates.size() - 1); // Remove the last coordinate
        logger.trace("Backtracking from ({},{})", x, y);
        visited[x][y] = false;
        return false;
    }
}