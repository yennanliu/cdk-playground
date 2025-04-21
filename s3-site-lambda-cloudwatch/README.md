# Full-Stack App: S3 + Lambda + CloudWatch

This project is a complete full-stack application using AWS CDK (TypeScript) that implements a number guessing game with monitoring capabilities. It demonstrates integration between frontend, backend, and monitoring services.

## Architecture

The application consists of the following components:

1. **Frontend**: An S3-hosted static website with a number guessing game
2. **Backend**: Lambda function with API Gateway serving as the game API
3. **Monitoring**: CloudWatch dashboard to track metrics and logs
4. **Alarms**: Optional SNS-based alerting for high error rates

## Features

- Interactive number guessing game
- API for processing guesses and submitting scores
- CloudWatch metrics for tracking:
  - Valid and invalid attempts
  - Correct guesses
  - Score submissions
  - API request counts
  - Error rates
- Comprehensive CloudWatch dashboard
- Optional email alerts for error spikes

## Prerequisites

- [AWS CLI](https://aws.amazon.com/cli/) installed and configured
- [Node.js](https://nodejs.org/) (v14 or newer)
- [AWS CDK](https://aws.amazon.com/cdk/) v2 installed globally (`npm install -g aws-cdk`)

## Deployment

1. Install dependencies:

```bash
npm install
```

2. Configure your email for alarms (optional):
Open `bin/s3-site-lambda-cloudwatch.ts` and update the configuration:

```typescript
new S3SiteLambdaCloudwatchStack(app, 'S3SiteLambdaCloudwatchStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',  // Change this to your preferred region
  },
  alarmEmail: 'your-email@example.com', // Uncomment and add your email
});
```

3. Bootstrap your AWS environment (if not already done):

```bash
cdk bootstrap
```

4. Deploy the stack:

```bash
cdk deploy
```

5. After deployment, the CDK will output:
   - Website URL (S3 bucket website URL)
   - API Endpoint URL

6. Update the API URL in the frontend:
   - Open the S3 bucket in the AWS console
   - Download the index.html file
   - Update the `API_URL` constant with the API Endpoint from step 5
   - Upload the updated index.html back to the bucket

## How the Game Works

1. The frontend generates a random number between 1-100
2. Users submit guesses via the form
3. The Lambda function processes each guess and provides feedback
4. When a correct guess is made, the score (number of attempts) is submitted
5. All interactions are tracked in CloudWatch metrics

## CloudWatch Dashboard

The application automatically creates a CloudWatch dashboard that displays:

1. API request count
2. API latency
3. Lambda errors
4. Custom game metrics:
   - Valid attempts
   - Invalid attempts
   - Correct guesses
   - Score submissions

To access the dashboard:
1. Log in to the AWS Management Console
2. Navigate to CloudWatch > Dashboards
3. Select "GameMetricsDashboard"

## Monitoring and Alerts

If you configured an email for alerts, you'll receive notifications when:
- Error rate exceeds the threshold (5 errors within 1 minute)

To acknowledge and address alerts:
1. Check the CloudWatch logs for the Lambda function
2. Review the CloudWatch dashboard for anomalies
3. Investigate the frontend/backend code for issues

## Local Development

To develop and test locally:

1. Make changes to the Lambda function in the `lambda/` directory
2. Test the frontend by running a local server:
   ```bash
   cd frontend
   npx http-server
   ```
3. For API testing, use tools like Postman or curl to send requests to your deployed API or emulate locally

## Cleanup

To avoid incurring charges, remove all resources when done:

```bash
cdk destroy
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.
