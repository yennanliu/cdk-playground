package com.yen.maze_be_1.service;

import com.yen.maze_be_1.model.Maze;
import com.yen.maze_be_1.repository.MazeRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class MazeService {

    private static final Logger logger = LoggerFactory.getLogger(MazeService.class);

    @Autowired
    private MazeRepository mazeRepository;

    public Maze saveMaze(Maze maze) {
        logger.info("Saving maze: {}", maze.getName());
        Maze savedMaze = mazeRepository.save(maze);
        logger.debug("Maze saved with ID: {}", savedMaze.getId());
        return savedMaze;
    }

    public List<Maze> getAllMazes() {
        logger.info("Retrieving all mazes from database");
        List<Maze> mazes = mazeRepository.findAll();
        logger.debug("Retrieved {} mazes from database", mazes.size());
        return mazes;
    }

    public Optional<Maze> getMazeById(Long id) {
        logger.info("Retrieving maze with ID: {} from database", id);
        Optional<Maze> maze = mazeRepository.findById(id);
        if (maze.isPresent()) {
            logger.debug("Found maze: {}", maze.get().getName());
        } else {
            logger.warn("Maze with ID: {} not found", id);
        }
        return maze;
    }

    public void deleteMaze(Long id) {
        logger.info("Deleting maze with ID: {}", id);
        mazeRepository.deleteById(id);
        logger.debug("Maze with ID: {} deleted", id);
    }
} 