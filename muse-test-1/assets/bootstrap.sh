#!/usr/bin/env bash
#
# Agent box bootstrap. Runs once from EC2 user data on Amazon Linux 2023.
#
# Leaves behind:
#   /etc/muse/muse.env    config, written by user data before this runs
#   /var/lib/muse/        SQLite state, mounted into the container at /data
#   muse:local            the app image, built from the shipped source
#   muse.service          running; listens on 127.0.0.1:8080 only
#
set -euxo pipefail

dnf install -y docker unzip
systemctl enable --now docker

install -d /opt/muse/app
unzip -o /opt/muse/app.zip -d /opt/muse/app
docker build -t muse:local /opt/muse/app

# The container runs as uid 1000 (see the Dockerfile).
install -d -o 1000 -g 1000 -m 0700 /var/lib/muse

# Host networking: the app binds 127.0.0.1, which the SSM tunnel reaches, and
# the AWS SDK reaches IMDS with the default hop limit of 1.
cat > /etc/systemd/system/muse.service <<'UNIT'
[Unit]
Description=Muse personal agent
After=docker.service
Requires=docker.service

[Service]
ExecStartPre=-/usr/bin/docker rm -f muse
ExecStart=/usr/bin/docker run --rm --name muse --network host --shm-size=1g \
  --env-file /etc/muse/muse.env -v /var/lib/muse:/data muse:local
ExecStop=/usr/bin/docker stop muse
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now muse.service

# Fail the bootstrap (visible in cloud-init logs) if the app never comes up.
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:8080/health && exit 0
  sleep 2
done
echo "muse did not become healthy" >&2
exit 1
