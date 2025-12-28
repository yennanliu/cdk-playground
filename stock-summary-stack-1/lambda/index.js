const axios = require('axios');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-5-sonnet-20241022-v2:0';

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const ticker = body.ticker?.toUpperCase().trim();

    // Validate ticker
    if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Invalid ticker symbol',
          message: 'Ticker must be a valid US stock symbol (1-5 uppercase letters)',
        }),
      };
    }

    console.log(`Processing ticker: ${ticker}`);

    // Scrape news from Google News
    const newsUrl = `https://www.google.com/search?q=${ticker}+stock+news&tbm=nws`;
    console.log(`Fetching news from: ${newsUrl}`);

    const response = await axios.get(newsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      timeout: 10000,
    });

    const htmlContent = response.data;
    console.log(`Fetched HTML content: ${htmlContent.length} characters`);

    // Truncate HTML if too large (Claude has 200K token context, ~100K chars is safe)
    const truncatedHtml = htmlContent.slice(0, 100000);

    // Prepare prompt for Bedrock
    const prompt = `You are a financial news analyst. You will receive HTML content from a web search for "${ticker} stock news". Your task is to:

1. Extract recent news headlines and content from the HTML
2. Identify the most important and relevant news items
3. Summarize them as concise bullet points (3-7 points)
4. Analyze the overall sentiment

Focus on:
- Major company announcements
- Financial performance and earnings
- Product launches or changes
- Market-moving events
- Regulatory or legal developments
- Recent developments (past 7 days preferred)

HTML Content:
${truncatedHtml}

Return your response as a JSON object with this exact structure:
{
  "summary": ["bullet point 1", "bullet point 2", ...],
  "sentiment": "positive|neutral|negative",
  "sources": ["url1", "url2", ...]
}

If no relevant news is found, return an empty summary array. Be concise and focus on the most important information.`;

    // Call Bedrock
    console.log('Calling Bedrock...');
    const bedrockCommand = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    const bedrockResponse = await bedrockClient.send(bedrockCommand);
    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
    console.log('Bedrock response:', JSON.stringify(responseBody, null, 2));

    // Parse Claude's response
    const claudeText = responseBody.content[0].text;
    console.log('Claude text:', claudeText);

    // Extract JSON from Claude's response (it might include markdown code blocks)
    let summaryData;
    const jsonMatch = claudeText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      summaryData = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('Failed to parse JSON from Claude response');
    }

    // Build response
    const result = {
      ticker,
      summary: summaryData.summary || [],
      sentiment: summaryData.sentiment || 'neutral',
      sources: summaryData.sources || [],
      timestamp: new Date().toISOString(),
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('Error:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Service unavailable',
        message: error.message || 'Unable to fetch news or generate summary',
      }),
    };
  }
};
