import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import * as net from 'net';

// Import AWS SDK clients
import { ECSClient, ListTasksCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { EC2Client, DescribeNetworkInterfacesCommand } from '@aws-sdk/client-ec2';

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

async function getECSTaskIPs(): Promise<string[]> {
  try {
    const ecsClient = new ECSClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });
    const ec2Client = new EC2Client({ region: process.env.AWS_REGION || 'ap-northeast-1' });
    
    // Get cluster name from environment or use pattern matching
    const clusterName = process.env.ECS_CLUSTER_NAME || 'RedisSentinel1Stack-RedisCluster';
    
    // List all tasks in clusters that match our pattern
    const listClustersCommand = await ecsClient.send(new ListTasksCommand({}));
    
    // For now, let's try to find tasks by using a known service name pattern
    // In a real deployment, you'd pass the cluster name as an environment variable
    
    return [];
  } catch (error) {
    console.error('Error getting ECS task IPs:', error);
    return [];
  }
}

async function discoverRedisInstances(): Promise<any> {
  try {
    // Try to get actual ECS task IPs
    const ecsIPs = await getECSTaskIPs();
    
    // Fallback to common private IP ranges for ECS tasks
    const potentialHosts = ecsIPs.length > 0 ? ecsIPs : [
      // Try common ECS Fargate IP ranges
      '10.0.0.100', '10.0.0.101', '10.0.0.102',
      '10.0.1.100', '10.0.1.101', '10.0.1.102',
      '10.0.2.100', '10.0.2.101', '10.0.2.102',
      // Try other common private IP ranges
      '172.31.0.100', '172.31.0.101', '172.31.0.102',
      '192.168.1.100', '192.168.1.101', '192.168.1.102',
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

      // Only add results where at least one port is accessible
      if (result.redis_port === 'accessible' || result.sentinel_port === 'accessible') {
        testResults.push(result);
      }
    }

    return {
      discovered_instances: discoveredInstances,
      test_results: testResults,
      discovery_method: ecsIPs.length > 0 ? 'ecs_api' : 'network_scan',
      note: 'Discovered Redis instances by testing network connectivity. In production, use AWS ECS Service Discovery.'
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
    // Get discovered hosts first
    const discoveryResult = await discoverRedisInstances();
    const accessibleHosts = discoveryResult.test_results?.map((r: any) => r.host) || [];
    
    // If no hosts discovered, try a broader range
    const testHosts = accessibleHosts.length > 0 ? accessibleHosts : [
      '10.0.0.100', '10.0.0.101', '10.0.0.102',
      '10.0.1.100', '10.0.1.101', '10.0.1.102',
      '172.31.0.100', '172.31.0.101', '172.31.0.102'
    ];
    
    const results: RedisConnectionTest[] = [];

    for (const host of testHosts.slice(0, 10)) { // Limit to first 10 to avoid timeout
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
      accessible_hosts: results.filter(r => r.redis_port === 'accessible' || r.sentinel_port === 'accessible'),
      note: 'Network connectivity test to Redis and Sentinel ports'
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
    // Get accessible hosts from discovery
    const discoveryResult = await discoverRedisInstances();
    const accessibleHosts = discoveryResult.test_results
      ?.filter((r: any) => r.redis_port === 'accessible')
      ?.map((r: any) => r.host) || [];

    if (accessibleHosts.length === 0) {
      return {
        redis_operations: [],
        test_type: 'basic_redis_protocol',
        note: 'No accessible Redis hosts found. Make sure ECS tasks are running and accessible.',
        discovery_attempted: true
      };
    }

    const results: any[] = [];

    for (const host of accessibleHosts.slice(0, 3)) { // Test first 3 accessible hosts
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
      note: 'Basic Redis protocol test on discovered accessible hosts.'
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
    // Get accessible hosts from discovery
    const discoveryResult = await discoverRedisInstances();
    const accessibleHosts = discoveryResult.test_results
      ?.filter((r: any) => r.sentinel_port === 'accessible')
      ?.map((r: any) => r.host) || [];

    if (accessibleHosts.length === 0) {
      return {
        sentinel_operations: [],
        test_type: 'basic_sentinel_protocol',
        note: 'No accessible Sentinel hosts found. Make sure ECS tasks are running and accessible.',
        discovery_attempted: true
      };
    }

    const results: any[] = [];

    for (const host of accessibleHosts.slice(0, 3)) { // Test first 3 accessible hosts
      try {
        // Send SENTINEL MASTERS command
        const mastersResponse = await sendRedisCommand(host, 26379, 'SENTINEL MASTERS');
        
        results.push({
          sentinel_host: `${host}:26379`,
          status: 'success',
          masters_response: mastersResponse,
          note: 'Basic Sentinel protocol test'
        });

      } catch (error) {
        results.push({
          sentinel_host: `${host}:26379`,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Sentinel connection failed'
        });
      }
    }

    return {
      sentinel_operations: results,
      test_type: 'basic_sentinel_protocol',
      note: 'Basic Redis Sentinel protocol test on discovered accessible hosts.'
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
      aws_region: process.env.AWS_REGION,
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