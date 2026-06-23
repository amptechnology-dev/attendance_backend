#!/bin/bash
set -e

DOMAIN="https://attendance-backend.amptechnology.in"        # ← change this
EMAIL="devs.amptechnology@gmail.com"       # ← change this
CERT_PATH="/root/amp_portal_backend/certbot/conf/live/$DOMAIN/fullchain.pem"
NGINX_CONF="/root/amp_portal_backend/nginx/conf.d/attendance.conf"

echo "=== Starting deployment for $DOMAIN ==="

# ─────────────────────────────────────────────────────────────
# CASE 1: Certificate already exists → just redeploy
# ─────────────────────────────────────────────────────────────
if sudo test -f "$CERT_PATH"; then
  echo "Certificate already exists — skipping SSL generation."
  echo "Redeploying attendance app..."

  docker compose down || true
  docker compose up -d --build --remove-orphans

  sleep 5

  # Reload existing nginx
  docker exec nginx nginx -s reload || true

  echo ""
  echo "=== Redeploy complete! ==="
  echo "=== https://$DOMAIN is live ==="
  exit 0
fi

# ─────────────────────────────────────────────────────────────
# CASE 2: First time — generate SSL certificate
# ─────────────────────────────────────────────────────────────
echo "No certificate found — starting first-time SSL setup..."

# ── Step 1: Write temporary HTTP-only nginx config for ACME challenge ──
cat > "$NGINX_CONF" << NGINXEOF
server {
    listen 80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'OK';
        add_header Content-Type text/plain;
    }
}
NGINXEOF

echo "Temporary HTTP nginx config written."

# Reload existing nginx with temp config
docker exec nginx nginx -s reload || true
sleep 3

# Verify port 80 responding
echo "Verifying port 80..."
curl -sf http://localhost:80 > /dev/null && echo "port 80 OK" || { echo "ERROR: port 80 not responding"; exit 1; }

# ── Step 2: Request SSL certificate ──
echo "Requesting certificate from Let's Encrypt..."
docker run --rm \
  -v "/root/amp_portal_backend/certbot/www:/var/www/certbot" \
  -v "/root/amp_portal_backend/certbot/conf:/etc/letsencrypt" \
  certbot/certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

# Fix ownership
sudo chown -R ubuntu:ubuntu /root/amp_portal_backend/certbot
chmod -R 755 /root/amp_portal_backend/certbot
sleep 2

# Verify certificate was created
if ! sudo test -f "$CERT_PATH"; then
  echo "ERROR: Certificate not found at $CERT_PATH after certbot run!"
  sudo ls -la /root/amp_portal_backend/certbot/conf/live/ 2>/dev/null || echo "live/ folder does not exist"
  exit 1
fi

echo "Certificate obtained successfully!"

# ── Step 3: Write final HTTPS nginx config ──
cat > "$NGINX_CONF" << NGINXEOF
server {
    listen 80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://attendance-app:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINXEOF

echo "HTTPS nginx config written."

# ── Step 4: Start attendance app ──
echo "Starting attendance app..."
docker compose down || true
docker compose up -d --build --remove-orphans

sleep 8

# ── Step 5: Reload existing nginx with HTTPS config ──
docker exec nginx nginx -s reload || true

echo ""
echo "=== SSL setup complete! ==="
echo "=== https://$DOMAIN is now live! ==="