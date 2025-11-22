from datetime import datetime
from airflow import DAG
from airflow.operators.python import PythonOperator

def hello():
    for i in range(5):
        print("i = " + str(i))
        print("Hello from Airflow 2 !!!")

with DAG(
    dag_id="hello_world_dag_2",
    start_date=datetime(2023, 1, 1),
    #schedule_interval="@once",  # run once
    schedule_interval='@hourly',
    catchup=False
) as dag:
    task = PythonOperator(
        task_id="say_hello",
        python_callable=hello
    )