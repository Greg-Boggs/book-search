#!/usr/bin/env bash
# One-time droplet setup. Run as root on a fresh Ubuntu 24.04 droplet.
#   ssh root@DROPLET 'bash -s' < deploy/provision.sh
set -euo pipefail

APP_USER="${APP_USER:-books}"
APP_DIR="/srv/books"
NODE_MAJOR=22

echo "==> swap (DigitalOcean droplets ship with none; on 2GB this is what"
echo "    stands between a memory spike and the OOM killer eating Solr)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
fi

echo "==> packages"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git rsync ufw openjdk-17-jre-headless

echo "==> node ${NODE_MAJOR}"
if ! command -v node >/dev/null || [[ "$(node -v)" != v${NODE_MAJOR}* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi

echo "==> app user + dirs"
id -u "$APP_USER" >/dev/null 2>&1 || useradd -r -m -s /bin/bash "$APP_USER"
mkdir -p "$APP_DIR" /var/solr
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> solr"
SOLR_VER=9.7.0
if [[ ! -d /opt/solr ]]; then
  curl -fsSL "https://dlcdn.apache.org/solr/solr/${SOLR_VER}/solr-${SOLR_VER}.tgz" -o /tmp/solr.tgz
  tar xzf /tmp/solr.tgz -C /opt
  ln -sfn "/opt/solr-${SOLR_VER}" /opt/solr
  rm /tmp/solr.tgz
  "/opt/solr/bin/solr" install --force --user "$APP_USER" --dir /var/solr 2>/dev/null \
    || /opt/solr/bin/install_solr_service.sh /tmp/solr.tgz -f -u "$APP_USER" 2>/dev/null \
    || echo "    (installed manually - see deploy/README.md)"
fi

echo "==> firewall: ssh + http/https only. Solr stays on localhost."
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo
echo "provisioned. Solr must NOT be reachable from the internet - verify with:"
echo "  ss -tlnp | grep 8983    # expect 127.0.0.1:8983, never 0.0.0.0:8983"
