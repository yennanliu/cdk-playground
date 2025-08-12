const { LogProcessor } = require('../../shared/log-processing');

const processor = new LogProcessor();

/**
 * Process EKS Application log events (pod logs from Fluent Bit)
 * @param {Object} logData - The log group and stream data
 * @param {Object} logEvent - The individual log event
 * @param {LogProcessor} processorInstance - The processor instance for utility functions
 * @returns {Object} - Processed log event
 */
function processPodLogEvent(logData, logEvent, processorInstance) {
    const messageJson = processorInstance.tryParseJSON(logEvent.message);
    
    // Fluent Bit format with kubernetes metadata
    if (messageJson && messageJson.kubernetes) {
        const uniqueId = processorInstance.generateUniqueId(
            logData, 
            logEvent, 
            messageJson.kubernetes.pod_id || messageJson.kubernetes.pod_name || ''
        );
        
        return {
            id: `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${uniqueId}`,
            ...processorInstance.createBaseLogEvent(logData, logEvent, 'pod-application'),
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
            // Pod labels and annotations
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
        const uniqueId = processorInstance.generateUniqueId(logData, logEvent, JSON.stringify(messageJson));
        
        return {
            id: `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${uniqueId}`,
            ...processorInstance.createBaseLogEvent(logData, logEvent, 'pod-direct'),
            message: messageJson.log || messageJson.message,
            stream: messageJson.stream,
            time: messageJson.time,
            log_type: 'pod-direct'
        };
    }
    // Multi-line structured application logs (JSON from apps)
    else if (messageJson && !messageJson.kubernetes) {
        const uniqueId = processorInstance.generateUniqueId(logData, logEvent, JSON.stringify(messageJson));
        
        return {
            id: `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${uniqueId}`,
            ...processorInstance.createBaseLogEvent(logData, logEvent, 'app-structured'),
            // Preserve original structure for structured app logs
            app_data: messageJson,
            log_type: 'app-structured'
        };
    } 
    // Plain text pod logs
    else {
        const uniqueId = processorInstance.generateUniqueId(logData, logEvent, logEvent.message);
        
        return {
            id: `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${uniqueId}`,
            ...processorInstance.createBaseLogEvent(logData, logEvent, 'pod-raw'),
            message: logEvent.message,
            log_type: 'pod-raw'
        };
    }
}

exports.handler = async (event) => {
    const output = [];
    
    for (const record of event.records) {
        const outputRecord = processor.processRecord(record, processPodLogEvent);
        output.push(outputRecord);
    }
    
    return { records: output };
};