const { StreamingProcessor } = require('../shared/streaming-processor');
const { LogUtils } = require('../shared/log-utils');

/**
 * Direct OpenSearch delivery processor for Pod Application log events
 * Processes ALL log events in each batch and sends them directly to OpenSearch
 * Updated: 2025-08-13 - Refactored to use shared utilities
 */

/**
 * Process Pod Application log events (pod logs from Fluent Bit)
 * @param {Object} logData - The log group and stream data
 * @param {Object} logEvent - The individual log event
 * @returns {Object} - Processed log event
 */
function processPodLogEvent(logData, logEvent) {
    const messageJson = LogUtils.tryParseJSON(logEvent.message);
    const baseDoc = LogUtils.createBaseDocument(logData, logEvent);
    
    // Fluent Bit format with kubernetes metadata
    if (messageJson && messageJson.kubernetes) {
        return {
            ...baseDoc,
            '@message': messageJson.log || messageJson.message || logEvent.message,
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
            labels: messageJson.kubernetes.labels,
            annotations: messageJson.kubernetes.annotations,
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

// Create streaming processor instance
const processor = new StreamingProcessor('pod-processor', processPodLogEvent);

// Export the handler
exports.handler = processor.createHandler();