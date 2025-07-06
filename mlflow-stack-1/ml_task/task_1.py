# https://medium.com/@wangpenhsuan/%E5%AF%A6%E4%BD%9C-mlflow-%E6%A8%A1%E5%9E%8B%E7%AE%A1%E7%90%86%E4%B8%AD%E5%BF%83-ml-%E5%AF%A6%E9%A9%97%E4%B8%8D%E5%86%8D%E9%9B%9C%E4%BA%82-4be96b777871

import mlflow
import mlflow.keras
import mlflow.tensorflow

# NOTE !!! change below to the actual mlflow server url accoringly
mlflow.set_tracking_uri("http://localhost:5000")

def train_keras_model(X, y):
  
  model = Sequential()
  model.add(Dense(100, input_shape=(X_train.shape[-1],), activation="relu", name="hidden_layer"))
  model.add(Dense(1))
  model.compile(loss="mse", optimizer="adam")
 
  model.fit(X_train, y_train, epochs=100, batch_size=64, validation_split=.2)
  return model
  
X_train, y_train = get_training_data()
 
with mlflow.start_run(run_name="test_model_regist"):
  print("mlflow start run")
  print("mlflow server url: ", mlflow.get_tracking_uri())
  # run_name speficied the logging experiment name.
  # Automatically capture the model's parameters, metrics, artifacts,
  # and source code with the `autolog()` function
  mlflow.tensorflow.autolog()
  
  train_keras_model(X_train, y_train)
  run_id = mlflow.active_run().info.run_id
  print("run_id: ", run_id)