const zlib = require('zlib');
const https = require('https');

/**
 * Direct OpenSearch delivery processor for Pod Application log events
 * Processes ALL log events in each batch and sends them directly to OpenSearch
 * Updated: 2025-08-13 - Implementing zero data loss streaming buffer approach
 */

// OpenSearch configuration from CDK-provided environment variables
const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT;
const OPENSEARCH_INDEX = process.env.OPENSEARCH_INDEX;
const MASTER_USER = process.env.MASTER_USER;
const MASTER_PASSWORD = process.env.MASTER_PASSWORD;

/**
 * Decompress and parse CloudWatch Logs data
 * @param {string} base64Data - Base64 encoded compressed data
 * @returns {Object} - Parsed log data
 */
function decompressLogData(base64Data) {
    const compressedData = Buffer.from(base64Data, 'base64');
    const decompressedData = zlib.gunzipSync(compressedData);
    return JSON.parse(decompressedData.toString('utf8'));
}

/**
 * Send bulk request to OpenSearch using HTTPS
 * @param {Array} documents - Array of documents to index
 * @returns {Promise} - Promise resolving to response
 */
function sendBulkToOpenSearch(documents) {
    return new Promise((resolve, reject) => {
        if (!documents || documents.length === 0) {
            resolve({ success: true, indexed: 0 });
            return;
        }

        // Create bulk request body (NDJSON format)
        const bulkBody = [];
        documents.forEach(doc => {
            bulkBody.push(JSON.stringify({ 
                index: { 
                    _index: OPENSEARCH_INDEX,
                    _id: `${doc['@logStream']}-${Date.parse(doc['@timestamp'])}-${Math.random().toString(36).substr(2, 9)}`
                } 
            }));
            bulkBody.push(JSON.stringify(doc));
        });
        const requestBody = bulkBody.join('\n') + '\n';

        // Create basic auth header
        const auth = Buffer.from(`${MASTER_USER}:${MASTER_PASSWORD}`).toString('base64');
        
        const options = {
            hostname: OPENSEARCH_ENDPOINT,
            port: 443,
            path: '/_bulk',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${auth}`,
                'Content-Length': Buffer.byteLength(requestBody)
            }
        };

        const req = https.request(options, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => {
                responseBody += chunk;
            });
            
            res.on('end', () => {
                try {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        const response = JSON.parse(responseBody);
                        if (response.errors) {
                            console.warn('Some documents failed to index:', JSON.stringify(response.items));
                        }
                        resolve({ 
                            success: !response.errors, 
                            indexed: documents.length,
                            response: response 
                        });
                    } else {
                        console.error(`OpenSearch request failed: ${res.statusCode} ${res.statusMessage}`);
                        console.error('Response:', responseBody);
                        reject(new Error(`OpenSearch request failed: ${res.statusCode}`));
                    }
                } catch (error) {
                    console.error('Failed to parse OpenSearch response:', error);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.error('HTTPS request error:', error);
            reject(error);
        });

        req.write(requestBody);
        req.end();
    });
}

/**
 * Try to parse message as JSON
 * @param {string} message - The log message
 * @returns {Object|null} - Parsed JSON or null if not valid JSON
 */
function tryParseJSON(message) {
    try {
        return JSON.parse(message);
    } catch (error) {
        return null;
    }
}

/**
 * Process EKS Application log events (pod logs from Fluent Bit)
 * @param {Object} logData - The log group and stream data
 * @param {Object} logEvent - The individual log event
 * @returns {Object} - Processed log event
 */
function processPodLogEvent(logData, logEvent) {
    const messageJson = tryParseJSON(logEvent.message);
    
    // Base document structure
    const baseDoc = {
        '@timestamp': new Date(logEvent.timestamp).toISOString(),
        '@logStream': logData.logStream,
        '@logGroup': logData.logGroup
    };
    
    // Fluent Bit format with kubernetes metadata
    if (messageJson && messageJson.kubernetes) {
        return {
            ...baseDoc,
            '@message': messageJson.log || messageJson.message || logEvent.message,
            // Application log content
            message: messageJson.log || messageJson.message,
            stream: messageJson.stream,
            time: messageJson.time,
            // Kubernetes metadata
            pod_name: messageJson.kubernetes.pod_name,
            namespace: messageJson.kubernetes.namespace_name,
            container_name: messageJson.kubernetes.container_name,
            container_image: messageJson.kubernetes.container_image,
            container_image_id: messageJson.kubernetes.container_image_id,
            pod_id: messageJson.kubernetes.pod_id,
            pod_ip: messageJson.kubernetes.pod_ip,
            host: messageJson.kubernetes.host,
            node_name: messageJson.kubernetes.node_name,
            // Pod labels and annotations (flatten for better searchability)
            labels: messageJson.kubernetes.labels,
            annotations: messageJson.kubernetes.annotations,
            // Docker metadata
            docker_id: messageJson.kubernetes.docker_id,
            container_hash: messageJson.kubernetes.container_hash,
            log_type: 'pod-application'
        };
    } 
    // Direct container logs without Fluent Bit metadata
    else if (messageJson && (messageJson.log || messageJson.message)) {
        return {
            ...baseDoc,
            '@message': messageJson.log || messageJson.message,
            message: messageJson.log || messageJson.message,
            stream: messageJson.stream,
            time: messageJson.time,
            log_type: 'pod-direct'
        };
    }
    // Multi-line structured application logs (JSON from apps)
    else if (messageJson && !messageJson.kubernetes) {
        return {
            ...baseDoc,
            '@message': logEvent.message,
            // Preserve original structure for structured app logs
            app_data: messageJson,
            log_type: 'app-structured'
        };
    } 
    // Plain text pod logs
    else {
        return {
            ...baseDoc,
            '@message': logEvent.message,
            message: logEvent.message,
            log_type: 'pod-raw'
        };
    }
}

/**
 * Process a single record from Firehose and send ALL events directly to OpenSearch
 * @param {Object} record - Firehose record
 * @returns {Object} - Processed output record
 */
async function processRecordDirectToOpenSearch(record) {
    try {
        const logData = decompressLogData(record.data);
        
        if (logData.logEvents && Array.isArray(logData.logEvents)) {
            const documents = [];
            
            // Process ALL log events (not just the first one)
            for (const logEvent of logData.logEvents) {
                const processedEvent = processPodLogEvent(logData, logEvent);
                if (processedEvent) {
                    documents.push(processedEvent);
                }
            }
            
            // Send ALL documents directly to OpenSearch
            if (documents.length > 0) {
                console.log(`Sending ${documents.length} documents directly to OpenSearch for record ${record.recordId}`);
                
                const indexResult = await sendBulkToOpenSearch(documents);
                
                if (indexResult.success) {
                    console.log(`✅ Successfully indexed ${indexResult.indexed} pod documents to OpenSearch`);
                    
                    // Return dummy single document to Firehose (will be ignored by OpenSearch delivery)
                    // The real data was already sent directly to OpenSearch above
                    const dummyDoc = {
                        "@timestamp": new Date().toISOString(),
                        "@message": `Processed ${indexResult.indexed} pod events via direct delivery`,
                        "@logStream": "lambda-processor-metadata",
                        "@logGroup": "lambda-processed",
                        "metadata": {
                            "processed": true,
                            "documentsIndexed": indexResult.indexed,
                            "deliveryMethod": "direct",
                            "processorType": "pod-processor"
                        }
                    };
                    
                    return {
                        recordId: record.recordId,
                        result: 'Ok',
                        data: Buffer.from(JSON.stringify(dummyDoc)).toString('base64')
                    };
                } else {
                    console.error(`❌ Failed to index pod documents to OpenSearch for record ${record.recordId}`);
                    return {
                        recordId: record.recordId,
                        result: 'ProcessingFailed'
                    };
                }
            } else {
                console.log(`No pod documents to process for record ${record.recordId}`);
                const emptyDoc = {
                    "@timestamp": new Date().toISOString(),
                    "@message": "No pod log events found in this batch",
                    "@logStream": "lambda-processor-metadata",
                    "@logGroup": "lambda-processed",
                    "metadata": {
                        "processed": true,
                        "documentsIndexed": 0,
                        "deliveryMethod": "direct",
                        "processorType": "pod-processor"
                    }
                };
                
                return {
                    recordId: record.recordId,
                    result: 'Ok',
                    data: Buffer.from(JSON.stringify(emptyDoc)).toString('base64')
                };
            }
        }
        
        // Fallback for records without logEvents
        console.log(`No logEvents found in record ${record.recordId}`);
        const fallbackDoc = {
            "@timestamp": new Date().toISOString(),
            "@message": "Pod record processed but no logEvents array found",
            "@logStream": "lambda-processor-metadata",
            "@logGroup": "lambda-processed",
            "metadata": {
                "processed": true,
                "documentsIndexed": 0,
                "deliveryMethod": "direct",
                "processorType": "pod-processor"
            }
        };
        
        return {
            recordId: record.recordId,
            result: 'Ok',
            data: Buffer.from(JSON.stringify(fallbackDoc)).toString('base64')
        };
        
    } catch (error) {
        console.error('Error processing pod record:', error);
        return {
            recordId: record.recordId,
            result: 'ProcessingFailed'
        };
    }
}

exports.handler = async (event) => {
    console.log('🚀 Pod processor (Direct OpenSearch) invoked with', event.records.length, 'records');
    const output = [];
    let totalDocumentsProcessed = 0;
    
    for (const record of event.records) {
        const outputRecord = await processRecordDirectToOpenSearch(record);
        
        // Extract document count from successful responses
        if (outputRecord.result === 'Ok' && outputRecord.data) {
            try {
                const metadata = JSON.parse(Buffer.from(outputRecord.data, 'base64').toString());
                totalDocumentsProcessed += metadata.metadata?.documentsIndexed || 0;
            } catch (e) {
                // Ignore parsing errors for metadata
            }
        }
        
        console.log('Processed record:', outputRecord.recordId, outputRecord.result);
        output.push(outputRecord);
    }
    
    console.log(`✅ Pod processor completed: ${output.length} records processed, ${totalDocumentsProcessed} documents indexed to OpenSearch`);
    return { records: output };
};