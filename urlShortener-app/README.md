# URL Shortener Application

A serverless URL shortener application built with AWS CDK, using API Gateway, Lambda, DynamoDB, and S3 for static hosting.

## Features

- Create shortened URLs from long URLs
- Automatic redirection from short URLs to original URLs
- Optional expiration time for short URLs
- Simple web UI for URL shortening and resolution
- Serverless architecture with AWS services

## Architecture

This application uses the following AWS services:

- **API Gateway**: REST API for frontend interaction
- **AWS Lambda**: Serverless functions for URL shortening and resolution
- **DynamoDB**: NoSQL database for storing URL mappings
- **S3**: Static website hosting for the UI

## Prerequisites

- Node.js 16.x or later
- AWS CLI configured with appropriate credentials
- AWS CDK installed globally (`npm install -g aws-cdk`)

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd urlShortener-app
```

2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

4. Deploy the application to AWS:

```bash
cdk deploy
```

After deployment, the CDK will output the API Gateway endpoint URL and the S3 website URL. You will need to update the `API_ENDPOINT` value in `ui/script.js` with the deployed API Gateway URL.

## Usage

1. Open the web UI using the S3 website URL provided in the CDK outputs
2. To shorten a URL:
   - Enter a long URL in the input field
   - Optionally set an expiration time
   - Click "Shorten URL"
   - The shortened URL will be displayed, which you can copy or visit directly
3. To expand a short URL:
   - Enter the short URL in the input field on the "Expand URL" tab
   - Click "Expand URL"
   - The original URL will be displayed

## Local Development

You can test the Lambda functions locally using AWS SAM:

```bash
cdk synth
sam local invoke ShortenUrlFunction --event events/shorten-event.json
```

## Clean Up

To avoid incurring charges, remember to delete the resources when you're done:

```bash
cdk destroy
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
