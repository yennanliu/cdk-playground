package com.yen.maze_be_1.utils;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.List;

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
        path.setLength(path.length() - 7); // Remove last " -> "
        pathCoordinates.remove(pathCoordinates.size() - 1); // Remove the last coordinate
        logger.trace("Backtracking from ({},{})", x, y);
        visited[x][y] = false;
        return false;
    }
} 