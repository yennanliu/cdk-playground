#!/usr/bin/env python3
"""
Train a simple house price prediction model using scikit-learn.
This script trains a Linear Regression model on synthetic house data.
"""

import os
import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, r2_score
import joblib

def main():
    # Load data
    data_path = os.path.join(os.path.dirname(__file__), 'data', 'house_data.csv')
    print(f"Loading data from {data_path}")
    df = pd.read_csv(data_path)

    print(f"\nDataset shape: {df.shape}")
    print(f"\nFirst few rows:")
    print(df.head())

    # Prepare features and target
    X = df[['bedrooms', 'bathrooms', 'sqft', 'year_built']]
    y = df['price']

    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    print(f"\nTraining set size: {len(X_train)}")
    print(f"Test set size: {len(X_test)}")

    # Train model
    print("\nTraining Linear Regression model...")
    model = LinearRegression()
    model.fit(X_train, y_train)

    # Evaluate
    y_pred_train = model.predict(X_train)
    y_pred_test = model.predict(X_test)

    train_r2 = r2_score(y_train, y_pred_train)
    test_r2 = r2_score(y_test, y_pred_test)
    train_rmse = np.sqrt(mean_squared_error(y_train, y_pred_train))
    test_rmse = np.sqrt(mean_squared_error(y_test, y_pred_test))

    print("\nModel Performance:")
    print(f"Train R² Score: {train_r2:.4f}")
    print(f"Test R² Score: {test_r2:.4f}")
    print(f"Train RMSE: ${train_rmse:,.2f}")
    print(f"Test RMSE: ${test_rmse:,.2f}")

    # Print coefficients
    print("\nModel Coefficients:")
    for feature, coef in zip(X.columns, model.coef_):
        print(f"  {feature}: {coef:,.2f}")
    print(f"  intercept: {model.intercept_:,.2f}")

    # Save model
    output_dir = os.path.join(os.path.dirname(__file__), 'build')
    os.makedirs(output_dir, exist_ok=True)
    model_path = os.path.join(output_dir, 'model.joblib')

    print(f"\nSaving model to {model_path}")
    joblib.dump(model, model_path)

    # Test prediction
    print("\nTest prediction:")
    sample = [[3, 2, 2000, 2015]]
    prediction = model.predict(sample)
    print(f"Input: {dict(zip(X.columns, sample[0]))}")
    print(f"Predicted price: ${prediction[0]:,.2f}")

    print("\nTraining complete!")

if __name__ == '__main__':
    main()
