import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as https from 'https';
import * as http from 'http';
import { v4 as uuidv4 } from 'uuid';

const s3Client = new S3Client({});
const MUSIC_BUCKET_NAME = process.env.MUSIC_BUCKET_NAME!;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

interface GenerateRequest {
  prompt: string;
  duration?: number;
  genre?: string;
}

interface LambdaEvent {
  body: string;
  headers?: Record<string, string>;
}

export const handler = async (event: LambdaEvent) => {
  try {
    console.log('Received event:', JSON.stringify(event));

    // Parse request
    const body: GenerateRequest = JSON.parse(event.body || '{}');
    const { prompt, duration = 30, genre } = body;

    if (!prompt) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Prompt is required' }),
      };
    }

    // Construct full prompt with genre if provided
    const fullPrompt = genre ? `${genre} music: ${prompt}` : prompt;
    console.log('Generating music with prompt:', fullPrompt);

    // Check if Replicate API token is available
    if (!REPLICATE_API_TOKEN) {
      console.warn('REPLICATE_API_TOKEN not set. Using mock generation.');
      return await generateMockMusic(fullPrompt, duration);
    }

    // Call Replicate API
    const audioUrl = await generateMusicWithReplicate(fullPrompt, duration);

    // Download the generated audio
    const audioBuffer = await downloadFile(audioUrl);

    // Upload to S3
    const fileKey = `music/${uuidv4()}.wav`;
    await uploadToS3(audioBuffer, fileKey);

    const s3Url = `https://${MUSIC_BUCKET_NAME}.s3.amazonaws.com/${fileKey}`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'Music generated successfully',
        s3_url: s3Url,
        file_key: fileKey,
        prompt: fullPrompt,
        duration,
      }),
    };
  } catch (error) {
    console.error('Error generating music:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Failed to generate music',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

async function generateMusicWithReplicate(prompt: string, duration: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      version: 'b05b1dff1d8c6dc63d14b0cdb42135378dcb87f6373b0d3d341ede46e59e2b38',
      input: {
        prompt: prompt,
        model_version: 'stereo-melody-large',
        output_format: 'wav',
        normalization_strategy: 'peak',
        duration: duration,
      },
    });

    const options = {
      hostname: 'api.replicate.com',
      path: '/v1/predictions',
      method: 'POST',
      headers: {
        'Authorization': `Token ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', async () => {
        try {
          const response = JSON.parse(data);
          console.log('Replicate initial response:', response);

          if (response.error) {
            reject(new Error(response.error));
            return;
          }

          // Poll for completion
          const predictionUrl = response.urls?.get || response.id;
          if (!predictionUrl) {
            reject(new Error('No prediction URL returned'));
            return;
          }

          const outputUrl = await pollForCompletion(predictionUrl);
          resolve(outputUrl);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

async function pollForCompletion(predictionUrl: string): Promise<string> {
  const maxAttempts = 60; // 5 minutes with 5-second intervals
  let attempts = 0;

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds

    const status = await checkPredictionStatus(predictionUrl);
    console.log(`Attempt ${attempts + 1}: Status = ${status.status}`);

    if (status.status === 'succeeded' && status.output) {
      return Array.isArray(status.output) ? status.output[0] : status.output;
    }

    if (status.status === 'failed' || status.status === 'canceled') {
      throw new Error(`Prediction ${status.status}: ${status.error || 'Unknown error'}`);
    }

    attempts++;
  }

  throw new Error('Timeout waiting for music generation');
}

async function checkPredictionStatus(predictionUrl: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.replicate.com',
      path: predictionUrl.replace('https://api.replicate.com', ''),
      method: 'GET',
      headers: {
        'Authorization': `Token ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    https.get(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

async function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      res.on('error', reject);
    });
  });
}

async function uploadToS3(buffer: Buffer, key: string): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: MUSIC_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: 'audio/wav',
  });

  await s3Client.send(command);
}

// Mock function for testing without Replicate API
async function generateMockMusic(prompt: string, duration: number) {
  console.log('Generating mock music...');

  // Create a simple WAV file header (silent audio)
  const sampleRate = 44100;
  const numChannels = 2;
  const bitsPerSample = 16;
  const numSamples = sampleRate * duration;
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);

  const buffer = Buffer.alloc(44 + dataSize);

  // WAV header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  const fileKey = `music/${uuidv4()}.wav`;
  await uploadToS3(buffer, fileKey);

  const s3Url = `https://${MUSIC_BUCKET_NAME}.s3.amazonaws.com/${fileKey}`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      message: 'Mock music generated successfully (silent audio)',
      s3_url: s3Url,
      file_key: fileKey,
      prompt,
      duration,
      note: 'This is a mock response. Set REPLICATE_API_TOKEN to generate real music.',
    }),
  };
}
