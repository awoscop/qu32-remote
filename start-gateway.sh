#!/usr/bin/env sh
# Starts the QU32 gateway (macOS / Linux). Requires Node.js 20+ and openssl.
# Optional: QU32_MIXER_IP=192.168.1.100 QU32_LAN_IP=192.168.1.50 ./start-gateway.sh
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js 20+ is required"; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required"; exit 1; }
[ -f gateway/dist/main.js ] || { echo "gateway/dist/main.js missing. Run: npm install && npm run build"; exit 1; }
exec node gateway/dist/main.js
