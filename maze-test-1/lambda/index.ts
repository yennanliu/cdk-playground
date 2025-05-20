import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';

const dynamoDB = new DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME || '';

interface Maze {
  id: string;
  width: number;
  height: number;
  grid: number[][];
  createdAt: string;
}

function generateMaze(width: number, height: number): number[][] {
  // Initialize grid with walls
  const grid: number[][] = Array(height).fill(0).map(() => Array(width).fill(1));
  
  // Start from a random cell
  const startX = Math.floor(Math.random() * width);
  const startY = Math.floor(Math.random() * height);
  
  // Mark start cell as path
  grid[startY][startX] = 0;
  
  // Stack for backtracking
  const stack: [number, number][] = [[startX, startY]];
  
  // Directions: right, down, left, up
  const directions = [[2, 0], [0, 2], [-2, 0], [0, -2]];
  
  while (stack.length > 0) {
    const [x, y] = stack[stack.length - 1];
    const unvisitedNeighbors = directions
      .map(([dx, dy]) => [x + dx, y + dy])
      .filter(([nx, ny]) => 
        nx >= 0 && nx < width && 
        ny >= 0 && ny < height && 
        grid[ny][nx] === 1
      );
    
    if (unvisitedNeighbors.length === 0) {
      stack.pop();
      continue;
    }
    
    const [nx, ny] = unvisitedNeighbors[Math.floor(Math.random() * unvisitedNeighbors.length)];
    const [mx, my] = [(x + nx) / 2, (y + ny) / 2];
    
    grid[ny][nx] = 0;
    grid[my][mx] = 0;
    stack.push([nx, ny]);
  }
  
  return grid;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    switch (event.httpMethod) {
      case 'POST':
        const { width = 15, height = 15 } = JSON.parse(event.body || '{}');
        const maze: Maze = {
          id: uuidv4(),
          width,
          height,
          grid: generateMaze(width, height),
          createdAt: new Date().toISOString(),
        };
        
        await dynamoDB.put({
          TableName: TABLE_NAME,
          Item: maze,
        }).promise();
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify(maze),
        };
        
      case 'GET':
        if (event.pathParameters?.id) {
          const result = await dynamoDB.get({
            TableName: TABLE_NAME,
            Key: { id: event.pathParameters.id },
          }).promise();
          
          if (!result.Item) {
            return {
              statusCode: 404,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
              body: JSON.stringify({ message: 'Maze not found' }),
            };
          }
          
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify(result.Item),
          };
        } else {
          const result = await dynamoDB.scan({
            TableName: TABLE_NAME,
          }).promise();
          
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify(result.Items),
          };
        }
        
      default:
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ message: 'Unsupported method' }),
        };
    }
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
}; 