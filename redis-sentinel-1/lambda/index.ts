import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import * as net from 'net';

interface TestResult {
  action: string;
  timestamp: string;
  results: any;
}

interface RedisConnectionTest {
  host: string;
  redis_port: 'accessible' | 'not_accessible';
  sentinel_port: 'accessible' | 'not_accessible';
}

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  try {
    // Get the action from query parameters
    const action = event.queryStringParameters?.action || 'test';
    
    const responseData: TestResult = {
      action,
      timestamp: context.awsRequestId,
      results: {}
    };

    switch (action) {
      case 'discover':
        responseData.results = await discoverRedisInstances();
        break;
      
      case 'test':
        responseData.results = await testRedisConnectivity();
        break;
      
      case 'redis-ops':
        responseData.results = await testRedisOperations();
        break;
      
      case 'sentinel':
        responseData.results = await testSentinelOperations();
        break;
      
      case 'info':
        responseData.results = getSystemInfo(context);
        break;
      
      default:
        responseData.results = {
          error: `Unknown action: ${action}`,
          available_actions: ['discover', 'test', 'redis-ops', 'sentinel', 'info']
        };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(responseData, null, 2)
    };

  } catch (error) {
    console.error('Lambda error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        action: event.queryStringParameters?.action || 'unknown'
      })
    };
  }
};

async function discoverRedisInstances(): Promise<any> {
  try {
    // In a real implementation, you would use AWS service discovery
    // For now, we'll simulate discovery by testing common Redis endpoints
    const potentialHosts = [
      '10.0.1.100', '10.0.1.101', '10.0.1.102',  // Common private IPs
      'redis-service.local',  // Service discovery name
      'localhost'  // Fallback
    ];

    const discoveredInstances: string[] = [];
    const testResults: RedisConnectionTest[] = [];

    for (const host of potentialHosts) {
      const result: RedisConnectionTest = {
        host,
        redis_port: 'not_accessible',
        sentinel_port: 'not_accessible'
      };

      // Test Redis port (6379)
      try {
        await testConnection(host, 6379, 1000);
        result.redis_port = 'accessible';
        discoveredInstances.push(`${host}:6379`);
      } catch (e) {
        // Port not accessible
      }

      // Test Sentinel port (26379)
      try {
        await testConnection(host, 26379, 1000);
        result.sentinel_port = 'accessible';
      } catch (e) {
        // Port not accessible
      }

      testResults.push(result);
    }

    return {
      discovered_instances: discoveredInstances,
      test_results: testResults,
      discovery_method: 'network_scan',
      note: 'In production, use AWS ECS Service Discovery or CloudMap for proper service discovery'
    };

  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Discovery failed',
      discovery_method: 'network_scan'
    };
  }
}

async function testRedisConnectivity(): Promise<any> {
  try {
    const testHosts = ['10.0.1.100', '10.0.1.101', '10.0.1.102'];
    const results: RedisConnectionTest[] = [];

    for (const host of testHosts) {
      const result: RedisConnectionTest = {
        host,
        redis_port: 'not_accessible',
        sentinel_port: 'not_accessible'
      };

      try {
        await testConnection(host, 6379, 2000);
        result.redis_port = 'accessible';
      } catch (e) {
        // Port not accessible
      }

      try {
        await testConnection(host, 26379, 2000);
        result.sentinel_port = 'accessible';
      } catch (e) {
        // Port not accessible
      }

      results.push(result);
    }

    return {
      connectivity_tests: results,
      test_type: 'network_connectivity',
      note: 'Basic network connectivity test to Redis and Sentinel ports'
    };

  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Connectivity test failed',
      test_type: 'network_connectivity'
    };
  }
}

async function testRedisOperations(): Promise<any> {
  try {
    // For this basic version, we'll do protocol-level testing
    // To get full Redis operations, you'd need to install the redis npm package
    const testHosts = ['10.0.1.100', '10.0.1.101', '10.0.1.102'];
    const results: any[] = [];

    for (const host of testHosts) {
      try {
        // Test if we can connect and send a basic PING command
        const response = await sendRedisCommand(host, 6379, 'PING');
        
        results.push({
          host,
          status: 'success',
          ping_response: response,
          note: 'Basic Redis protocol test. For full operations, install redis npm package.'
        });

      } catch (error) {
        results.push({
          host,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Connection failed'
        });
      }
    }

    return {
      redis_operations: results,
      test_type: 'basic_redis_protocol',
      note: 'Basic Redis protocol test. For full operations with SET/GET/DEL, install redis npm package.'
    };

  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Redis operations test failed',
      test_type: 'basic_redis_protocol'
    };
  }
}

async function testSentinelOperations(): Promise<any> {
  try {
    // Test Redis Sentinel functionality
    const sentinelHosts = [
      { host: '10.0.1.100', port: 26379 },
      { host: '10.0.1.101', port: 26379 },
      { host: '10.0.1.102', port: 26379 }
    ];

    const results: any[] = [];

    for (const { host, port } of sentinelHosts) {
      try {
        // Send SENTINEL MASTERS command
        const mastersResponse = await sendRedisCommand(host, port, 'SENTINEL MASTERS');
        
        results.push({
          sentinel_host: `${host}:${port}`,
          status: 'success',
          masters_response: mastersResponse,
          note: 'Basic Sentinel protocol test'
        });

      } catch (error) {
        results.push({
          sentinel_host: `${host}:${port}`,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Sentinel connection failed'
        });
      }
    }

    return {
      sentinel_operations: results,
      test_type: 'basic_sentinel_protocol',
      note: 'Basic Redis Sentinel protocol test'
    };

  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Sentinel operations test failed',
      test_type: 'basic_sentinel_protocol'
    };
  }
}

function getSystemInfo(context: Context): any {
  return {
    lambda_info: {
      function_name: context.functionName,
      function_version: context.functionVersion,
      memory_limit: context.memoryLimitInMB,
      remaining_time: context.getRemainingTimeInMillis(),
      log_group: context.logGroupName,
      log_stream: context.logStreamName
    },
    available_actions: ['discover', 'test', 'redis-ops', 'sentinel', 'info'],
    redis_config: {
      master_name: 'mymaster',
      expected_replicas: 3,
      redis_port: 6379,
      sentinel_port: 26379
    },
    environment: {
      redis_master_name: process.env.REDIS_MASTER_NAME || 'mymaster',
      node_version: process.version,
      platform: process.platform
    }
  };
}

async function testConnection(host: string, port: number, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Connection timeout to ${host}:${port}`));
    }, timeout);

    socket.connect(port, host, () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });

    socket.on('error', (err: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    });
  });
}

async function sendRedisCommand(host: string, port: number, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let response = '';

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Command timeout to ${host}:${port}`));
    }, 5000);

    socket.connect(port, host, () => {
      // Send Redis protocol command
      const redisCommand = `*${command.split(' ').length}\r\n${command.split(' ').map(part => `$${part.length}\r\n${part}\r\n`).join('')}`;
      socket.write(redisCommand);
    });

    socket.on('data', (data) => {
      response += data.toString();
      clearTimeout(timer);
      socket.destroy();
      resolve(response.trim());
    });

    socket.on('error', (err: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    });
  });
} 