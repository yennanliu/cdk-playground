from datetime import datetime
from airflow import DAG
from airflow.operators.python import PythonOperator

def calculate_sum():
    total = sum(range(1, 11))  # 1 + 2 + ... + 10
    print("The sum from 1 to 10 is:", total)

def calculate_product():
    product = 1
    for i in range(1, 6):  # 1 * 2 * ... * 5
        product *= i
    print("The product from 1 to 5 is:", product)

with DAG(
    dag_id="basic_math_dag",
    start_date=datetime(2023, 1, 1),
    schedule_interval="@once",
    catchup=False
) as dag:
    
    task_sum = PythonOperator(
        task_id="calculate_sum",
        python_callable=calculate_sum
    )

    task_product = PythonOperator(
        task_id="calculate_product",
        python_callable=calculate_product
    )

    task_sum >> task_product  # run product after sum