const zlib = require('zlib');
const https = require('https');

/**
 * Direct OpenSearch delivery processor for EKS Cluster log events
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
 * Process EKS Cluster log events (audit logs, control plane logs)
 * @param {Object} logData - The log group and stream data
 * @param {Object} logEvent - The individual log event
 * @returns {Object} - Processed log event
 */
function processEksLogEvent(logData, logEvent) {
    const messageJson = tryParseJSON(logEvent.message);
    
    // Base document structure
    const baseDoc = {
        '@timestamp': new Date(logEvent.timestamp).toISOString(),
        '@logStream': logData.logStream,
        '@logGroup': logData.logGroup,
        '@message': logEvent.message
    };
    
    // Kubernetes audit log format
    if (messageJson && messageJson.auditID) {
        return {
            ...baseDoc,
            '@timestamp': messageJson.requestReceivedTimestamp || messageJson.stageTimestamp || baseDoc['@timestamp'],
            // Audit-specific fields
            audit_id: messageJson.auditID,
            kind: messageJson.kind,
            api_version: messageJson.apiVersion,
            level: messageJson.level,
            stage: messageJson.stage,
            request_uri: messageJson.requestURI,
            verb: messageJson.verb,
            user: messageJson.user ? {
                username: messageJson.user.username,
                groups: messageJson.user.groups,
                uid: messageJson.user.uid
            } : null,
            source_ips: messageJson.sourceIPs,
            user_agent: messageJson.userAgent,
            object_ref: messageJson.objectRef ? {
                resource: messageJson.objectRef.resource,
                namespace: messageJson.objectRef.namespace,
                name: messageJson.objectRef.name,
                uid: messageJson.objectRef.uid
            } : null,
            response_status: messageJson.responseStatus ? {
                code: messageJson.responseStatus.code,
                status: messageJson.responseStatus.status
            } : null,
            annotations: messageJson.annotations,
            log_type: 'k8s-audit'
        };
    } 
    // Kubernetes controller manager, scheduler, or API server logs
    else if (messageJson && (messageJson.component || messageJson.level)) {
        return {
            ...baseDoc,
            component: messageJson.component,
            level: messageJson.level,
            message: messageJson.msg || messageJson.message,
            source: messageJson.source,
            log_type: 'k8s-control-plane'
        };
    } 
    // Plain text control plane logs (fallback)
    else {
        // Try to extract component from log stream name
        const component = logData.logStream.includes('kube-apiserver') ? 'kube-apiserver' :
                         logData.logStream.includes('kube-controller-manager') ? 'kube-controller-manager' :
                         logData.logStream.includes('kube-scheduler') ? 'kube-scheduler' :
                         logData.logStream.includes('authenticator') ? 'authenticator' : 'unknown';
        
        return {
            ...baseDoc,
            component: component,
            message: logEvent.message,
            log_type: 'k8s-control-plane-raw'
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
                const processedEvent = processEksLogEvent(logData, logEvent);
                if (processedEvent) {
                    documents.push(processedEvent);
                }
            }
            
            // Send ALL documents directly to OpenSearch
            if (documents.length > 0) {
                console.log(`Sending ${documents.length} documents directly to OpenSearch for record ${record.recordId}`);
                
                const indexResult = await sendBulkToOpenSearch(documents);
                
                if (indexResult.success) {
                    console.log(`✅ Successfully indexed ${indexResult.indexed} EKS documents to OpenSearch`);
                    
                    // Return dummy single document to Firehose (will be ignored by OpenSearch delivery)
                    // The real data was already sent directly to OpenSearch above
                    const dummyDoc = {
                        "@timestamp": new Date().toISOString(),
                        "@message": `Processed ${indexResult.indexed} EKS events via direct delivery`,
                        "@logStream": "lambda-processor-metadata",
                        "@logGroup": "lambda-processed",
                        "metadata": {
                            "processed": true,
                            "documentsIndexed": indexResult.indexed,
                            "deliveryMethod": "direct",
                            "processorType": "eks-processor"
                        }
                    };
                    
                    return {
                        recordId: record.recordId,
                        result: 'Ok',
                        data: Buffer.from(JSON.stringify(dummyDoc)).toString('base64')
                    };
                } else {
                    console.error(`❌ Failed to index EKS documents to OpenSearch for record ${record.recordId}`);
                    return {
                        recordId: record.recordId,
                        result: 'ProcessingFailed'
                    };
                }
            } else {
                console.log(`No EKS documents to process for record ${record.recordId}`);
                const emptyDoc = {
                    "@timestamp": new Date().toISOString(),
                    "@message": "No EKS log events found in this batch",
                    "@logStream": "lambda-processor-metadata",
                    "@logGroup": "lambda-processed",
                    "metadata": {
                        "processed": true,
                        "documentsIndexed": 0,
                        "deliveryMethod": "direct",
                        "processorType": "eks-processor"
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
            "@message": "EKS record processed but no logEvents array found",
            "@logStream": "lambda-processor-metadata",
            "@logGroup": "lambda-processed",
            "metadata": {
                "processed": true,
                "documentsIndexed": 0,
                "deliveryMethod": "direct",
                "processorType": "eks-processor"
            }
        };
        
        return {
            recordId: record.recordId,
            result: 'Ok',
            data: Buffer.from(JSON.stringify(fallbackDoc)).toString('base64')
        };
        
    } catch (error) {
        console.error('Error processing EKS record:', error);
        return {
            recordId: record.recordId,
            result: 'ProcessingFailed'
        };
    }
}

exports.handler = async (event) => {
    console.log('🚀 EKS processor (Direct OpenSearch) invoked with', event.records.length, 'records');
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
    
    console.log(`✅ EKS processor completed: ${output.length} records processed, ${totalDocumentsProcessed} documents indexed to OpenSearch`);
    return { records: output };
};