#!/usr/bin/env bash
# Setup Firebase Remote Config default values for all Claw apps
# Idempotent — checks before setting
set -euo pipefail

# Default flags (key:value:description)
declare -A FLAGS=(
  ["fitness_ai_coach_enabled"]="true"
  ["fitness_social_features"]="false"
  ["nutrition_barcode_scan"]="true"
  ["nutrition_ai_estimation"]="true"
  ["nutrition_meal_photos"]="true"
  ["budget_partner_sharing"]="true"
  ["budget_plaid_sync"]="false"
  ["meetings_real_time_transcription"]="false"
  ["meetings_ai_coaching"]="true"
  ["global_dark_mode"]="true"
  ["global_pro_features"]="true"
  ["global_onboarding_v2"]="false"
)

# Firebase projects to configure
PROJECTS=("claw-fitness-prod" "claw-nutrition-prod" "claw-budget-prod" "claw-meetings-prod")

for PROJECT in "${PROJECTS[@]}"; do
  echo "=== Configuring $PROJECT ==="
  
  # Get current remote config template
  TEMPLATE_FILE=$(mktemp)
  if firebase --project "$PROJECT" remoteconfig:get -o "$TEMPLATE_FILE" 2>/dev/null; then
    echo "  Fetched existing template"
  else
    echo '{"parameters":{}}' > "$TEMPLATE_FILE"
    echo "  No existing template, starting fresh"
  fi

  UPDATED=false
  for KEY in "${!FLAGS[@]}"; do
    VALUE="${FLAGS[$KEY]}"
    
    # Check if parameter already exists
    if jq -e ".parameters.\"$KEY\"" "$TEMPLATE_FILE" > /dev/null 2>&1; then
      echo "  ✓ $KEY already set, skipping"
    else
      echo "  + Setting $KEY = $VALUE"
      # Add parameter to template
      jq ".parameters.\"$KEY\" = {\"defaultValue\": {\"value\": \"$VALUE\"}, \"valueType\": \"BOOLEAN\"}" \
        "$TEMPLATE_FILE" > "${TEMPLATE_FILE}.tmp" && mv "${TEMPLATE_FILE}.tmp" "$TEMPLATE_FILE"
      UPDATED=true
    fi
  done

  if [ "$UPDATED" = true ]; then
    echo "  Deploying updated template..."
    firebase --project "$PROJECT" remoteconfig:rollout -f "$TEMPLATE_FILE" 2>/dev/null || \
      echo "  ⚠ Could not deploy to $PROJECT (may need auth)"
  else
    echo "  No changes needed"
  fi

  rm -f "$TEMPLATE_FILE"
done

echo ""
echo "Done! Remote Config defaults configured for all Claw apps."
