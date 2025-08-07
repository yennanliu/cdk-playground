/**
 * Lambda function to process Pod CloudWatch Logs for Firehose delivery to OpenSearch
 * Handles decompression, parsing, and transformation of log data
 */

const zlib = require('zlib');

exports.handler = async (event) => {
    console.log('Processing pod logs for Firehose delivery');
    console.log('Event:', JSON.stringify(event, null, 2));

    const output = [];
    
    for (const record of event.records) {
        try {
            // Decode base64 data
            const compressedData = Buffer.from(record.data, 'base64');
            
            // Decompress gzipped data
            const decompressedData = zlib.gunzipSync(compressedData).toString('utf8');
            const logData = JSON.parse(decompressedData);
            
            console.log('Processing log data:', JSON.stringify(logData, null, 2));
            
            // Process each log event
            for (const logEvent of logData.logEvents) {
                const transformedRecord = processLogEvent(logEvent, logData);
                
                // Add transformed record to output
                output.push({
                    recordId: record.recordId,
                    result: 'Ok',
                    data: Buffer.from(JSON.stringify(transformedRecord) + '\n').toString('base64')
                });
            }
            
        } catch (error) {
            console.error('Error processing record:', error);
            console.error('Record data:', record.data);
            
            // Return processing failure
            output.push({
                recordId: record.recordId,
                result: 'ProcessingFailed'
            });
        }
    }
    
    console.log('Processed records:', output.length);
    return { records: output };
};

/**
 * Process individual log event and transform for OpenSearch
 */
function processLogEvent(logEvent, logData) {
    const timestamp = new Date(logEvent.timestamp);
    
    // Parse the log message to extract pod information
    let podName = '';
    let namespace = '';
    let containerName = '';
    let parsedMessage = logEvent.message;
    
    try {
        // Extract pod information from log group or log stream
        if (logData.logGroup) {
            const logGroupParts = logData.logGroup.split('/');
            if (logGroupParts.length >= 5) {
                // Format: /aws/containerinsights/cluster-name/application/pod-name
                namespace = logGroupParts[4] || '';
            }
        }
        
        if (logData.logStream) {
            const streamParts = logData.logStream.split('/');
            if (streamParts.length >= 2) {
                // Format: pod-name/container-name/container-id
                podName = streamParts[0] || '';
                containerName = streamParts[1] || '';
            }
        }
        
        // Try to parse JSON log messages
        try {
            const jsonMessage = JSON.parse(logEvent.message);
            parsedMessage = jsonMessage;
        } catch (parseError) {
            // Keep original message if not JSON
            parsedMessage = logEvent.message;
        }
        
    } catch (error) {
        console.warn('Error extracting pod information:', error);
    }
    
    // Create structured log entry for OpenSearch
    const transformedRecord = {
        '@timestamp': timestamp.toISOString(),
        'log_level': extractLogLevel(logEvent.message),
        'message': parsedMessage,
        'pod': {
            'name': podName,
            'namespace': namespace,
            'container_name': containerName
        },
        'kubernetes': {
            'cluster_name': extractClusterName(logData.logGroup),
            'log_group': logData.logGroup,
            'log_stream': logData.logStream
        },
        'aws': {
            'region': process.env.AWS_REGION,
            'log_group': logData.logGroup,
            'log_stream': logData.logStream
        },
        'source': 'kubernetes-pod',
        'raw_message': logEvent.message
    };
    
    return transformedRecord;
}

/**
 * Extract log level from log message
 */
function extractLogLevel(message) {
    const logLevelRegex = /(ERROR|WARN|INFO|DEBUG|TRACE|FATAL)/i;
    const match = message.match(logLevelRegex);
    return match ? match[1].toUpperCase() : 'INFO';
}

/**
 * Extract cluster name from log group
 */
function extractClusterName(logGroup) {
    if (!logGroup) return '';
    
    const parts = logGroup.split('/');
    // Format: /aws/containerinsights/cluster-name/application
    return parts.length >= 4 ? parts[3] : '';
}