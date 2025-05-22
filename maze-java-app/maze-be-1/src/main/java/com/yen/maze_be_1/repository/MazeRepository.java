package com.yen.maze_be_1.repository;

import com.yen.maze_be_1.model.Maze;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface MazeRepository extends JpaRepository<Maze, Long> {
} 