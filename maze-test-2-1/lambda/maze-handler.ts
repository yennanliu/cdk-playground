import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

interface MazeRequest {
  action: 'generate' | 'solve';
  maze?: number[][];
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const request: MazeRequest = JSON.parse(event.body || '{}');
    const { action, maze } = request;

    if (action === 'generate') {
      const generatedMaze = generateMaze();
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ maze: generatedMaze }),
      };
    } else if (action === 'solve' && maze) {
      const solution = solveMaze(maze);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ solution }),
      };
    }

    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Invalid request' }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

function generateMaze(): number[][] {
  const rows = 30;
  const cols = 30;
  const maze = Array.from({ length: rows }, () => Array(cols).fill(1));

  // Ensure the maze has a simple solution
  let currentRow = 0;
  let currentCol = 0;
  while (currentRow < rows - 1 || currentCol < cols - 1) {
    maze[currentRow][currentCol] = 0;

    if (currentRow === rows - 1) {
      currentCol++;
    } else if (currentCol === cols - 1) {
      currentRow++;
    } else if (Math.random() > 0.5) {
      currentRow++;
    } else {
      currentCol++;
    }
  }
  maze[currentRow][currentCol] = 0;

  // Add random walls
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (maze[row][col] !== 0) {
        maze[row][col] = Math.random() > 0.85 ? 1 : 0;
      }
    }
  }

  return maze;
}

function solveMaze(maze: number[][]): number[][] {
  const rows = maze.length;
  const cols = maze[0].length;
  const solution: number[][] = [];
  const visited = Array.from({ length: rows }, () => Array(cols).fill(false));

  function dfs(row: number, col: number): boolean {
    if (row < 0 || col < 0 || row >= rows || col >= cols || maze[row][col] === 1 || visited[row][col]) {
      return false;
    }

    visited[row][col] = true;
    solution.push([row, col]);

    if (row === rows - 1 && col === cols - 1) {
      return true;
    }

    if (dfs(row + 1, col) || dfs(row, col + 1) || dfs(row - 1, col) || dfs(row, col - 1)) {
      return true;
    }

    solution.pop();
    return false;
  }

  dfs(0, 0);
  return solution;
} 