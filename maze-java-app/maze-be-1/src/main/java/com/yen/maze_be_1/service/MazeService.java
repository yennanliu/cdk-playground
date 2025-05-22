package com.yen.maze_be_1.service;

import com.yen.maze_be_1.model.Maze;
import com.yen.maze_be_1.repository.MazeRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class MazeService {

    @Autowired
    private MazeRepository mazeRepository;

    public Maze saveMaze(Maze maze) {
        return mazeRepository.save(maze);
    }

    public List<Maze> getAllMazes() {
        return mazeRepository.findAll();
    }

    public Optional<Maze> getMazeById(Long id) {
        return mazeRepository.findById(id);
    }

    public void deleteMaze(Long id) {
        mazeRepository.deleteById(id);
    }
} 