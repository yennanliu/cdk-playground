const { OpenSearchClient } = require('./opensearch-client');
const { LogUtils } = require('./log-utils');

/**
 * Shared streaming processor for direct OpenSearch delivery
 * Handles common record processing logic and metadata creation
 */
class StreamingProcessor {
    constructor(processorType, logEventProcessor) {
        this.processorType = processorType;
        this.logEventProcessor = logEventProcessor;
        this.openSearchClient = new OpenSearchClient();
    }

    /**
     * Process a single record from Firehose and send ALL events directly to OpenSearch
     * @param {Object} record - Firehose record
     * @returns {Object} - Processed output record
     */
    async processRecordDirectToOpenSearch(record) {
        try {
            const logData = LogUtils.decompressLogData(record.data);
            
            if (logData.logEvents && Array.isArray(logData.logEvents)) {
                const documents = [];
                
                // Process ALL log events using the provided processor function
                for (const logEvent of logData.logEvents) {
                    const processedEvent = this.logEventProcessor(logData, logEvent);
                    if (processedEvent) {
                        documents.push(processedEvent);
                    }
                }
                
                // Send ALL documents directly to OpenSearch
                if (documents.length > 0) {
                    console.log(`Sending ${documents.length} documents directly to OpenSearch for record ${record.recordId}`);
                    
                    const indexResult = await this.openSearchClient.sendBulkToOpenSearch(documents);
                    
                    if (indexResult.success) {
                        console.log(`✅ Successfully indexed ${indexResult.indexed} ${this.processorType.replace('-processor', '')} documents to OpenSearch`);
                        
                        // Return metadata document
                        const metadataDoc = LogUtils.createMetadataDocument(indexResult.indexed, this.processorType);
                        
                        return {
                            recordId: record.recordId,
                            result: 'Ok',
                            data: Buffer.from(JSON.stringify(metadataDoc)).toString('base64')
                        };
                    } else {
                        console.error(`❌ Failed to index ${this.processorType.replace('-processor', '')} documents to OpenSearch for record ${record.recordId}`);
                        return {
                            recordId: record.recordId,
                            result: 'ProcessingFailed'
                        };
                    }
                } else {
                    console.log(`No ${this.processorType.replace('-processor', '')} documents to process for record ${record.recordId}`);
                    const emptyDoc = LogUtils.createMetadataDocument(0, this.processorType);
                    
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
                "@message": `${this.processorType.replace('-processor', '').toUpperCase()} record processed but no logEvents array found`,
                "@logStream": "lambda-processor-metadata",
                "@logGroup": "lambda-processed",
                "metadata": {
                    "processed": true,
                    "documentsIndexed": 0,
                    "deliveryMethod": "direct",
                    "processorType": this.processorType
                }
            };
            
            return {
                recordId: record.recordId,
                result: 'Ok',
                data: Buffer.from(JSON.stringify(fallbackDoc)).toString('base64')
            };
            
        } catch (error) {
            console.error(`Error processing ${this.processorType.replace('-processor', '')} record:`, error);
            return {
                recordId: record.recordId,
                result: 'ProcessingFailed'
            };
        }
    }

    /**
     * Lambda handler factory - creates a handler function for the processor
     * @returns {Function} - Lambda handler function
     */
    createHandler() {
        return async (event) => {
            console.log(`🚀 ${this.processorType} (Direct OpenSearch) invoked with`, event.records.length, 'records');
            const output = [];
            let totalDocumentsProcessed = 0;
            
            for (const record of event.records) {
                const outputRecord = await this.processRecordDirectToOpenSearch(record);
                
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
            
            console.log(`✅ ${this.processorType} completed: ${output.length} records processed, ${totalDocumentsProcessed} documents indexed to OpenSearch`);
            return { records: output };
        };
    }
}

module.exports = { StreamingProcessor };