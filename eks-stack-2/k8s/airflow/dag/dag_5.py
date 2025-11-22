from datetime import datetime
from airflow import DAG
from airflow.operators.python import PythonOperator
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Email configuration
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
SENDER_EMAIL = "your-email@gmail.com"  # Replace with your Gmail address
SENDER_PASSWORD = "your-app-password"  # Replace with Gmail App Password
RECIPIENT_EMAIL = "recipient@example.com"  # Replace with recipient's email

def send_email():
    """
    Send a simple email using Gmail SMTP.

    Note: For Gmail, you need to:
    1. Enable 2-factor authentication on your Google account
    2. Generate an App Password: https://myaccount.google.com/apppasswords
    3. Use the App Password instead of your regular Gmail password
    """
    try:
        # Create message
        message = MIMEMultipart()
        message["From"] = SENDER_EMAIL
        message["To"] = RECIPIENT_EMAIL
        message["Subject"] = "Hello from Airflow DAG"

        # Email body
        body = """
        Hello!

        This is a test email sent from an Airflow DAG.

        Regards,
        Airflow
        """
        message.attach(MIMEText(body, "plain"))

        # Connect to Gmail SMTP server
        print(f"Connecting to {SMTP_HOST}:{SMTP_PORT}...")
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()  # Enable TLS encryption

        # Login
        print(f"Logging in as {SENDER_EMAIL}...")
        server.login(SENDER_EMAIL, SENDER_PASSWORD)

        # Send email
        print(f"Sending email to {RECIPIENT_EMAIL}...")
        server.send_message(message)

        # Close connection
        server.quit()
        print("Email sent successfully!")

    except Exception as e:
        print(f"Failed to send email: {str(e)}")
        raise

with DAG(
    dag_id="send_email_dag",
    start_date=datetime(2023, 1, 1),
    schedule_interval="@daily",  # Run once per day
    catchup=False,
    description="Simple DAG to send email using Gmail SMTP"
) as dag:
    email_task = PythonOperator(
        task_id="send_email",
        python_callable=send_email
    )
