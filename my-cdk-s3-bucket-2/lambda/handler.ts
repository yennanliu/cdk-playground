import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});

export const handler = async (event: any = {}): Promise<any> => {
    const timestamp = new Date().toISOString();
    const bucketName = process.env.BUCKET_NAME;
    const key = `timestamp-${timestamp}.txt`;

    // Save the entire event as the file content (JSON string)
    console.log(`>>> event: ${JSON.stringify(event)}`);
    // const event2 = {
    //     'a': addEventListener, 'b': event, 'c': timestamp, 'd': bucketName, 'e': key, 'f': process.env.BUCKET_NAME
    //     , 'g': process.env.AWS_REGION, 'h': process.env.AWS_LAMBDA_FUNCTION_NAME, 'i': process.env.AWS_LAMBDA_FUNCTION_VERSION
    // };
    const event2 = {
        a: 'addEventListener',
        c: timestamp,
        d: bucketName,
        e: key,
    }
    console.log(`>>> event2: ${JSON.stringify(event2)}`);
    const bodyContent = JSON.stringify(event2);

    const putParams = {
        Bucket: bucketName,
        Key: key,
        Body: bodyContent,
        ContentType: 'application/json',
    };

    try {
        await s3.send(new PutObjectCommand(putParams));
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Content saved', key }),
        };
    } catch (err) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: (err as Error)?.message || String(err) }),
        };
    }
};

// Scrape http://books.toscrape.com/ and return the HTML content
export const scrapeBooksToScrape = async (): Promise<any> => {
    const url = 'http://books.toscrape.com/';
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        }

        const bodyContent = JSON.stringify(response.headers);
        console.log(`>>> response headers: ${bodyContent}`);
        console.log(`>>> response status: ${response.status}`);
        const html = await response.text();
        // save to S3 bucket
        const bucketName = process.env.BUCKET_NAME;
        const key = `scraped-books-${new Date().toISOString()}.html`;
        const putParams = {
            Bucket: bucketName,
            Key: key,
            Body: html,
            ContentType: 'text/html',
        };
        await s3.send(new PutObjectCommand(putParams));
        console.log(`>>> Scraped HTML saved to S3 bucket: ${bucketName}, key: ${key}`);
        // Return the HTML content
        console.log(`>>> Scraped HTML content length: ${html.length}`);
        console.log(`>>> Scraped HTML content: ${html.substring(0, 100)}...`); // Log first 100 characters for brevity  
        return {
            statusCode: 200,
            body: html
        };
    } catch (err) {
        console.error('Scraping error:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: (err as Error)?.message || String(err) })
        };
    }
};


export const handlerMath = async (event: any = {}): Promise<any> => {
    const timestamp = new Date().toISOString();
    const bucketName = process.env.BUCKET_NAME;
    const key = `timestamp-${timestamp}.txt`;

    // get some random number
    const randomNumber = Math.floor(Math.random() * 100);

    for (let i = 0; i < 10; i++) {
        console.log(`>>> i: ${i}`);

        console.log(`>>> randomNumber: ${randomNumber}`);

        const event2 = {
            randomNumber: randomNumber,
        }
        console.log(`>>> event2: ${JSON.stringify(event2)}`);
        const bodyContent = JSON.stringify(event2);

        const putParams = {
            Bucket: bucketName,
            Key: key,
            Body: bodyContent,
            ContentType: 'application/json',
        };

        try {
            await s3.send(new PutObjectCommand(putParams));
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Content saved', key }),
            };
        } catch (err) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: (err as Error)?.message || String(err) }),
            }
        }
    }
};


export const wikiScraper = async (event: any = {}): Promise<any> => {
    try {
        // Get keyword from query parameters, default to '维基百科' if not provided
        const keyword = event.queryStringParameters?.keyword || 'TESLA';
        const encodedKeyword = encodeURIComponent(keyword);

        // Construct the URL with the keyword
        const url = `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodedKeyword}&format=json&formatversion=2`;
        console.log(`>>> Searching Wikipedia for: ${keyword}, encodedKeyword= ${encodedKeyword}`);

        // Make the GET request to Wikipedia API
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        }

        // Parse the JSON response
        const jsonData = await response.json();
        console.log('>>> Wiki API response:', JSON.stringify(jsonData, null, 2));

        // Prepare to save to S3
        const timestamp = new Date().toISOString();
        const bucketName = process.env.BUCKET_NAME;
        const key = `wiki-data-${timestamp}.json`;

        const putParams = {
            Bucket: bucketName,
            Key: key,
            Body: JSON.stringify(jsonData, null, 2), // Pretty print JSON
            ContentType: 'application/json',
        };

        // Save to S3
        await s3.send(new PutObjectCommand(putParams));
        console.log(`>>> JSON data saved to S3 bucket: ${bucketName}, key: ${key}`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Wikipedia data saved successfully',
                key,
                data: jsonData // Including the data in the response
            })
        };
    } catch (err) {
        console.error('Error in wikiScraper:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: (err as Error)?.message || String(err) })
        };
    }
};