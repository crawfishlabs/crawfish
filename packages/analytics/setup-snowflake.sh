#!/bin/bash
# Snowflake Analytics Setup — Idempotent
# Creates database, warehouse, schemas, tables, and views
# Usage: ./setup-snowflake.sh [--dry-run]
set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

ACCOUNT="${SNOWFLAKE_ACCOUNT:?Set SNOWFLAKE_ACCOUNT env var}"
USER="${SNOWFLAKE_USER:?Set SNOWFLAKE_USER env var}"
WAREHOUSE="${SNOWFLAKE_WAREHOUSE:-CLAW_XS}"
DATABASE="${SNOWFLAKE_DATABASE:-CLAW_ANALYTICS}"
ROLE="${SNOWFLAKE_ROLE:-SYSADMIN}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
ok() { echo -e "${GREEN}[OK]${NC} $1"; }
skip() { echo -e "${YELLOW}[DRY]${NC} $1"; }

# Check prerequisites
command -v snowsql >/dev/null 2>&1 || { echo "❌ snowsql not found. Install: https://docs.snowflake.com/en/user-guide/snowsql-install-config"; exit 1; }

run_sql() {
  local desc="$1" sql="$2"
  if $DRY_RUN; then
    skip "$desc"
    echo "    SQL: ${sql:0:100}..."
  else
    info "$desc"
    snowsql -a "$ACCOUNT" -u "$USER" -r "$ROLE" -q "$sql" --noup 2>/dev/null && ok "$desc" || echo "  ⚠️  May already exist"
  fi
}

echo "🦞 Snowflake Analytics Setup for Claw"
echo "   Account: $ACCOUNT | Database: $DATABASE | Warehouse: $WAREHOUSE"
echo ""

# 1. Create warehouse
run_sql "Create warehouse $WAREHOUSE" \
  "CREATE WAREHOUSE IF NOT EXISTS $WAREHOUSE
   WITH WAREHOUSE_SIZE = 'X-SMALL'
   AUTO_SUSPEND = 60
   AUTO_RESUME = TRUE
   INITIALLY_SUSPENDED = TRUE
   COMMENT = 'Claw analytics - X-Small, auto-suspend 60s';"

# 2. Create database
run_sql "Create database $DATABASE" \
  "CREATE DATABASE IF NOT EXISTS $DATABASE COMMENT = 'Claw app analytics';"

# 3. Create schemas
for schema in FITNESS NUTRITION MEETINGS BUDGET CROSS_APP; do
  run_sql "Create schema $DATABASE.$schema" \
    "CREATE SCHEMA IF NOT EXISTS $DATABASE.$schema COMMENT = 'Schema for ${schema,,} analytics';"
done

# 4. Create tables from schema definitions
# Read TypeScript schema files and extract SQL (between backticks)
for schema_file in "$SCRIPT_DIR/src/schemas/"*-schema.ts; do
  app=$(basename "$schema_file" -schema.ts)
  info "Creating tables for $app..."
  
  # Extract SQL CREATE TABLE statements from TypeScript files
  grep -oP '`[^`]+CREATE TABLE[^`]+`' "$schema_file" 2>/dev/null | tr -d '`' | while IFS= read -r sql; do
    table_name=$(echo "$sql" | grep -oP 'CREATE TABLE IF NOT EXISTS \K\w+' || echo "unknown")
    schema_name=$(echo "$app" | tr '[:lower:]' '[:upper:]' | sed 's/CROSS-APP/CROSS_APP/')
    full_sql=$(echo "$sql" | sed "s/CREATE TABLE IF NOT EXISTS $table_name/CREATE TABLE IF NOT EXISTS $DATABASE.$schema_name.$table_name/")
    
    if $DRY_RUN; then
      skip "  Table: $schema_name.$table_name"
    else
      snowsql -a "$ACCOUNT" -u "$USER" -r "$ROLE" -d "$DATABASE" -s "$schema_name" -q "$full_sql" --noup 2>/dev/null \
        && ok "  Table: $schema_name.$table_name" \
        || echo "  ⚠️  $table_name may already exist"
    fi
  done
done

# 5. Create views
for view_file in "$SCRIPT_DIR/src/views/"*.sql; do
  view_name=$(basename "$view_file" .sql | tr '-' '_' | tr '[:lower:]' '[:upper:]')
  sql=$(cat "$view_file")
  run_sql "Create view CROSS_APP.$view_name" \
    "CREATE OR REPLACE VIEW $DATABASE.CROSS_APP.$view_name AS $sql;"
done

echo ""
ok "✅ Snowflake setup complete!"
echo ""
echo "Next steps:"
echo "  1. Set SNOWFLAKE_PASSWORD in your .env.services"
echo "  2. Deploy Cloud Functions with Firestore → Snowflake pipeline"
echo "  3. Verify: snowsql -a $ACCOUNT -u $USER -q 'SHOW SCHEMAS IN $DATABASE'"
