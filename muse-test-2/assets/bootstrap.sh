#!/usr/bin/env bash
#
# Muse v2 host bootstrap. Runs once from EC2 user data on Amazon Linux 2023.
#
# Leaves behind:
#   /etc/muse/muse.env           config (user data) + a Postgres password generated here, once
#   /usr/local/bin/muse-release  deploys the app zip named in SSM; re-run on every release
#   the compose project "muse"   running; restart policies bring it back after a reboot
#
set -euxo pipefail

COMPOSE_VERSION=v5.5.1

dnf install -y docker unzip
install -d /usr/local/lib/docker/cli-plugins
curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
  "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-$(uname -m)"
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
systemctl enable --now docker

grep -q '^POSTGRES_PASSWORD=' /etc/muse/muse.env ||
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> /etc/muse/muse.env
chmod 0600 /etc/muse/muse.env

cat > /usr/local/bin/muse-release <<'RELEASE'
#!/usr/bin/env bash
#
# Deploy the app release named in SSM. Idempotent; keeps the Postgres volume.
#
set -euo pipefail
set -a; source /etc/muse/muse.env; set +a

url="$(aws ssm get-parameter --region "$AWS_REGION" --name "$MUSE_APP_PARAM" --query Parameter.Value --output text)"
release="/opt/muse/releases/$(basename "$url" .zip)"
if [ ! -d "$release" ]; then
  tmp="$(mktemp)"
  aws s3 cp --region "$AWS_REGION" --only-show-errors "$url" "$tmp"
  install -d "$release"
  unzip -q -o "$tmp" -d "$release"
  rm -f "$tmp"
fi
ln -sfn "$release" /opt/muse/current

cd /opt/muse/current
docker build -q -t muse:local .
docker compose --env-file /etc/muse/muse.env up -d --no-build --remove-orphans --wait --wait-timeout 600
echo "released $(basename "$release")"
RELEASE
chmod 0755 /usr/local/bin/muse-release

/usr/local/bin/muse-release
