#!/bin/bash
# Transfer food database from Pi to Mac
# Run on Mac

PI_HOST="openclaw-pi.local"
PI_USER="sam"
DATA_DIR="$HOME/Developer/claw/claw-nutrition/data"

mkdir -p "$DATA_DIR"

echo "Transferring food database from Pi (~10GB)..."
echo "This will take a while over WiFi. Use ethernet if possible."

rsync -avz --progress \
  "$PI_USER@$PI_HOST:~/.openclaw/workspace/projects/claw-nutrition/data/openfoodfacts/" \
  "$DATA_DIR/openfoodfacts/"

rsync -avz --progress \
  "$PI_USER@$PI_HOST:~/.openclaw/workspace/projects/claw-nutrition/data/usda/" \
  "$DATA_DIR/usda/"

# Copy indexing script
rsync -avz \
  "$PI_USER@$PI_HOST:~/.openclaw/workspace/projects/claw-nutrition/data/index-to-meilisearch.ts" \
  "$DATA_DIR/"

echo "✅ Data transferred. Run indexer:"
echo "  cd $DATA_DIR && npx tsx index-to-meilisearch.ts"
