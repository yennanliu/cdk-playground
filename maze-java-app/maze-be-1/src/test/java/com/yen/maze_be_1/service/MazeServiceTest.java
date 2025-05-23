package com.yen.maze_be_1.service;

import com.yen.maze_be_1.model.Maze;
import com.yen.maze_be_1.repository.MazeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("MazeService Tests")
class MazeServiceTest {

    @Mock
    private MazeRepository mazeRepository;

    @InjectMocks
    private MazeService mazeService;

    private Maze testMaze;

    @BeforeEach
    void setUp() {
        testMaze = new Maze();
        testMaze.setId(1L);
        testMaze.setName("Test Maze");
        testMaze.setWidth(5);
        testMaze.setHeight(5);
        testMaze.setMazeData("01010\n10101\n01010\n10101\n01010\n");
        testMaze.setCreatedAt(LocalDateTime.now());
    }

    @Test
    @DisplayName("Should save maze successfully")
    void shouldSaveMazeSuccessfully() {
        // Given
        Maze mazeToSave = new Maze();
        mazeToSave.setName("New Maze");
        mazeToSave.setWidth(3);
        mazeToSave.setHeight(3);
        mazeToSave.setMazeData("010\n101\n010\n");

        when(mazeRepository.save(any(Maze.class))).thenReturn(testMaze);

        // When
        Maze result = mazeService.saveMaze(mazeToSave);

        // Then
        assertNotNull(result);
        assertEquals(testMaze.getId(), result.getId());
        assertEquals(testMaze.getName(), result.getName());
        verify(mazeRepository, times(1)).save(mazeToSave);
    }

    @Test
    @DisplayName("Should get all mazes successfully")
    void shouldGetAllMazesSuccessfully() {
        // Given
        Maze maze2 = new Maze();
        maze2.setId(2L);
        maze2.setName("Second Maze");
        maze2.setWidth(4);
        maze2.setHeight(4);
        maze2.setMazeData("0101\n1010\n0101\n1010\n");

        List<Maze> expectedMazes = Arrays.asList(testMaze, maze2);
        when(mazeRepository.findAll()).thenReturn(expectedMazes);

        // When
        List<Maze> result = mazeService.getAllMazes();

        // Then
        assertNotNull(result);
        assertEquals(2, result.size());
        assertEquals(expectedMazes, result);
        verify(mazeRepository, times(1)).findAll();
    }

    @Test
    @DisplayName("Should get empty list when no mazes exist")
    void shouldGetEmptyListWhenNoMazesExist() {
        // Given
        when(mazeRepository.findAll()).thenReturn(Arrays.asList());

        // When
        List<Maze> result = mazeService.getAllMazes();

        // Then
        assertNotNull(result);
        assertTrue(result.isEmpty());
        verify(mazeRepository, times(1)).findAll();
    }

    @Test
    @DisplayName("Should get maze by ID successfully")
    void shouldGetMazeByIdSuccessfully() {
        // Given
        Long mazeId = 1L;
        when(mazeRepository.findById(mazeId)).thenReturn(Optional.of(testMaze));

        // When
        Optional<Maze> result = mazeService.getMazeById(mazeId);

        // Then
        assertTrue(result.isPresent());
        assertEquals(testMaze.getId(), result.get().getId());
        assertEquals(testMaze.getName(), result.get().getName());
        verify(mazeRepository, times(1)).findById(mazeId);
    }

    @Test
    @DisplayName("Should return empty optional when maze not found")
    void shouldReturnEmptyOptionalWhenMazeNotFound() {
        // Given
        Long mazeId = 999L;
        when(mazeRepository.findById(mazeId)).thenReturn(Optional.empty());

        // When
        Optional<Maze> result = mazeService.getMazeById(mazeId);

        // Then
        assertFalse(result.isPresent());
        verify(mazeRepository, times(1)).findById(mazeId);
    }

    @Test
    @DisplayName("Should delete maze successfully")
    void shouldDeleteMazeSuccessfully() {
        // Given
        Long mazeId = 1L;
        doNothing().when(mazeRepository).deleteById(mazeId);

        // When
        mazeService.deleteMaze(mazeId);

        // Then
        verify(mazeRepository, times(1)).deleteById(mazeId);
    }

    @Test
    @DisplayName("Should handle null maze in save operation")
    void shouldHandleNullMazeInSaveOperation() {
        // Given - null maze will cause NPE when trying to access maze.getName()
        
        // When & Then
        assertThrows(NullPointerException.class, () -> mazeService.saveMaze(null));
        // Note: Repository save method is never called because NPE occurs first
    }

    @Test
    @DisplayName("Should handle null ID in getMazeById")
    void shouldHandleNullIdInGetMazeById() {
        // Given
        when(mazeRepository.findById(null)).thenReturn(Optional.empty());

        // When
        Optional<Maze> result = mazeService.getMazeById(null);

        // Then
        assertFalse(result.isPresent());
        verify(mazeRepository, times(1)).findById(null);
    }

    @Test
    @DisplayName("Should handle deletion of non-existent maze")
    void shouldHandleDeletionOfNonExistentMaze() {
        // Given
        Long nonExistentId = 999L;
        doNothing().when(mazeRepository).deleteById(nonExistentId);

        // When
        mazeService.deleteMaze(nonExistentId);

        // Then
        verify(mazeRepository, times(1)).deleteById(nonExistentId);
        // No exception should be thrown - deleteById handles non-existent IDs gracefully
    }
} 