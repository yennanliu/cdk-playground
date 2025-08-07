/**
 * Lambda function to process EKS CloudWatch Logs for Firehose delivery to OpenSearch
 * Handles decompression, parsing, and transformation of log data
 */

const zlib = require('zlib');

exports.handler = async (event) => {
    console.log('Processing EKS logs for Firehose delivery');
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
    
    // Extract cluster and service information
    let clusterName = extractClusterName(logData.logGroup);
    let serviceName = '';
    let logLevel = 'INFO';
    let parsedMessage = logEvent.message;
    
    try {
        // Try to parse JSON log messages
        try {
            const jsonMessage = JSON.parse(logEvent.message);
            parsedMessage = jsonMessage;
            
            // Extract additional fields if available
            if (jsonMessage.level) {
                logLevel = jsonMessage.level.toUpperCase();
            }
            if (jsonMessage.service) {
                serviceName = jsonMessage.service;
            }
        } catch (parseError) {
            // Keep original message if not JSON
            parsedMessage = logEvent.message;
            logLevel = extractLogLevel(logEvent.message);
        }
        
        // Extract service name from log group or stream
        if (!serviceName && logData.logGroup) {
            const logGroupParts = logData.logGroup.split('/');
            if (logGroupParts.length >= 4) {
                serviceName = logGroupParts[logGroupParts.length - 1];
            }
        }
        
    } catch (error) {
        console.warn('Error parsing log event:', error);
    }
    
    // Create structured log entry for OpenSearch
    const transformedRecord = {
        '@timestamp': timestamp.toISOString(),
        'log_level': logLevel,
        'message': parsedMessage,
        'eks': {
            'cluster_name': clusterName,
            'service_name': serviceName,
            'log_group': logData.logGroup,
            'log_stream': logData.logStream
        },
        'aws': {
            'region': process.env.AWS_REGION,
            'log_group': logData.logGroup,
            'log_stream': logData.logStream
        },
        'source': 'eks-cluster',
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
    
    // Common EKS log group formats:
    // /aws/eks/cluster-name/cluster
    // /aws/containerinsights/cluster-name/application
    
    if (parts.includes('eks') && parts.length >= 4) {
        return parts[3];
    } else if (parts.includes('containerinsights') && parts.length >= 4) {
        return parts[3];
    }
    
    // Fallback: use last meaningful part
    return parts.length >= 2 ? parts[parts.length - 2] : '';
}