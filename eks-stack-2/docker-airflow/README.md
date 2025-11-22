# Docker Airflow - Local Testing Environment

A simple Docker Compose setup for testing Airflow DAGs locally.

## Prerequisites

- Docker Desktop installed and running
- Docker Compose (included with Docker Desktop)

## Quick Start

### 1. Start Airflow

```bash
cd docker-airflow
./scripts/start.sh
```

Or manually:
```bash
docker-compose up -d
```

### 2. Access the Web UI

- **URL**: http://localhost:8080
- **Username**: `admin`
- **Password**: `admin`

Wait 1-2 minutes for all services to start. Check status with:
```bash
docker-compose ps
```

### 3. Test Your DAGs

Your DAGs from `dags/` folder will automatically appear in the Airflow UI.

To trigger the email DAG (`dag_5.py`):
1. First, update email credentials in `dags/dag_5.py`
2. Enable the DAG in the UI (toggle the switch)
3. Click the "Play" button to trigger it manually

## Directory Structure

```
docker-airflow/
├── dags/                  # Your DAG files (Python)
│   ├── dag_1.py
│   ├── dag_2.py
│   ├── dag_3.py
│   ├── dag_4.py
│   └── dag_5.py          # Email sending DAG
├── logs/                  # Airflow logs (auto-generated)
├── plugins/               # Custom Airflow plugins (optional)
├── scripts/               # Helper scripts
│   ├── start.sh          # Start Airflow
│   ├── stop.sh           # Stop Airflow
│   └── clean.sh          # Clean all data
├── docker-compose.yml     # Docker Compose configuration
├── .env.example           # Example environment variables
└── README.md             # This file
```

## Configuration

### Email DAG Setup (dag_5.py)

To use the email-sending DAG, edit `dags/dag_5.py` and update:

```python
SENDER_EMAIL = "your-email@gmail.com"
SENDER_PASSWORD = "your-app-password"
RECIPIENT_EMAIL = "recipient@example.com"
```

**For Gmail:**
1. Enable 2FA on your Google account
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Use the 16-character App Password

## Common Commands

### View Logs
```bash
docker-compose logs -f
docker-compose logs -f airflow-scheduler
docker-compose logs -f airflow-webserver
```

### Stop Airflow
```bash
./scripts/stop.sh
# or
docker-compose down
```

### Clean Everything (Remove all data)
```bash
./scripts/clean.sh
# or
docker-compose down -v
rm -rf logs/*
```

### Restart Services
```bash
docker-compose restart
```

### Access Airflow CLI
```bash
docker-compose exec airflow-webserver airflow version
docker-compose exec airflow-webserver airflow dags list
```

## Services

This setup includes:
- **PostgreSQL**: Database for Airflow metadata
- **Airflow Webserver**: Web UI (port 8080)
- **Airflow Scheduler**: DAG scheduling and execution
- **Airflow Init**: One-time initialization

## Adding New DAGs

1. Add your Python DAG file to the `dags/` folder
2. Wait ~30 seconds for Airflow to detect it
3. Refresh the web UI to see your new DAG

## Troubleshooting

### DAGs not showing up
- Check file permissions on `dags/` folder
- Check logs: `docker-compose logs -f airflow-scheduler`
- Verify Python syntax: `python dags/your_dag.py`

### Services not starting
- Ensure Docker Desktop is running
- Check ports 8080 is not in use
- View logs: `docker-compose logs`

### Permission errors
- On Linux, set `AIRFLOW_UID` in `.env` to your user ID: `echo $UID`
- Run: `sudo chown -R $USER:$USER dags/ logs/ plugins/`

### Email not sending
- Verify SMTP credentials in `dag_5.py`
- For Gmail, ensure you're using an App Password
- Check scheduler logs: `docker-compose logs -f airflow-scheduler`

## Resources

- [Airflow Documentation](https://airflow.apache.org/docs/)
- [Docker Compose Reference](https://docs.docker.com/compose/)
- [Gmail App Passwords](https://myaccount.google.com/apppasswords)
