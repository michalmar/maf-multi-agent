#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# add_user.sh — Onboard a user to the MAF multi-agent app
# ──────────────────────────────────────────────────────────────
#
# Adds a user (by email / UPN) to the Entra ID security groups
# created by Terraform, granting them:
#   - App access  (App-Users group → can log in via Easy Auth)
#   - Data access (Data-Users group → Fabric Data Agent queries)
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - Sufficient permissions: Group.ReadWrite.All or Group owner
#   - Terraform outputs available (or pass group IDs manually)
#
# Usage:
#   ./add_user.sh <user-email> [--app-only | --data-only] [--remove]
#
# Examples:
#   ./add_user.sh alice@contoso.com              # Add to both groups
#   ./add_user.sh alice@contoso.com --app-only   # App access only
#   ./add_user.sh alice@contoso.com --data-only  # Data access only
#   ./add_user.sh alice@contoso.com --remove      # Remove from both groups
#
# Environment overrides (skip Terraform output lookup):
#   APP_USERS_GROUP_ID=<guid>  DATA_USERS_GROUP_ID=<guid>
# ──────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

usage() {
  echo "Usage: $0 <user-email> [--app-only | --data-only] [--remove]"
  echo ""
  echo "Options:"
  echo "  --app-only   Only add/remove from the App-Users group (app login)"
  echo "  --data-only  Only add/remove from the Data-Users group (Fabric data)"
  echo "  --remove     Remove user from the specified group(s)"
  echo ""
  echo "Environment overrides:"
  echo "  APP_USERS_GROUP_ID   Object ID of the App-Users security group"
  echo "  DATA_USERS_GROUP_ID  Object ID of the Data-Users security group"
  exit 1
}

# ── Parse arguments ───────────────────────────────────────────
[[ $# -lt 1 ]] && usage
[[ "$1" == "-h" || "$1" == "--help" ]] && usage

USER_EMAIL="$1"
shift

MODE="both"  # both | app-only | data-only
ACTION="add" # add | remove

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-only)  MODE="app-only";  shift ;;
    --data-only) MODE="data-only"; shift ;;
    --remove)    ACTION="remove";  shift ;;
    -h|--help)   usage ;;
    *) echo -e "${RED}Unknown option: $1${NC}"; usage ;;
  esac
done

# ── Verify Azure CLI login ────────────────────────────────────
if ! az account show &>/dev/null; then
  echo -e "${RED}Not logged in to Azure CLI. Run 'az login' first.${NC}"
  exit 1
fi

# ── Resolve group IDs ─────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$SCRIPT_DIR/terraform"

resolve_group_ids() {
  if [[ -n "${APP_USERS_GROUP_ID:-}" && -n "${DATA_USERS_GROUP_ID:-}" ]]; then
    echo -e "${CYAN}Using group IDs from environment variables${NC}"
    return
  fi

  if [[ -d "$TF_DIR/.terraform" ]]; then
    echo -e "${CYAN}Reading group IDs from Terraform outputs...${NC}"
    APP_USERS_GROUP_ID="${APP_USERS_GROUP_ID:-$(cd "$TF_DIR" && terraform output -raw app_users_group_id 2>/dev/null || true)}"
    DATA_USERS_GROUP_ID="${DATA_USERS_GROUP_ID:-$(cd "$TF_DIR" && terraform output -raw data_users_group_id 2>/dev/null || true)}"
  fi

  if [[ -z "${APP_USERS_GROUP_ID:-}" || -z "${DATA_USERS_GROUP_ID:-}" ]]; then
    echo -e "${YELLOW}Could not read Terraform outputs. Looking up groups by name...${NC}"
    local app_name
    app_name=$(cd "$TF_DIR" && terraform output -raw container_app_name 2>/dev/null || echo "maf-multi-agent")
    APP_USERS_GROUP_ID="${APP_USERS_GROUP_ID:-$(az ad group show --group "${app_name}-App-Users" --query id -o tsv 2>/dev/null || true)}"
    DATA_USERS_GROUP_ID="${DATA_USERS_GROUP_ID:-$(az ad group show --group "${app_name}-Data-Users" --query id -o tsv 2>/dev/null || true)}"
  fi

  if [[ -z "${APP_USERS_GROUP_ID:-}" ]]; then
    echo -e "${RED}Cannot resolve App-Users group ID. Set APP_USERS_GROUP_ID or run from the deploy/ directory with Terraform state.${NC}"
    exit 1
  fi
  if [[ -z "${DATA_USERS_GROUP_ID:-}" ]]; then
    echo -e "${RED}Cannot resolve Data-Users group ID. Set DATA_USERS_GROUP_ID or run from the deploy/ directory with Terraform state.${NC}"
    exit 1
  fi
}

resolve_group_ids

# ── Resolve user object ID ────────────────────────────────────
echo -e "${CYAN}Looking up user: ${USER_EMAIL}${NC}"
USER_ID=$(az ad user show --id "$USER_EMAIL" --query id -o tsv 2>/dev/null || true)

if [[ -z "$USER_ID" ]]; then
  echo -e "${RED}User not found in Entra ID: ${USER_EMAIL}${NC}"
  echo "Ensure the user exists and you have User.Read.All permission."
  exit 1
fi
echo -e "  User ID: ${USER_ID}"

# ── Add or remove from groups ─────────────────────────────────
add_to_group() {
  local group_id="$1" group_name="$2"

  # Check if already a member
  if az ad group member check --group "$group_id" --member-id "$USER_ID" --query value -o tsv 2>/dev/null | grep -qi true; then
    echo -e "  ${YELLOW}Already a member of ${group_name}${NC}"
    return
  fi

  az ad group member add --group "$group_id" --member-id "$USER_ID" 2>/dev/null
  echo -e "  ${GREEN}✓ Added to ${group_name}${NC}"
}

remove_from_group() {
  local group_id="$1" group_name="$2"

  # Check if actually a member
  if ! az ad group member check --group "$group_id" --member-id "$USER_ID" --query value -o tsv 2>/dev/null | grep -qi true; then
    echo -e "  ${YELLOW}Not a member of ${group_name} — nothing to remove${NC}"
    return
  fi

  az ad group member remove --group "$group_id" --member-id "$USER_ID" 2>/dev/null
  echo -e "  ${GREEN}✓ Removed from ${group_name}${NC}"
}

echo ""
if [[ "$ACTION" == "add" ]]; then
  echo -e "${CYAN}Adding ${USER_EMAIL} to security groups...${NC}"
  [[ "$MODE" == "both" || "$MODE" == "app-only" ]]  && add_to_group "$APP_USERS_GROUP_ID" "App-Users"
  [[ "$MODE" == "both" || "$MODE" == "data-only" ]] && add_to_group "$DATA_USERS_GROUP_ID" "Data-Users"
else
  echo -e "${CYAN}Removing ${USER_EMAIL} from security groups...${NC}"
  [[ "$MODE" == "both" || "$MODE" == "app-only" ]]  && remove_from_group "$APP_USERS_GROUP_ID" "App-Users"
  [[ "$MODE" == "both" || "$MODE" == "data-only" ]] && remove_from_group "$DATA_USERS_GROUP_ID" "Data-Users"
fi

# ── Summary ───────────────────────────────────────────────────
echo ""
echo -e "${GREEN}Done.${NC}"
if [[ "$ACTION" == "add" ]]; then
  echo ""
  echo "What the user gets:"
  [[ "$MODE" == "both" || "$MODE" == "app-only" ]]  && echo "  • App-Users  → Can log in to the app via Easy Auth"
  [[ "$MODE" == "both" || "$MODE" == "data-only" ]] && echo "  • Data-Users → Fabric Data Agent queries run under their identity"
  echo ""
  echo -e "${YELLOW}Reminder:${NC} The Data-Users group must be assigned as Viewer"
  echo "in the Fabric workspace (one-time setup, not per-user)."
fi
