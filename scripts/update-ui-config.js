#!/usr/bin/env node

/**
 * This script updates the API_ENDPOINT value in the UI script file
 * after the CDK stack is deployed.
 * 
 * Usage:
 * node update-ui-config.js <api-endpoint-url>
 */

const fs = require('fs');
const path = require('path');

// Get the API endpoint URL from command line arguments
const apiEndpoint = process.argv[2];
if (!apiEndpoint) {
  console.error('Please provide the API endpoint URL as an argument');
  process.exit(1);
}

// Path to the UI script file
const scriptPath = path.join(__dirname, '..', 'ui', 'script.js');

// Read the file
fs.readFile(scriptPath, 'utf8', (err, data) => {
  if (err) {
    console.error(`Error reading file: ${err}`);
    process.exit(1);
  }

  // Replace the API_ENDPOINT value
  const updatedData = data.replace(
    /const API_ENDPOINT = ['"].*['"]/,
    `const API_ENDPOINT = '${apiEndpoint}'`
  );

  // Write the updated content back to the file
  fs.writeFile(scriptPath, updatedData, 'utf8', (err) => {
    if (err) {
      console.error(`Error writing file: ${err}`);
      process.exit(1);
    }
    console.log(`✅ Successfully updated API_ENDPOINT to ${apiEndpoint}`);
  });
}); 