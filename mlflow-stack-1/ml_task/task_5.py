# https://www.mlflow.org/docs/latest/ml/tracking/quickstart/notebooks/tracking_quickstart/

import pandas as pd
from sklearn import datasets
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score
from sklearn.model_selection import train_test_split

import mlflow
from mlflow.models import infer_signature

# NOTE: review the links mentioned above for guidance on connecting to a managed tracking server, such as the Databricks Managed MLflow

mlflow.set_tracking_uri(uri="http://127.0.0.1:8080")


# Load the Iris dataset
X, y = datasets.load_iris(return_X_y=True)

# Split the data into training and test sets
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Define the model hyperparameters
params = {"solver": "lbfgs", "max_iter": 1000, "multi_class": "auto", "random_state": 8888}

# Train the model
lr = LogisticRegression(**params)
lr.fit(X_train, y_train)

# Predict on the test set
y_pred = lr.predict(X_test)

# Calculate accuracy as a target loss metric
accuracy = accuracy_score(y_test, y_pred)

mlflow.set_experiment("MLflow Quickstart")


# Start an MLflow run
with mlflow.start_run():
  # Log the hyperparameters
  mlflow.log_params(params)

  # Log the loss metric
  mlflow.log_metric("accuracy", accuracy)

  # Set a tag that we can use to remind ourselves what this run was for
  mlflow.set_tag("Training Info", "Basic LR model for iris data")

  # Infer the model signature
  signature = infer_signature(X_train, lr.predict(X_train))

  # Log the model
  model_info = mlflow.sklearn.log_model(
      sk_model=lr,
      name="iris_model",
      signature=signature,
      input_example=X_train,
      registered_model_name="tracking-quickstart",
  )

# predict wht train model
# predictions = loaded_model.predict(X_test)

# iris_feature_names = datasets.load_iris().feature_names

# # Convert X_test validation feature data to a Pandas DataFrame
# result = pd.DataFrame(X_test, columns=iris_feature_names)

# # Add the actual classes to the DataFrame
# result["actual_class"] = y_test

# # Add the model predictions to the DataFrame
# result["predicted_class"] = predictions

# result[:4]