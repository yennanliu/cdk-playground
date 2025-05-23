package com.yen.maze_be_1.utils;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.List;
import java.util.Random;
import com.yen.maze_be_1.model.Maze;

public class MazeUtils {
    
    private static final Logger logger = LoggerFactory.getLogger(MazeUtils.class);
    
    public static String convertMazeToString(int[][] maze) {
        StringBuilder sb = new StringBuilder();
        for (int[] row : maze) {
            for (int cell : row) {
                sb.append(cell);
            }
            sb.append("\n");
        }
        return sb.toString();
    }
    
    public static int[][] generateMazeArray(int width, int height) {
        logger.debug("Generating maze array with dimensions: {}x{}", width, height);
        Double SPACE_PCT = 0.7;
        int[][] maze = new int[height][width];
        Random random = new Random();

        for (int i = 0; i < height; i++) {
            for (int j = 0; j < width; j++) {
                maze[i][j] = random.nextDouble() < SPACE_PCT ? 0 : 1; // 70% chance for space (0), 30% for blocker (1)
            }
        }

        // Ensure start and end points are paths
        maze[0][0] = 0;
        maze[height - 1][width - 1] = 0;

        return maze;
    }
    
    public static Maze generateMaze(int width, int height) {
        logger.info("Generating maze with dimensions: {}x{}", width, height);
        
        // Generate maze array
        int[][] mazeArray = generateMazeArray(width, height);
        
        // Create maze entity
        Maze mazeEntity = new Maze();
        mazeEntity.setName("Maze " + System.currentTimeMillis());
        mazeEntity.setWidth(width);
        mazeEntity.setHeight(height);
        mazeEntity.setMazeData(convertMazeToString(mazeArray));
        
        logger.debug("Maze generated successfully");
        return mazeEntity;
    }
    
    public static boolean dfs(int[][] maze, int x, int y, int rows, int cols, boolean[][] visited, 
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
        // When ALL 4 directions fail, we need to undo our changes
        // because this cell is part of a dead-end path.
        int lastArrowIndex = path.lastIndexOf(" -> ");
        if (lastArrowIndex != -1) {
            path.setLength(lastArrowIndex);
        }
        pathCoordinates.remove(pathCoordinates.size() - 1); // Remove the last coordinate
        logger.trace("Backtracking from ({},{})", x, y);
        visited[x][y] = false;
        return false;
    }
} 