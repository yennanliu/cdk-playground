const { StreamingProcessor } = require('../shared/streaming-processor');
const { LogUtils } = require('../shared/log-utils');

/**
 * Direct OpenSearch delivery processor for EKS Cluster log events
 * Processes ALL log events in each batch and sends them directly to OpenSearch
 * Updated: 2025-08-13 - Refactored to use shared utilities
 */

/**
 * Process EKS Cluster log events (audit logs, control plane logs)
 * @param {Object} logData - The log group and stream data
 * @param {Object} logEvent - The individual log event
 * @returns {Object} - Processed log event
 */
function processEksLogEvent(logData, logEvent) {
    const messageJson = LogUtils.tryParseJSON(logEvent.message);
    const baseDoc = LogUtils.createBaseDocument(logData, logEvent, true);
    
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

// Create streaming processor instance
const processor = new StreamingProcessor('eks-processor', processEksLogEvent);

// Export the handler
exports.handler = processor.createHandler();