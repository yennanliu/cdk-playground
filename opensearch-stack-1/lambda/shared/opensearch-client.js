const https = require('https');

/**
 * OpenSearch Client for bulk indexing operations
 * Handles authentication and HTTP communication with OpenSearch
 */
class OpenSearchClient {
    constructor() {
        // Configuration from CDK-provided environment variables
        this.endpoint = process.env.OPENSEARCH_ENDPOINT;
        this.index = process.env.OPENSEARCH_INDEX;
        this.masterUser = process.env.MASTER_USER;
        this.masterPassword = process.env.MASTER_PASSWORD;

        if (!this.endpoint || !this.index || !this.masterUser || !this.masterPassword) {
            throw new Error('Missing required OpenSearch configuration in environment variables');
        }
    }

    /**
     * Send bulk request to OpenSearch using HTTPS
     * @param {Array} documents - Array of documents to index
     * @returns {Promise} - Promise resolving to response
     */
    sendBulkToOpenSearch(documents) {
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
                        _index: this.index,
                        _id: `${doc['@logStream']}-${Date.parse(doc['@timestamp'])}-${require('crypto').randomUUID()}`
                    } 
                }));
                bulkBody.push(JSON.stringify(doc));
            });
            const requestBody = bulkBody.join('\n') + '\n';

            // Create basic auth header
            const auth = Buffer.from(`${this.masterUser}:${this.masterPassword}`).toString('base64');
            
            const options = {
                hostname: this.endpoint,
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
}

module.exports = { OpenSearchClient };