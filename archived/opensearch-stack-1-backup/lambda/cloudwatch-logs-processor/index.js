const AWS = require('aws-sdk');
const zlib = require('zlib');

const opensearch = new AWS.OpenSearch();

exports.handler = async (event) => {
    console.log('Received event:', JSON.stringify(event, null, 2));
    
    try {
        // Parse CloudWatch Logs data
        const compressedPayload = Buffer.from(event.awslogs.data, 'base64');
        const payload = JSON.parse(zlib.gunzipSync(compressedPayload).toString('utf8'));
        
        console.log('Decoded payload:', JSON.stringify(payload, null, 2));
        
        const logEvents = payload.logEvents;
        const logGroup = payload.logGroup;
        const logStream = payload.logStream;
        
        // Prepare documents for OpenSearch
        const documents = [];
        
        for (const logEvent of logEvents) {
            const document = {
                timestamp: new Date(logEvent.timestamp).toISOString(),
                message: logEvent.message,
                logGroup: logGroup,
                logStream: logStream,
                id: logEvent.id
            };
            
            // Try to parse JSON messages
            try {
                const parsedMessage = JSON.parse(logEvent.message);
                document.parsedMessage = parsedMessage;
            } catch (e) {
                // If not JSON, keep as plain text
            }
            
            documents.push(document);
        }
        
        // Bulk index to OpenSearch
        if (documents.length > 0) {
            await indexToOpenSearch(documents);
        }
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: `Successfully processed ${documents.length} log events`
            })
        };
        
    } catch (error) {
        console.error('Error processing logs:', error);
        throw error;
    }
};

async function indexToOpenSearch(documents) {
    const endpoint = process.env.OPENSEARCH_ENDPOINT;
    const indexName = process.env.OPENSEARCH_INDEX || 'cloudwatch-logs';
    
    if (!endpoint) {
        throw new Error('OPENSEARCH_ENDPOINT environment variable is required');
    }
    
    const https = require('https');
    const aws4 = require('aws4');
    
    // Prepare bulk request body
    let bulkBody = '';
    for (const doc of documents) {
        const indexAction = { index: { _index: indexName } };
        bulkBody += JSON.stringify(indexAction) + '\n';
        bulkBody += JSON.stringify(doc) + '\n';
    }
    
    // Sign the request
    const requestOptions = {
        hostname: endpoint.replace('https://', ''),
        port: 443,
        path: '/_bulk',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bulkBody)
        },
        body: bulkBody
    };
    
    // Sign with AWS credentials
    aws4.sign(requestOptions, {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN
    });
    
    return new Promise((resolve, reject) => {
        const req = https.request(requestOptions, (res) => {
            let responseBody = '';
            
            res.on('data', (chunk) => {
                responseBody += chunk;
            });
            
            res.on('end', () => {
                console.log('OpenSearch response:', responseBody);
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(responseBody));
                } else {
                    reject(new Error(`OpenSearch request failed with status ${res.statusCode}: ${responseBody}`));
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.write(bulkBody);
        req.end();
    });
}