"""
SageMaker inference handler for house price prediction model.
This script defines how SageMaker should load the model and handle predictions.
"""

import os
import json
import joblib
import numpy as np
from io import StringIO

# Global variable to cache loaded model
model = None

def model_fn(model_dir):
    """
    Load the model from the model directory.
    Called once when the endpoint starts.

    Args:
        model_dir: Directory where model artifacts are stored

    Returns:
        Loaded sklearn model
    """
    global model
    if model is None:
        model_path = os.path.join(model_dir, 'model.joblib')
        print(f"Loading model from {model_path}")
        model = joblib.load(model_path)
        print("Model loaded successfully")
    return model


def input_fn(request_body, request_content_type):
    """
    Parse input data.

    Args:
        request_body: The request body as a string
        request_content_type: The content type of the request

    Returns:
        Parsed input as numpy array
    """
    print(f"Received content type: {request_content_type}")
    print(f"Request body: {request_body}")

    if request_content_type == 'application/json':
        data = json.loads(request_body)

        # Handle single prediction
        if isinstance(data, dict):
            # Extract features in correct order
            features = [
                data.get('bedrooms', 0),
                data.get('bathrooms', 0),
                data.get('sqft', 0),
                data.get('year_built', 0)
            ]
            return np.array([features])

        # Handle batch predictions
        elif isinstance(data, list):
            features_list = []
            for item in data:
                features = [
                    item.get('bedrooms', 0),
                    item.get('bathrooms', 0),
                    item.get('sqft', 0),
                    item.get('year_built', 0)
                ]
                features_list.append(features)
            return np.array(features_list)
        else:
            raise ValueError(f"Unsupported data format: {type(data)}")

    elif request_content_type == 'text/csv':
        # Parse CSV format
        df = pd.read_csv(StringIO(request_body))
        return df[['bedrooms', 'bathrooms', 'sqft', 'year_built']].values

    else:
        raise ValueError(f"Unsupported content type: {request_content_type}")


def predict_fn(input_data, model):
    """
    Make predictions using the loaded model.

    Args:
        input_data: Preprocessed input data (numpy array)
        model: Loaded sklearn model

    Returns:
        Model predictions
    """
    print(f"Making prediction for input shape: {input_data.shape}")
    predictions = model.predict(input_data)
    print(f"Predictions: {predictions}")
    return predictions


def output_fn(predictions, response_content_type):
    """
    Format the prediction output.

    Args:
        predictions: Model predictions (numpy array)
        response_content_type: Desired response content type

    Returns:
        Formatted response
    """
    print(f"Formatting output as: {response_content_type}")

    if response_content_type == 'application/json':
        # Single prediction
        if len(predictions) == 1:
            response = {
                'predicted_price': float(predictions[0]),
                'model_version': 'v1'
            }
        # Batch predictions
        else:
            response = {
                'predictions': [float(p) for p in predictions],
                'model_version': 'v1'
            }
        return json.dumps(response)

    else:
        raise ValueError(f"Unsupported response content type: {response_content_type}")
