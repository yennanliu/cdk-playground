const { StreamingProcessor } = require('../shared/streaming-processor');

/**
 * Direct OpenSearch delivery processor for Maze Application log events
 * Processes ALL log events in each batch and sends them directly to OpenSearch
 * Updated: 2025-08-13 - Refactored to use shared utilities
 */


/**
 * Process Maze Application log events with simple schema
 * @param {Object} logData - The log group and stream data
 * @param {Object} logEvent - The individual log event
 * @returns {Object} - Processed log event with @timestamp, @message, @logStream
 */
function processMazeLogEvent(logData, logEvent) {
    return {
        '@timestamp': new Date(logEvent.timestamp).toISOString(),
        '@message': logEvent.message,
        '@logStream': logData.logStream,
        '@logGroup': logData.logGroup
    };
}

// Create streaming processor instance
const processor = new StreamingProcessor('maze-processor', processMazeLogEvent);

// Export the handler
exports.handler = processor.createHandler();