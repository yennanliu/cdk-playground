# https://medium.com/ai-academy-taiwan/mlflow-a-machine-learning-lifecycle-platform-%E5%85%A5%E9%96%80%E6%95%99%E5%AD%B8-5ec222abf5f8

# The data set used in this example is from http://archive.ics.uci.edu/ml/datasets/Wine+Quality
# P. Cortez, A. Cerdeira, F. Almeida, T. Matos and J. Reis.
# Modeling wine preferences by data mining from physicochemical properties. In Decision Support Systems, Elsevier, 47(4):547-553, 2009.
import pandas as pd
import numpy as np
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.linear_model import ElasticNet
import mlflow
import mlflow.sklearn


# NOTE !!! change below to the actual mlflow server url accordingly
# For local testing, "http://localhost:5000" is common.
# If MLflow Tracking Server is not running, it will default to a local 'mlruns' directory.
mlflow.set_tracking_uri("http://localhost:5000")

def eval_metrics(actual, pred):
    rmse = np.sqrt(mean_squared_error(actual, pred))
    mae = mean_absolute_error(actual, pred)
    r2 = r2_score(actual, pred)
    return rmse, mae, r2
    
alphas = [0.5, 0.7, 0.9]
l1_ratios = [0.3, 0.5, 0.9]
np.random.seed(40)
# Read the wine-quality csv file from the URL
csv_url ='http://archive.ics.uci.edu/ml/machine-learning-databases/wine-quality/winequality-red.csv'
try:
    data = pd.read_csv(csv_url, sep=';')
except Exception as e:
    print("Unable to download training & test CSV, check your internet connection. Error: %s", e)
# Split the data into training and test sets. (0.75, 0.25) split.
train, test = train_test_split(data)
# The predicted column is "quality" which is a scalar from [3, 9]
train_x = train.drop(["quality"], axis=1)
test_x = test.drop(["quality"], axis=1)
train_y = train[["quality"]]
test_y = test[["quality"]]
for alpha in alphas:
    for l1_ratio in l1_ratios:
        with mlflow.start_run():
            lr = ElasticNet(alpha=alpha, l1_ratio=l1_ratio, random_state=42)
            lr.fit(train_x, train_y)
            predicted_qualities = lr.predict(test_x)
            (rmse, mae, r2) = eval_metrics(test_y, predicted_qualities)
            mlflow.log_param("alpha", alpha)
            mlflow.log_param("l1_ratio", l1_ratio)
            mlflow.log_metric("rmse", rmse)
            mlflow.log_metric("r2", r2)
            mlflow.log_metric("mae", mae)
            # save the model to the mlflow server
            # TODO: check if the model is saved to the mlflow server or S3 bucket
            mlflow.sklearn.log_model(lr, "model")