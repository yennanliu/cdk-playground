const zlib = require('zlib');
const crypto = require('crypto');

exports.handler = async (event) => {
    const output = [];
    
    for (const record of event.records) {
        try {
            // Decode base64 data
            const compressedData = Buffer.from(record.data, 'base64');
            
            // Decompress gzipped data
            const decompressedData = zlib.gunzipSync(compressedData);
            const logData = JSON.parse(decompressedData.toString('utf8'));
            
            // Process each log event for pod logs
            if (logData.logEvents && Array.isArray(logData.logEvents)) {
                const processedEvents = [];
                
                for (const logEvent of logData.logEvents) {
                    let processedEvent;
                    
                    try {
                        // Try to parse message as JSON (for pod logs with kubernetes metadata)
                        const messageJson = JSON.parse(logEvent.message);
                        
                        if (messageJson.kubernetes && messageJson.message) {
                            // Pod application log format with kubernetes metadata
                            const uniqueId = crypto.createHash('sha256')
                                .update(`${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${messageJson.kubernetes.pod_id || messageJson.kubernetes.pod_name}`)
                                .digest('hex')
                                .substring(0, 16);
                            
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
                                cluster: 'eks-cluster',
                                log_type: 'pod-application',
                                log_group: logData.logGroup,
                                log_stream: logData.logStream
                            };
                        } else {
                            // Other structured pod logs
                            const uniqueId = crypto.createHash('sha256')
                                .update(`${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${JSON.stringify(messageJson)}`)
                                .digest('hex')
                                .substring(0, 16);
                            
                            processedEvent = {
                                id: `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${uniqueId}`,
                                '@timestamp': new Date(logEvent.timestamp).toISOString(),
                                message: messageJson,
                                log_group: logData.logGroup,
                                log_stream: logData.logStream,
                                cluster: 'eks-cluster',
                                log_type: 'pod-structured'
                            };
                        }
                    } catch (parseError) {
                        // Plain text pod log message
                        const uniqueId = crypto.createHash('sha256')
                            .update(`${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${logEvent.message}`)
                            .digest('hex')
                            .substring(0, 16);
                        
                        processedEvent = {
                            id: `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${uniqueId}`,
                            '@timestamp': new Date(logEvent.timestamp).toISOString(),
                            message: logEvent.message,
                            log_group: logData.logGroup,
                            log_stream: logData.logStream,
                            cluster: 'eks-cluster',
                            log_type: 'pod-raw'
                        };
                    }
                    
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
                output.push(outputRecord);
            } else {
                // No log events, pass through as-is but decompressed
                const outputRecord = {
                    recordId: record.recordId,
                    result: 'Ok',
                    data: Buffer.from(decompressedData.toString('utf8'), 'utf8').toString('base64')
                };
                output.push(outputRecord);
            }
        } catch (error) {
            console.error('Error processing record:', error);
            
            // Return processing failure
            output.push({
                recordId: record.recordId,
                result: 'ProcessingFailed'
            });
        }
    }
    
    return { records: output };
};