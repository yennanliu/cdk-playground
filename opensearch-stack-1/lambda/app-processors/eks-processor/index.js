const { LogProcessor } = require('../../shared/log-processing');

const processor = new LogProcessor();

/**
 * Process EKS Cluster log events (audit logs, control plane logs)
 * @param {Object} logData - The log group and stream data
 * @param {Object} logEvent - The individual log event
 * @param {LogProcessor} processorInstance - The processor instance for utility functions
 * @returns {Object} - Processed log event
 */
function processEksLogEvent(logData, logEvent, processorInstance) {
    const messageJson = processorInstance.tryParseJSON(logEvent.message);
    
    // Kubernetes audit log format
    if (messageJson && messageJson.auditID) {
        const uniqueId = `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${messageJson.auditID}`;
        
        return {
            id: uniqueId,
            ...processorInstance.createBaseLogEvent(logData, logEvent, 'k8s-audit'),
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
        const uniqueId = processorInstance.generateUniqueId(logData, logEvent, JSON.stringify(messageJson));
        
        return {
            id: `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${uniqueId}`,
            ...processorInstance.createBaseLogEvent(logData, logEvent, 'k8s-control-plane'),
            component: messageJson.component,
            level: messageJson.level,
            message: messageJson.msg || messageJson.message,
            source: messageJson.source,
            log_type: 'k8s-control-plane'
        };
    } 
    // Plain text control plane logs (fallback)
    else {
        const uniqueId = processorInstance.generateUniqueId(logData, logEvent, logEvent.message);
        
        // Try to extract component from log stream name
        const component = logData.logStream.includes('kube-apiserver') ? 'kube-apiserver' :
                         logData.logStream.includes('kube-controller-manager') ? 'kube-controller-manager' :
                         logData.logStream.includes('kube-scheduler') ? 'kube-scheduler' :
                         logData.logStream.includes('authenticator') ? 'authenticator' : 'unknown';
        
        return {
            id: `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${uniqueId}`,
            ...processorInstance.createBaseLogEvent(logData, logEvent, 'k8s-control-plane-raw'),
            component: component,
            message: logEvent.message,
            log_type: 'k8s-control-plane-raw'
        };
    }
}

exports.handler = async (event) => {
    const output = [];
    
    for (const record of event.records) {
        const outputRecord = processor.processRecord(record, processEksLogEvent);
        output.push(outputRecord);
    }
    
    return { records: output };
};