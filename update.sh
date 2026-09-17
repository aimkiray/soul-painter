#!/bin/bash
# Update soul-painter: git pull → install → build → restart (LaunchAgent)
set -e
cd ~/soul-painter

SERVICE="gui/$(id -u)/com.meow.soul-painter"
PLIST="$HOME/Library/LaunchAgents/com.meow.soul-painter.plist"

# Stop existing service before update to avoid serving half-updated files
launchctl bootout "$SERVICE" 2>/dev/null || true
for i in $(seq 1 10); do
    if ! lsof -iTCP:3123 -sTCP:LISTEN 2>/dev/null | grep -q .; then
        break
    fi
    sleep 1
done

echo "📦 Pulling latest code..."
git pull

echo "📦 Installing dependencies..."
npm install

echo "🔨 Building..."
npm run build

echo "🔄 Starting LaunchAgent..."
sleep 1
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then
    echo "⚠️  bootstrap failed, trying kickstart..."
    launchctl kickstart -k "$SERVICE" 2>/dev/null || true
fi
sleep 3

# Health check
if curl -sk -o /dev/null -w "%{http_code}" http://127.0.0.1:3123/ | grep -q 200; then
    echo "✅ Updated. Verify: https://poi.boats:12306/"
else
    echo "❌ Health check failed! Check logs: tail -20 ~/.hermes/logs/soul-painter-stderr.log"
    exit 1
fi
