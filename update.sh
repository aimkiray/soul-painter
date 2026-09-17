#!/bin/bash
# Update soul-painter: git pull → install → build → restart (LaunchDaemon)
set -e
cd ~/soul-painter

# Stop existing service before update to avoid serving half-updated files
sudo launchctl bootout system/com.meow.soul-painter 2>/dev/null || true
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

echo "🔄 Starting LaunchDaemon..."
sleep 1
if ! sudo launchctl bootstrap system /Library/LaunchDaemons/com.meow.soul-painter.plist 2>/dev/null; then
    echo "⚠️  bootstrap failed, trying kickstart..."
    sudo launchctl kickstart -k system/com.meow.soul-painter 2>/dev/null || true
fi
sleep 3

# Health check
if curl -sk -o /dev/null -w "%{http_code}" http://127.0.0.1:3123/ | grep -q 200; then
    echo "✅ Updated. Verify: https://poi.boats:12306/"
else
    echo "❌ Health check failed! Check logs: sudo tail -20 /opt/homebrew/var/log/soul-painter.err"
    exit 1
fi