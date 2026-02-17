#!/bin/bash
# Migrate OpenClaw from Pi to MacBook
# Run this ON THE MAC after OpenClaw is installed

PI_HOST="openclaw-pi.local"  # or IP address
PI_USER="sam"

echo "🦞 OpenClaw Migration — Pi → MacBook"

# 1. Install OpenClaw on Mac
if ! command -v openclaw &>/dev/null; then
  npm install -g openclaw
fi

# 2. Copy workspace from Pi
echo "Copying workspace from Pi..."
rsync -avz --progress "$PI_USER@$PI_HOST:~/.openclaw/" "$HOME/.openclaw/" \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'data/openfoodfacts' \
  --exclude 'data/usda' \
  --exclude 'data/meilisearch/data.ms'

# 3. Copy config
echo "Copying OpenClaw config..."
scp "$PI_USER@$PI_HOST:~/.openclaw/openclaw.json" "$HOME/.openclaw/openclaw.json"

# 4. Copy memory files (CRITICAL — this is the brain)
echo "Copying memory..."
rsync -avz "$PI_USER@$PI_HOST:~/.openclaw/workspace/MEMORY.md" "$HOME/.openclaw/workspace/"
rsync -avz "$PI_USER@$PI_HOST:~/.openclaw/workspace/memory/" "$HOME/.openclaw/workspace/memory/"
rsync -avz "$PI_USER@$PI_HOST:~/.openclaw/workspace/SOUL.md" "$HOME/.openclaw/workspace/"
rsync -avz "$PI_USER@$PI_HOST:~/.openclaw/workspace/USER.md" "$HOME/.openclaw/workspace/"
rsync -avz "$PI_USER@$PI_HOST:~/.openclaw/workspace/AGENTS.md" "$HOME/.openclaw/workspace/"
rsync -avz "$PI_USER@$PI_HOST:~/.openclaw/workspace/TOOLS.md" "$HOME/.openclaw/workspace/"
rsync -avz "$PI_USER@$PI_HOST:~/.openclaw/workspace/IDENTITY.md" "$HOME/.openclaw/workspace/"
rsync -avz "$PI_USER@$PI_HOST:~/.openclaw/workspace/HEARTBEAT.md" "$HOME/.openclaw/workspace/"

# 5. Copy agent configs
echo "Copying agent configs..."
rsync -avz "$PI_USER@$PI_HOST:~/.openclaw/agents/" "$HOME/.openclaw/agents/"

# 6. Copy session transcripts (optional but useful for context)
echo "Copying session transcripts..."
rsync -avz "$PI_USER@$PI_HOST:~/.openclaw/agents/main/sessions/" "$HOME/.openclaw/agents/main/sessions/"

# 7. Update config for Mac environment
echo "Updating config paths..."
cat "$HOME/.openclaw/openclaw.json" | jq '.workspace = "'$HOME'/.openclaw/workspace"' > /tmp/oc-config.json
mv /tmp/oc-config.json "$HOME/.openclaw/openclaw.json"

# 8. Start OpenClaw
echo "Starting OpenClaw..."
openclaw gateway start

echo ""
echo "✅ Migration complete!"
echo "OpenClaw should be running with full memory and context."
echo ""
echo "Verify: openclaw status"
echo ""
echo "The Pi can now be:"
echo "  a) Kept as always-on node (for cron jobs, monitoring)"
echo "  b) Repurposed"
