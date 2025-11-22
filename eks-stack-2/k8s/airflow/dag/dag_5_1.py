from datetime import datetime
from airflow import DAG
from airflow.operators.python import PythonOperator
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Email configuration - Brevo (Real emails)
SMTP_HOST = "smtp-relay.brevo.com"
SMTP_PORT = 587
SMTP_LOGIN = ""  # Brevo SMTP login (for authentication)
SMTP_PASSWORD = ""  # Brevo SMTP key
SENDER_EMAIL = ""  # Must be verified in Brevo (used in "From" field)
RECIPIENT_EMAIL = ""  # Real recipient email

def send_email():
    """
    Send a real email using Brevo SMTP.

    Note: This will send REAL emails to actual recipients!

    Setup:
    1. Sign up at https://app.brevo.com/ (free tier: 300 emails/day)
    2. Go to SMTP & API: https://app.brevo.com/settings/keys/smtp
    3. Create an SMTP key
    4. Update SENDER_EMAIL and SENDER_PASSWORD above

    IMPORTANT: SENDER_EMAIL must be verified in Brevo!
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

        # Connect to Brevo SMTP server
        print(f"Connecting to {SMTP_HOST}:{SMTP_PORT}...")
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()  # Enable TLS encryption

        # Login with Brevo credentials (SMTP login + SMTP key)
        print(f"Logging in to Brevo as {SMTP_LOGIN}...")
        server.login(SMTP_LOGIN, SMTP_PASSWORD)

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
    dag_id="send_email_dag_v2",
    start_date=datetime(2023, 1, 1),
    schedule_interval="@daily",  # Run once per day
    catchup=False,
    description="Simple DAG to send real email using Brevo SMTP"
) as dag:
    email_task = PythonOperator(
        task_id="send_email",
        python_callable=send_email
    )
