const zlib = require('zlib');

/**
 * Utility functions for CloudWatch Logs processing
 */
class LogUtils {
    /**
     * Decompress and parse CloudWatch Logs data
     * @param {string} base64Data - Base64 encoded compressed data
     * @returns {Object} - Parsed log data
     */
    static decompressLogData(base64Data) {
        const compressedData = Buffer.from(base64Data, 'base64');
        const decompressedData = zlib.gunzipSync(compressedData);
        return JSON.parse(decompressedData.toString('utf8'));
    }

    /**
     * Try to parse message as JSON
     * @param {string} message - The log message
     * @returns {Object|null} - Parsed JSON or null if not valid JSON
     */
    static tryParseJSON(message) {
        try {
            return JSON.parse(message);
        } catch (error) {
            return null;
        }
    }

    /**
     * Create base document structure for log events
     * @param {Object} logData - The log group and stream data
     * @param {Object} logEvent - The individual log event
     * @param {boolean} includeMessage - Whether to include @message field
     * @returns {Object} - Base document structure
     */
    static createBaseDocument(logData, logEvent, includeMessage = false) {
        const baseDoc = {
            '@timestamp': new Date(logEvent.timestamp).toISOString(),
            '@logStream': logData.logStream,
            '@logGroup': logData.logGroup
        };
        
        if (includeMessage) {
            baseDoc['@message'] = logEvent.message;
        }
        
        return baseDoc;
    }

    /**
     * Create metadata document for processing statistics
     * @param {number} documentsIndexed - Number of documents indexed
     * @param {string} processorType - Type of processor (e.g., 'pod-processor')
     * @returns {Object} - Metadata document
     */
    static createMetadataDocument(documentsIndexed, processorType) {
        return {
            "@timestamp": new Date().toISOString(),
            "@message": documentsIndexed > 0 
                ? `Processed ${documentsIndexed} ${processorType.replace('-processor', '')} events via direct delivery`
                : `No ${processorType.replace('-processor', '')} log events found in this batch`,
            "@logStream": "lambda-processor-metadata",
            "@logGroup": "lambda-processed",
            "metadata": {
                "processed": true,
                "documentsIndexed": documentsIndexed,
                "deliveryMethod": "direct",
                "processorType": processorType
            }
        };
    }
}

module.exports = { LogUtils };