package com.yen.maze_be_1.utils;

import com.yen.maze_be_1.model.Maze;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@DisplayName("MazeUtils Tests")
class MazeUtilsTest {

    @Nested
    @DisplayName("convertMazeToString Tests")
    class ConvertMazeToStringTests {

        @Test
        @DisplayName("Should convert simple 2x2 maze to string")
        void shouldConvertSimple2x2MazeToString() {
            // Given
            int[][] maze = {
                {0, 1},
                {1, 0}
            };
            
            // When
            String result = MazeUtils.convertMazeToString(maze);
            
            // Then
            String expected = "01\n10\n";
            assertEquals(expected, result);
        }

        @Test
        @DisplayName("Should convert single cell maze to string")
        void shouldConvertSingleCellMazeToString() {
            // Given
            int[][] maze = {{1}};
            
            // When
            String result = MazeUtils.convertMazeToString(maze);
            
            // Then
            assertEquals("1\n", result);
        }

        @Test
        @DisplayName("Should convert 3x3 maze to string")
        void shouldConvert3x3MazeToString() {
            // Given
            int[][] maze = {
                {0, 1, 0},
                {0, 0, 1},
                {1, 0, 0}
            };
            
            // When
            String result = MazeUtils.convertMazeToString(maze);
            
            // Then
            String expected = "010\n001\n100\n";
            assertEquals(expected, result);
        }

        @Test
        @DisplayName("Should handle empty maze")
        void shouldHandleEmptyMaze() {
            // Given
            int[][] maze = {};
            
            // When
            String result = MazeUtils.convertMazeToString(maze);
            
            // Then
            assertEquals("", result);
        }
    }

    @Nested
    @DisplayName("generateMazeArray Tests")
    class GenerateMazeArrayTests {

        @Test
        @DisplayName("Should generate maze with correct dimensions")
        void shouldGenerateMazeWithCorrectDimensions() {
            // Given
            int width = 5;
            int height = 3;
            
            // When
            int[][] maze = MazeUtils.generateMazeArray(width, height);
            
            // Then
            assertEquals(height, maze.length);
            assertEquals(width, maze[0].length);
        }

        @Test
        @DisplayName("Should ensure start point is path (0)")
        void shouldEnsureStartPointIsPath() {
            // Given
            int width = 4;
            int height = 4;
            
            // When
            int[][] maze = MazeUtils.generateMazeArray(width, height);
            
            // Then
            assertEquals(0, maze[0][0], "Start point should be a path (0)");
        }

        @Test
        @DisplayName("Should ensure end point is path (0)")
        void shouldEnsureEndPointIsPath() {
            // Given
            int width = 4;
            int height = 4;
            
            // When
            int[][] maze = MazeUtils.generateMazeArray(width, height);
            
            // Then
            assertEquals(0, maze[height-1][width-1], "End point should be a path (0)");
        }

        @Test
        @DisplayName("Should generate 1x1 maze")
        void shouldGenerate1x1Maze() {
            // Given
            int width = 1;
            int height = 1;
            
            // When
            int[][] maze = MazeUtils.generateMazeArray(width, height);
            
            // Then
            assertEquals(1, maze.length);
            assertEquals(1, maze[0].length);
            assertEquals(0, maze[0][0], "Single cell should be a path");
        }

        @Test
        @DisplayName("Should contain only valid values (0 or 1)")
        void shouldContainOnlyValidValues() {
            // Given
            int width = 5;
            int height = 5;
            
            // When
            int[][] maze = MazeUtils.generateMazeArray(width, height);
            
            // Then
            for (int i = 0; i < height; i++) {
                for (int j = 0; j < width; j++) {
                    assertTrue(maze[i][j] == 0 || maze[i][j] == 1, 
                        "Maze cell should be either 0 or 1");
                }
            }
        }
    }

    @Nested
    @DisplayName("generateMaze Tests")
    class GenerateMazeTests {

        @Test
        @DisplayName("Should generate maze with correct properties")
        void shouldGenerateMazeWithCorrectProperties() {
            // Given
            int width = 3;
            int height = 4;
            
            // When
            Maze maze = MazeUtils.generateMaze(width, height);
            
            // Then
            assertNotNull(maze);
            assertEquals(width, maze.getWidth());
            assertEquals(height, maze.getHeight());
            assertNotNull(maze.getName());
            assertTrue(maze.getName().startsWith("Maze "));
            assertNotNull(maze.getMazeData());
        }

        @Test
        @DisplayName("Should generate maze data with correct format")
        void shouldGenerateMazeDataWithCorrectFormat() {
            // Given
            int width = 2;
            int height = 2;
            
            // When
            Maze maze = MazeUtils.generateMaze(width, height);
            
            // Then
            String mazeData = maze.getMazeData();
            String[] lines = mazeData.split("\n");
            assertEquals(height, lines.length);
            
            for (String line : lines) {
                assertEquals(width, line.length());
                for (char c : line.toCharArray()) {
                    assertTrue(c == '0' || c == '1', "Each character should be '0' or '1'");
                }
            }
        }

        @Test
        @DisplayName("Should generate unique names for different mazes")
        void shouldGenerateUniqueNamesForDifferentMazes() throws InterruptedException {
            // Given
            int width = 2;
            int height = 2;
            
            // When
            Maze maze1 = MazeUtils.generateMaze(width, height);
            Thread.sleep(1); // Ensure different timestamps
            Maze maze2 = MazeUtils.generateMaze(width, height);
            
            // Then
            assertNotEquals(maze1.getName(), maze2.getName());
        }
    }

    @Nested
    @DisplayName("dfs Tests")
    class DfsTests {

        @Test
        @DisplayName("Should find path in simple 2x2 maze")
        void shouldFindPathInSimple2x2Maze() {
            // Given
            int[][] maze = {
                {0, 0},
                {0, 0}
            };
            boolean[][] visited = new boolean[2][2];
            StringBuilder path = new StringBuilder();
            List<int[]> pathCoordinates = new ArrayList<>();
            
            // When
            boolean result = MazeUtils.dfs(maze, 0, 0, 2, 2, visited, path, pathCoordinates);
            
            // Then
            assertTrue(result, "Should find a path");
            assertFalse(pathCoordinates.isEmpty(), "Path coordinates should not be empty");
            assertEquals(0, pathCoordinates.get(0)[0], "First coordinate should be start (0,0)");
            assertEquals(0, pathCoordinates.get(0)[1], "First coordinate should be start (0,0)");
            int[] lastCoord = pathCoordinates.get(pathCoordinates.size() - 1);
            assertEquals(1, lastCoord[0], "Last coordinate should be end (1,1)");
            assertEquals(1, lastCoord[1], "Last coordinate should be end (1,1)");
        }

        @Test
        @DisplayName("Should not find path when maze is blocked")
        void shouldNotFindPathWhenMazeIsBlocked() {
            // Given
            int[][] maze = {
                {0, 1},
                {1, 0}
            };
            boolean[][] visited = new boolean[2][2];
            StringBuilder path = new StringBuilder();
            List<int[]> pathCoordinates = new ArrayList<>();
            
            // When
            boolean result = MazeUtils.dfs(maze, 0, 0, 2, 2, visited, path, pathCoordinates);
            
            // Then
            assertFalse(result, "Should not find a path in blocked maze");
        }

        @Test
        @DisplayName("Should find path in single cell maze")
        void shouldFindPathInSingleCellMaze() {
            // Given
            int[][] maze = {{0}};
            boolean[][] visited = new boolean[1][1];
            StringBuilder path = new StringBuilder();
            List<int[]> pathCoordinates = new ArrayList<>();
            
            // When
            boolean result = MazeUtils.dfs(maze, 0, 0, 1, 1, visited, path, pathCoordinates);
            
            // Then
            assertTrue(result, "Should find path in single cell");
            assertEquals(1, pathCoordinates.size(), "Should have one coordinate");
            assertEquals(0, pathCoordinates.get(0)[0]);
            assertEquals(0, pathCoordinates.get(0)[1]);
        }

        @Test
        @DisplayName("Should handle out of bounds start position")
        void shouldHandleOutOfBoundsStartPosition() {
            // Given
            int[][] maze = {
                {0, 0},
                {0, 0}
            };
            boolean[][] visited = new boolean[2][2];
            StringBuilder path = new StringBuilder();
            List<int[]> pathCoordinates = new ArrayList<>();
            
            // When
            boolean result = MazeUtils.dfs(maze, -1, 0, 2, 2, visited, path, pathCoordinates);
            
            // Then
            assertFalse(result, "Should return false for out of bounds position");
        }

        @Test
        @DisplayName("Should handle wall at start position")
        void shouldHandleWallAtStartPosition() {
            // Given
            int[][] maze = {
                {1, 0},
                {0, 0}
            };
            boolean[][] visited = new boolean[2][2];
            StringBuilder path = new StringBuilder();
            List<int[]> pathCoordinates = new ArrayList<>();
            
            // When
            boolean result = MazeUtils.dfs(maze, 0, 0, 2, 2, visited, path, pathCoordinates);
            
            // Then
            assertFalse(result, "Should return false when starting at a wall");
        }

        @Test
        @DisplayName("Should find path in complex maze")
        void shouldFindPathInComplexMaze() {
            // Given
            int[][] maze = {
                {0, 1, 0},
                {0, 1, 0},
                {0, 0, 0}
            };
            boolean[][] visited = new boolean[3][3];
            StringBuilder path = new StringBuilder();
            List<int[]> pathCoordinates = new ArrayList<>();
            
            // When
            boolean result = MazeUtils.dfs(maze, 0, 0, 3, 3, visited, path, pathCoordinates);
            
            // Then
            assertTrue(result, "Should find a path in complex maze");
            assertFalse(pathCoordinates.isEmpty(), "Should have path coordinates");
        }

        @Test
        @DisplayName("Should handle already visited position")
        void shouldHandleAlreadyVisitedPosition() {
            // Given
            int[][] maze = {
                {0, 0},
                {0, 0}
            };
            boolean[][] visited = new boolean[2][2];
            visited[0][0] = true; // Mark start as already visited
            StringBuilder path = new StringBuilder();
            List<int[]> pathCoordinates = new ArrayList<>();
            
            // When
            boolean result = MazeUtils.dfs(maze, 0, 0, 2, 2, visited, path, pathCoordinates);
            
            // Then
            assertFalse(result, "Should return false for already visited position");
        }
    }
} 