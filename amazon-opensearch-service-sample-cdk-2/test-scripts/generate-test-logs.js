const AWS = require('aws-sdk');

// Initialize CloudWatch Logs client
const cloudwatchlogs = new AWS.CloudWatchLogs();

async function generateTestLogs() {
    const logGroupName = process.env.LOG_GROUP_NAME || '/aws/lambda/test-logs';
    const logStreamName = `test-stream-${Date.now()}`;
    
    try {
        // Create log stream
        await cloudwatchlogs.createLogStream({
            logGroupName: logGroupName,
            logStreamName: logStreamName
        }).promise();
        
        console.log(`Created log stream: ${logStreamName}`);
        
        // Generate sample log events
        const logEvents = [
            {
                message: JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'INFO',
                    message: 'User login successful',
                    user_id: 'user123',
                    ip: '192.168.1.100'
                }),
                timestamp: Date.now()
            },
            {
                message: JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'ERROR',
                    message: 'Database connection failed',
                    service: 'auth-service',
                    error_code: 'DB_CONN_TIMEOUT'
                }),
                timestamp: Date.now() + 1000
            },
            {
                message: JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'INFO',
                    message: 'API request processed',
                    endpoint: '/api/users',
                    response_time: 150,
                    status_code: 200
                }),
                timestamp: Date.now() + 2000
            },
            {
                message: 'Plain text log message without JSON structure',
                timestamp: Date.now() + 3000
            },
            {
                message: JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'WARN',
                    message: 'High memory usage detected',
                    memory_percent: 85.2,
                    service: 'web-server'
                }),
                timestamp: Date.now() + 4000
            }
        ];
        
        // Put log events
        await cloudwatchlogs.putLogEvents({
            logGroupName: logGroupName,
            logStreamName: logStreamName,
            logEvents: logEvents
        }).promise();
        
        console.log(`Successfully sent ${logEvents.length} log events to ${logGroupName}/${logStreamName}`);
        
    } catch (error) {
        console.error('Error generating test logs:', error);
    }
}

// Run the function
generateTestLogs();