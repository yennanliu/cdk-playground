const zlib = require('zlib');
const crypto = require('crypto');

class LogProcessor {
    constructor() {}

    /**
     * Generate a unique ID for a log event
     * @param {Object} logData - The log group and stream data
     * @param {Object} logEvent - The individual log event
     * @param {string} additionalData - Additional data for uniqueness
     * @returns {string} - Unique ID
     */
    generateUniqueId(logData, logEvent, additionalData = '') {
        const baseString = `${logData.logGroup}-${logData.logStream}-${logEvent.timestamp}-${additionalData}`;
        return crypto.createHash('sha256')
            .update(baseString)
            .digest('hex')
            .substring(0, 16);
    }

    /**
     * Decompress and parse CloudWatch Logs data
     * @param {string} base64Data - Base64 encoded compressed data
     * @returns {Object} - Parsed log data
     */
    decompressLogData(base64Data) {
        const compressedData = Buffer.from(base64Data, 'base64');
        const decompressedData = zlib.gunzipSync(compressedData);
        return JSON.parse(decompressedData.toString('utf8'));
    }

    /**
     * Create a base log event structure
     * @param {Object} logData - The log group and stream data
     * @param {Object} logEvent - The individual log event
     * @param {string} logType - Type of log for categorization
     * @returns {Object} - Base log event structure
     */
    createBaseLogEvent(logData, logEvent, logType) {
        return {
            '@timestamp': new Date(logEvent.timestamp).toISOString(),
            timestamp: new Date(logEvent.timestamp).toISOString(),
            log_group: logData.logGroup,
            log_stream: logData.logStream,
            cluster: 'eks-cluster',
            log_type: logType
        };
    }

    /**
     * Try to parse message as JSON
     * @param {string} message - The log message
     * @returns {Object|null} - Parsed JSON or null if not valid JSON
     */
    tryParseJSON(message) {
        try {
            return JSON.parse(message);
        } catch (error) {
            return null;
        }
    }

    /**
     * Process a single record from Firehose
     * @param {Object} record - Firehose record
     * @param {Function} processLogEvent - Function to process individual log events
     * @returns {Object} - Processed output record
     */
    processRecord(record, processLogEvent) {
        try {
            const logData = this.decompressLogData(record.data);
            
            if (logData.logEvents && Array.isArray(logData.logEvents)) {
                const processedEvents = [];
                
                for (const logEvent of logData.logEvents) {
                    const processedEvent = processLogEvent(logData, logEvent, this);
                    if (processedEvent) {
                        processedEvents.push(processedEvent);
                    }
                }
                
                // Take only the first processed event to maintain 1:1 record mapping
                // OpenSearch expects exactly one JSON document per Firehose record
                const firstEvent = processedEvents[0];
                
                if (firstEvent) {
                    return {
                        recordId: record.recordId,
                        result: 'Ok',
                        data: Buffer.from(JSON.stringify(firstEvent), 'utf8').toString('base64')
                    };
                }
            }
            
            // No log events, pass through as-is but decompressed
            return {
                recordId: record.recordId,
                result: 'Ok',
                data: Buffer.from(logData.toString(), 'utf8').toString('base64')
            };
            
        } catch (error) {
            console.error('Error processing record:', error);
            return {
                recordId: record.recordId,
                result: 'ProcessingFailed'
            };
        }
    }
}

module.exports = { LogProcessor };