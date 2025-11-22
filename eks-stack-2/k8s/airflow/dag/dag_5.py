from datetime import datetime
from airflow import DAG
from airflow.operators.python import PythonOperator
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Email configuration - Mailtrap (Testing)
SMTP_HOST = "sandbox.smtp.mailtrap.io"  # Replace with your Mailtrap host
SMTP_PORT = 587
SENDER_EMAIL = "test@example.com"  # Can be any email for Mailtrap
SENDER_PASSWORD = "your-mailtrap-password"  # Replace with Mailtrap password from credentials
RECIPIENT_EMAIL = "recipient@example.com"  # Can be any email for Mailtrap

# Mailtrap Credentials (get from https://mailtrap.io/inboxes)
# Username: your-mailtrap-username
# Password: your-mailtrap-password

def send_email():
    """
    Send a test email using Mailtrap SMTP.

    Note: Mailtrap is a testing service - emails won't actually be sent.
    View all test emails at: https://mailtrap.io/inboxes

    Setup:
    1. Sign up at https://mailtrap.io (free)
    2. Get SMTP credentials from your inbox settings
    3. Update SMTP_HOST, SENDER_PASSWORD above
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

        # Connect to Mailtrap SMTP server
        print(f"Connecting to {SMTP_HOST}:{SMTP_PORT}...")
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()  # Enable TLS encryption

        # Login with Mailtrap credentials
        print(f"Logging in to Mailtrap...")
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
    description="Simple DAG to send test email using Mailtrap SMTP"
) as dag:
    email_task = PythonOperator(
        task_id="send_email",
        python_callable=send_email
    )
