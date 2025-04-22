const AWS = require('aws-sdk');
const cloudwatch = new AWS.CloudWatch();

exports.handler = async (event) => {
  console.log('Event received:', JSON.stringify(event));
  
  // Set up CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
    'Content-Type': 'application/json'
  };
  
  try {
    // Parse the request body
    const body = JSON.parse(event.body || '{}');
    const { guess, target, score } = body;
    
    // Validate input
    if (!guess && !score) {
      console.log('Invalid request: missing guess or score');
      
      // Put metric for invalid attempt
      await putMetric('InvalidAttempts', 1);
      
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          message: 'Missing required parameters',
          success: false
        })
      };
    }
    
    let result;
    
    // Process a guess in the number guessing game
    if (guess !== undefined && target !== undefined) {
      console.log(`Processing guess: ${guess}, target: ${target}`);
      
      // Validate the guess
      const guessNum = parseInt(guess);
      const targetNum = parseInt(target);
      
      if (isNaN(guessNum) || isNaN(targetNum)) {
        console.log('Invalid guess or target value');
        await putMetric('InvalidAttempts', 1);
        
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            message: 'Guess and target must be numbers',
            success: false
          })
        };
      }
      
      // Determine if the guess is correct, too high, or too low
      if (guessNum === targetNum) {
        result = { 
          message: 'Correct! You guessed the number!',
          correct: true
        };
        await putMetric('CorrectGuesses', 1);
      } else if (guessNum < targetNum) {
        result = { 
          message: 'Too low! Try a higher number.',
          correct: false
        };
      } else {
        result = { 
          message: 'Too high! Try a lower number.',
          correct: false
        };
      }
      
      // Record a valid guess attempt
      await putMetric('ValidAttempts', 1);
    }
    // Process a score submission
    else if (score !== undefined) {
      console.log(`Processing score submission: ${score}`);
      
      // Validate the score
      const scoreNum = parseInt(score);
      
      if (isNaN(scoreNum) || scoreNum < 0) {
        console.log('Invalid score value');
        await putMetric('InvalidAttempts', 1);
        
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            message: 'Score must be a positive number',
            success: false
          })
        };
      }
      
      result = { 
        message: 'Score recorded successfully',
        success: true
      };
      
      // Record the score
      await putMetric('ScoreSubmissions', 1);
      await putMetric('TotalScore', scoreNum);
      await putMetric('ValidAttempts', 1);
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error('Error processing request:', error);
    
    // Put metric for error
    await putMetric('ProcessingErrors', 1);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        message: 'Internal server error',
        success: false
      })
    };
  }
};

// Helper function to put a metric to CloudWatch
async function putMetric(metricName, value) {
  const params = {
    MetricData: [
      {
        MetricName: metricName,
        Dimensions: [
          {
            Name: 'Environment',
            Value: 'Production'
          }
        ],
        Unit: 'Count',
        Value: value
      }
    ],
    Namespace: 'GameMetrics'
  };
  
  try {
    await cloudwatch.putMetricData(params).promise();
    console.log(`Successfully recorded metric: ${metricName} = ${value}`);
  } catch (error) {
    console.error(`Error recording metric ${metricName}:`, error);
  }
} 
