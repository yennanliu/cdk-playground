const zlib = require('zlib');

/**
 * Simple processor for Maze Application log events
 * Creates documents with the expected schema: @timestamp, @message, @logStream
 * Updated: 2025-08-12 - Fixed schema to match OpenSearch expectations
 */

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
 * Process Maze Application log events with simple schema
 * @param {Object} logData - The log group and stream data
 * @param {Object} logEvent - The individual log event
 * @returns {Object} - Processed log event with @timestamp, @message, @logStream
 */
function processMazeLogEvent(logData, logEvent) {
    return {
        '@timestamp': new Date(logEvent.timestamp).toISOString(),
        '@message': logEvent.message,
        '@logStream': logData.logStream
    };
}

/**
 * Process a single record from Firehose
 * @param {Object} record - Firehose record
 * @returns {Object} - Processed output record
 */
function processRecord(record) {
    try {
        const logData = decompressLogData(record.data);
        
        if (logData.logEvents && Array.isArray(logData.logEvents)) {
            const processedEvents = [];
            
            for (const logEvent of logData.logEvents) {
                const processedEvent = processMazeLogEvent(logData, logEvent);
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
        
        // Fallback - pass through as-is
        return {
            recordId: record.recordId,
            result: 'Ok',
            data: record.data
        };
        
    } catch (error) {
        console.error('Error processing record:', error);
        return {
            recordId: record.recordId,
            result: 'ProcessingFailed'
        };
    }
}

exports.handler = async (event) => {
    console.log('Maze processor invoked with', event.records.length, 'records');
    const output = [];
    
    for (const record of event.records) {
        const outputRecord = processRecord(record);
        console.log('Processed record:', outputRecord.recordId, outputRecord.result);
        output.push(outputRecord);
    }
    
    console.log('Maze processor completed, returning', output.length, 'records');
    return { records: output };
};