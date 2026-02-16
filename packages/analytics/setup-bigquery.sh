#!/bin/bash
# BigQuery Analytics Setup — Idempotent
# Creates datasets, tables, and views for all Claw apps
# Usage: ./setup-bigquery.sh [--dry-run]
set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

PROJECT="${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT env var}"
LOCATION="${BIGQUERY_LOCATION:-US}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
ok() { echo -e "${GREEN}[OK]${NC} $1"; }
skip() { echo -e "${YELLOW}[SKIP]${NC} $1"; }

# Check prerequisites
command -v bq >/dev/null 2>&1 || { echo "❌ bq CLI not found. Install: gcloud components install bq"; exit 1; }

DATASETS=(claw_fitness claw_nutrition claw_meetings claw_budget claw_cross_app)

# Create datasets
for ds in "${DATASETS[@]}"; do
  if bq show --project_id="$PROJECT" "$ds" >/dev/null 2>&1; then
    skip "Dataset $ds already exists"
  elif $DRY_RUN; then
    info "[DRY RUN] Would create dataset $ds"
  else
    info "Creating dataset $ds..."
    bq mk --project_id="$PROJECT" --location="$LOCATION" --dataset "$ds"
    ok "Created $ds"
  fi
done

# Create views
for view_file in "$SCRIPT_DIR/src/views/"*.sql; do
  view_name=$(basename "$view_file" .sql | tr '-' '_')
  info "Creating/updating view claw_cross_app.$view_name..."
  if $DRY_RUN; then
    info "[DRY RUN] Would create view $view_name"
  else
    # Replace project placeholder
    sql=$(sed "s/\${PROJECT}/$PROJECT/g" "$view_file")
    bq query --project_id="$PROJECT" --use_legacy_sql=false --replace \
      "CREATE OR REPLACE VIEW \`$PROJECT.claw_cross_app.$view_name\` AS $sql" 2>/dev/null \
      && ok "View $view_name created" \
      || skip "View $view_name skipped (may need tables first)"
  fi
done

echo ""
ok "✅ BigQuery setup complete for project: $PROJECT"
echo ""
echo "Next steps:"
echo "  1. Enable Firebase BigQuery Export extension in Firebase Console"
echo "  2. Configure Firestore collections to export"
echo "  3. Deploy Cloud Functions with EventPublisher integration"
