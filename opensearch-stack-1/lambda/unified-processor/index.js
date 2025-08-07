/**
 * Unified Lambda processor for CloudWatch Logs -> Firehose -> OpenSearch
 * Handles both EKS cluster logs and Pod application logs based on environment variable
 */

const { 
    decompressLogData, 
    extractClusterName, 
    extractLogLevel, 
    generateUniqueId 
} = require('../shared/log-processing');

const PROCESSING_TYPE = process.env.PROCESSING_TYPE || 'eks';

exports.handler = async (event) => {
    console.log(`Processing ${PROCESSING_TYPE} logs for Firehose delivery`);
    console.log('Event:', JSON.stringify(event, null, 2));

    const output = [];
    
    for (const record of event.records) {
        try {
            // Decode base64 data
            const compressedData = Buffer.from(record.data, 'base64');
            
            // Decompress gzipped data
            const decompressedData = decompressLogData(compressedData);
            const logData = JSON.parse(decompressedData);
            
            console.log('Processing log data:', JSON.stringify(logData, null, 2));
            
            // Process based on type
            if (PROCESSING_TYPE === 'eks') {
                processEKSLogs(record, logData, output);
            } else if (PROCESSING_TYPE === 'pod') {
                processPodLogs(record, logData, output);
            } else {
                throw new Error(`Unknown processing type: ${PROCESSING_TYPE}`);
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
 * Process EKS cluster logs
 */
function processEKSLogs(record, logData, output) {
    // Process each log event
    for (const logEvent of logData.logEvents) {
        const transformedRecord = processEKSLogEvent(logEvent, logData);
        
        // Add transformed record to output
        output.push({
            recordId: record.recordId,
            result: 'Ok',
            data: Buffer.from(JSON.stringify(transformedRecord) + '\n').toString('base64')
        });
    }
}

/**
 * Process individual EKS log event
 */
function processEKSLogEvent(logEvent, logData) {
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
    return {
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
}

/**
 * Process Pod application logs
 */
function processPodLogs(record, logData, output) {
    // Process each log event for pod logs
    if (logData.logEvents && Array.isArray(logData.logEvents)) {
        const processedEvents = [];
        
        for (const logEvent of logData.logEvents) {
            const processedEvent = processPodLogEvent(logEvent, logData);
            processedEvents.push(processedEvent);
        }
        
        // Take only the first processed event to maintain 1:1 record mapping
        // OpenSearch expects exactly one JSON document per Firehose record
        const firstEvent = processedEvents[0];
        
        // Return single output record with original recordId and first event only
        const outputRecord = {
            recordId: record.recordId,
            result: 'Ok',
            data: Buffer.from(JSON.stringify(firstEvent), 'utf8').toString('base64')
        };
        console.log('Output record:', JSON.stringify(outputRecord, null, 2));
        output.push(outputRecord);
    } else {
        // No log events, pass through as-is but decompressed
        const outputRecord = {
            recordId: record.recordId,
            result: 'Ok',
            data: Buffer.from(decompressedData, 'utf8').toString('base64')
        };
        output.push(outputRecord);
    }
}

/**
 * Process individual Pod log event
 */
function processPodLogEvent(logEvent, logData) {
    let processedEvent;
    
    try {
        // Try to parse message as JSON (for pod logs with kubernetes metadata)
        const messageJson = JSON.parse(logEvent.message);
        
        if (messageJson.kubernetes && messageJson.message) {
            // Pod application log format with kubernetes metadata
            const uniqueId = generateUniqueId(
                logData.logGroup, 
                logData.logStream, 
                logEvent.timestamp, 
                messageJson.kubernetes.pod_id || messageJson.kubernetes.pod_name
            );
            
            processedEvent = {
                id: `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${uniqueId}`,
                '@timestamp': new Date(logEvent.timestamp).toISOString(),
                timestamp: new Date(logEvent.timestamp).toISOString(),
                message: messageJson.message,
                stream: messageJson.stream,
                logtag: messageJson.logtag,
                pod_name: messageJson.kubernetes.pod_name,
                namespace: messageJson.kubernetes.namespace_name,
                container_name: messageJson.kubernetes.container_name,
                pod_id: messageJson.kubernetes.pod_id,
                host: messageJson.kubernetes.host,
                labels: messageJson.kubernetes.labels,
                docker_id: messageJson.kubernetes.docker_id,
                container_hash: messageJson.kubernetes.container_hash,
                container_image: messageJson.kubernetes.container_image,
                cluster: extractClusterName(logData.logGroup),
                log_type: 'pod-application',
                log_group: logData.logGroup,
                log_stream: logData.logStream
            };
        } else {
            // Other structured pod logs
            const uniqueId = generateUniqueId(
                logData.logGroup, 
                logData.logStream, 
                logEvent.timestamp, 
                JSON.stringify(messageJson)
            );
            
            processedEvent = {
                id: `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${uniqueId}`,
                '@timestamp': new Date(logEvent.timestamp).toISOString(),
                message: messageJson,
                log_group: logData.logGroup,
                log_stream: logData.logStream,
                cluster: extractClusterName(logData.logGroup),
                log_type: 'pod-structured'
            };
        }
    } catch (parseError) {
        // Plain text pod log message
        const uniqueId = generateUniqueId(
            logData.logGroup, 
            logData.logStream, 
            logEvent.timestamp, 
            logEvent.message
        );
        
        processedEvent = {
            id: `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${uniqueId}`,
            '@timestamp': new Date(logEvent.timestamp).toISOString(),
            message: logEvent.message,
            log_group: logData.logGroup,
            log_stream: logData.logStream,
            cluster: extractClusterName(logData.logGroup),
            log_type: 'pod-raw'
        };
    }
    
    return processedEvent;
}