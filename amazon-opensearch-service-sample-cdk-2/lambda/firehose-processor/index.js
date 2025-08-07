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
            
            // Process each log event and combine them into single output record with proper formatting
            if (logData.logEvents && Array.isArray(logData.logEvents)) {
                const processedEvents = [];
                
                for (const logEvent of logData.logEvents) {
                    let processedEvent;
                    
                    try {
                        // Try to parse message as JSON (for structured logs like K8s audit)
                        const messageJson = JSON.parse(logEvent.message);
                        
                        if (messageJson.auditID) {
                            // K8s audit log format
                            processedEvent = {
                                id: `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${messageJson.auditID}`,
                                '@timestamp': messageJson.requestReceivedTimestamp || messageJson.stageTimestamp || new Date(logEvent.timestamp).toISOString(),
                                timestamp: messageJson.requestReceivedTimestamp || messageJson.stageTimestamp || new Date(logEvent.timestamp).toISOString(),
                                audit_id: messageJson.auditID,
                                kind: messageJson.kind,
                                api_version: messageJson.apiVersion,
                                level: messageJson.level,
                                stage: messageJson.stage,
                                request_uri: messageJson.requestURI,
                                verb: messageJson.verb,
                                user: messageJson.user ? {
                                    username: messageJson.user.username,
                                    groups: messageJson.user.groups
                                } : null,
                                source_ips: messageJson.sourceIPs,
                                user_agent: messageJson.userAgent,
                                object_ref: messageJson.objectRef,
                                response_status: messageJson.responseStatus,
                                annotations: messageJson.annotations,
                                cluster: 'eks-cluster',
                                log_type: 'k8s-audit',
                                log_group: logData.logGroup,
                                log_stream: logData.logStream
                            };
                        } else {
                            // Other structured logs
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
                                log_type: 'structured'
                            };
                        }
                    } catch (parseError) {
                        // Plain text log message
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
                            log_type: 'raw'
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