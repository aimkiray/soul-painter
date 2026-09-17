#!/bin/bash
# soul-painter startup wrapper
cd /Users/meow/soul-painter
export NODE_ENV=production
exec /opt/homebrew/bin/node node_modules/.bin/next start -H 127.0.0.1 -p 3123
