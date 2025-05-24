from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.bash import BashOperator
from airflow.operators.python import PythonOperator

# Default arguments for the DAG
default_args = {
    'owner': 'airflow',
    'depends_on_past': False,
    'start_date': datetime(2024, 1, 1),
    'email_on_failure': False,
    'email_on_retry': False,
    'retries': 1,
    'retry_delay': timedelta(minutes=5),
}

# Define the DAG
dag = DAG(
    'example_simple_dag',
    default_args=default_args,
    description='A simple example DAG for testing Airflow deployment',
    schedule_interval=timedelta(days=1),
    catchup=False,
    tags=['example', 'simple'],
)

def print_hello(**context):
    """Simple Python function to print hello message."""
    print("Hello from Airflow!")
    print(f"Execution date: {context['ds']}")
    return "Hello task completed"

def print_date(**context):
    """Print the current date and execution context."""
    print(f"Current date: {datetime.now()}")
    print(f"Execution date: {context['ds']}")
    print(f"Task instance: {context['task_instance']}")
    return "Date task completed"

# Define tasks
hello_task = PythonOperator(
    task_id='hello_task',
    python_callable=print_hello,
    dag=dag,
)

date_task = PythonOperator(
    task_id='date_task',
    python_callable=print_date,
    dag=dag,
)

bash_task = BashOperator(
    task_id='bash_task',
    bash_command='echo "Hello from Bash!" && date',
    dag=dag,
)

sleep_task = BashOperator(
    task_id='sleep_task',
    bash_command='sleep 5 && echo "Task completed after 5 seconds"',
    dag=dag,
)

# Set task dependencies
hello_task >> [date_task, bash_task] >> sleep_task 