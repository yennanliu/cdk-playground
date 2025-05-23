package com.yen.maze_be_1.controller;

import com.yen.maze_be_1.model.Maze;
import com.yen.maze_be_1.service.MazeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.time.LocalDateTime;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("MazeController Tests")
class MazeControllerTest {

    @Mock
    private MazeService mazeService;

    @InjectMocks
    private MazeController mazeController;

    private Maze testMaze;

    @BeforeEach
    void setUp() {
        testMaze = new Maze();
        testMaze.setId(1L);
        testMaze.setName("Test Maze");
        testMaze.setWidth(3);
        testMaze.setHeight(3);
        testMaze.setMazeData("010\n101\n010\n");
        testMaze.setCreatedAt(LocalDateTime.now());
    }

    @Test
    @DisplayName("Should generate maze successfully")
    void shouldGenerateMazeSuccessfully() {
        // Given
        Map<String, Integer> request = new HashMap<>();
        request.put("width", 3);
        request.put("height", 3);

        // When
        ResponseEntity<Maze> response = mazeController.generateMaze(request);

        // Then
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(3, response.getBody().getWidth());
        assertEquals(3, response.getBody().getHeight());
        assertNotNull(response.getBody().getMazeData());
        assertTrue(response.getBody().getName().startsWith("Maze "));
    }

    @Test
    @DisplayName("Should save maze successfully")
    void shouldSaveMazeSuccessfully() {
        // Given
        Map<String, Object> request = new HashMap<>();
        request.put("name", "Custom Maze");
        request.put("width", 3);
        request.put("height", 3);
        request.put("mazeData", "010\n101\n010\n");

        when(mazeService.saveMaze(any(Maze.class))).thenReturn(testMaze);

        // When
        ResponseEntity<Maze> response = mazeController.saveMaze(request);

        // Then
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(testMaze.getId(), response.getBody().getId());
        verify(mazeService, times(1)).saveMaze(any(Maze.class));
    }

    @Test
    @DisplayName("Should solve solvable maze successfully")
    void shouldSolveSolvableMazeSuccessfully() {
        // Given
        List<List<Integer>> mazeList = Arrays.asList(
            Arrays.asList(0, 0, 0),
            Arrays.asList(1, 1, 0),
            Arrays.asList(0, 0, 0)
        );
        Map<String, List<List<Integer>>> request = new HashMap<>();
        request.put("maze", mazeList);

        // When
        ResponseEntity<Map<String, Object>> response = mazeController.solveMaze(request);

        // Then
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertTrue((Boolean) response.getBody().get("solved"));
        assertNotNull(response.getBody().get("path"));
        assertNotNull(response.getBody().get("solvedMaze"));
        assertEquals("Maze solved successfully", response.getBody().get("message"));
    }

    @Test
    @DisplayName("Should handle unsolvable maze")
    void shouldHandleUnsolvableMaze() {
        // Given - blocked maze
        List<List<Integer>> mazeList = Arrays.asList(
            Arrays.asList(0, 1, 0),
            Arrays.asList(1, 1, 1),
            Arrays.asList(0, 1, 0)
        );
        Map<String, List<List<Integer>>> request = new HashMap<>();
        request.put("maze", mazeList);

        // When
        ResponseEntity<Map<String, Object>> response = mazeController.solveMaze(request);

        // Then
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertFalse((Boolean) response.getBody().get("solved"));
        assertEquals("Maze cannot be solved", response.getBody().get("message"));
    }

    @Test
    @DisplayName("Should get all mazes successfully")
    void shouldGetAllMazesSuccessfully() {
        // Given
        Maze maze2 = new Maze();
        maze2.setId(2L);
        maze2.setName("Second Maze");
        List<Maze> expectedMazes = Arrays.asList(testMaze, maze2);
        
        when(mazeService.getAllMazes()).thenReturn(expectedMazes);

        // When
        ResponseEntity<List<Maze>> response = mazeController.getAllMazes();

        // Then
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(2, response.getBody().size());
        assertEquals(expectedMazes, response.getBody());
        verify(mazeService, times(1)).getAllMazes();
    }

    @Test
    @DisplayName("Should get empty list when no mazes exist")
    void shouldGetEmptyListWhenNoMazesExist() {
        // Given
        when(mazeService.getAllMazes()).thenReturn(Collections.emptyList());

        // When
        ResponseEntity<List<Maze>> response = mazeController.getAllMazes();

        // Then
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertTrue(response.getBody().isEmpty());
        verify(mazeService, times(1)).getAllMazes();
    }

    @Test
    @DisplayName("Should get maze by ID successfully")
    void shouldGetMazeByIdSuccessfully() {
        // Given
        Long mazeId = 1L;
        when(mazeService.getMazeById(mazeId)).thenReturn(Optional.of(testMaze));

        // When
        ResponseEntity<Maze> response = mazeController.getMazeById(mazeId);

        // Then
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(testMaze.getId(), response.getBody().getId());
        assertEquals(testMaze.getName(), response.getBody().getName());
        verify(mazeService, times(1)).getMazeById(mazeId);
    }

    @Test
    @DisplayName("Should return 404 when maze not found")
    void shouldReturn404WhenMazeNotFound() {
        // Given
        Long mazeId = 999L;
        when(mazeService.getMazeById(mazeId)).thenReturn(Optional.empty());

        // When
        ResponseEntity<Maze> response = mazeController.getMazeById(mazeId);

        // Then
        assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode());
        assertNull(response.getBody());
        verify(mazeService, times(1)).getMazeById(mazeId);
    }

    @Test
    @DisplayName("Should delete maze successfully")
    void shouldDeleteMazeSuccessfully() {
        // Given
        Long mazeId = 1L;
        doNothing().when(mazeService).deleteMaze(mazeId);

        // When
        ResponseEntity<Void> response = mazeController.deleteMaze(mazeId);

        // Then
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNull(response.getBody());
        verify(mazeService, times(1)).deleteMaze(mazeId);
    }

    @Test
    @DisplayName("Should handle maze generation with different dimensions")
    void shouldHandleMazeGenerationWithDifferentDimensions() {
        // Given
        Map<String, Integer> request = new HashMap<>();
        request.put("width", 5);
        request.put("height", 4);

        // When
        ResponseEntity<Maze> response = mazeController.generateMaze(request);

        // Then
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(5, response.getBody().getWidth());
        assertEquals(4, response.getBody().getHeight());
        assertNotNull(response.getBody().getMazeData());
    }

    @Test
    @DisplayName("Should solve single cell maze")
    void shouldSolveSingleCellMaze() {
        // Given
        List<List<Integer>> mazeList = Arrays.asList(
            Arrays.asList(0)
        );
        Map<String, List<List<Integer>>> request = new HashMap<>();
        request.put("maze", mazeList);

        // When
        ResponseEntity<Map<String, Object>> response = mazeController.solveMaze(request);

        // Then
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertTrue((Boolean) response.getBody().get("solved"));
        assertNotNull(response.getBody().get("path"));
        assertEquals("Maze solved successfully", response.getBody().get("message"));
    }
} 