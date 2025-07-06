import mlflow
import mlflow.sklearn # Import for sklearn autologging
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, r2_score

# NOTE !!! change below to the actual mlflow server url accordingly
# For local testing, "http://localhost:5000" is common.
# If MLflow Tracking Server is not running, it will default to a local 'mlruns' directory.
mlflow.set_tracking_uri("http://localhost:5000")

def get_training_data(n_samples=1000, n_features=10, test_size=0.2, random_state=42):
    """
    Generates synthetic data for a regression problem and splits it into
    training and testing sets.
    """
    X = np.random.rand(n_samples, n_features) * 10
    # Create a simple linear relationship with some noise for y
    y = X @ np.random.rand(n_features) + np.random.randn(n_samples) * 2

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=random_state
    )
    return X_train, X_test, y_train, y_test

def train_sklearn_model(X_train_data, y_train_data, X_test_data, y_test_data):
    """
    Trains a Scikit-learn RandomForestRegressor model.
    MLflow autologging will capture parameters, metrics, and the model.
    """
    # Define hyperparameters for the RandomForestRegressor
    n_estimators = 100
    max_depth = 10
    random_state = 42

    model = RandomForestRegressor(
        n_estimators=n_estimators,
        max_depth=max_depth,
        random_state=random_state
    )

    print(f"Starting Scikit-learn model training (RandomForestRegressor with n_estimators={n_estimators}, max_depth={max_depth})...")
    model.fit(X_train_data, y_train_data)
    print("Model training finished.")

    # --- Manual Metric Logging (Optional but Recommended for Sklearn Autolog) ---
    # While mlflow.sklearn.autolog() logs parameters and the model,
    # it typically logs metrics only if you explicitly call .score()
    # or use mlflow.sklearn.eval_and_log_metrics().
    # For clear metric logging, it's often good to calculate them yourself
    # and log them manually, especially if you need specific metrics.
    y_pred = model.predict(X_test_data)
    mse = mean_squared_error(y_test_data, y_pred)
    r2 = r2_score(y_test_data, y_pred)

    mlflow.log_metric("test_mse", mse)
    mlflow.log_metric("test_r2_score", r2)
    print(f"Logged Metrics: Test MSE = {mse:.4f}, Test R2 Score = {r2:.4f}")
    # -------------------------------------------------------------------------

    return model

if __name__ == "__main__":
    X_train, X_test, y_train, y_test = get_training_data()

    # Enable autologging for Scikit-learn before starting the run.
    # This automatically logs model parameters and the trained model artifact.
    # It also attempts to log metrics if scoring methods are called.
    mlflow.sklearn.autolog()

    with mlflow.start_run(run_name="sklearn_autolog_example") as active_run:
        print("MLflow started run.")
        print("MLflow server URL: ", mlflow.get_tracking_uri())
        print(f"MLflow Run ID: {active_run.info.run_id}")

        # Call the function to train the Scikit-learn model.
        # Autologging handles the logging of model parameters and the model artifact.
        trained_model = train_sklearn_model(X_train, y_train, X_test, y_test)

        # The model parameters and the model itself are logged by autolog.
        # Metrics (like MSE, R2) are logged manually in this example for clarity,
        # though autolog might capture some if you used model.score().

        print("Scikit-learn model training and logging complete via MLflow autologging.")

    print("\nCheck your MLflow UI (e.g., by running 'mlflow ui' in your terminal) to see the logged run!")