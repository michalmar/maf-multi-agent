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
#   - Sufficient permissions:
#       Group.ReadWrite.All or Group owner for group membership
#       User.ReadWrite.All to set userType/profile details
#       User.Invite.All to invite missing external users
#   - Terraform outputs available (or pass group IDs manually)
#
# Usage:
#   ./add_user.sh <user-email> [--display-name "Name Surname"] [--app-only | --data-only] [--remove]
#
# Examples:
#   ./add_user.sh alice.smith@contoso.com              # Invite/create as Member, add to both groups
#   ./add_user.sh alice.smith@contoso.com --display-name "Alice Smith"
#   ./add_user.sh alice.smith@contoso.com --app-only   # App access only
#   ./add_user.sh alice.smith@contoso.com --data-only  # Data access only
#   ./add_user.sh alice.smith@contoso.com --remove     # Remove from both groups
#
# Group ID defaults (can be overridden by environment variables):
#   APP_USERS_GROUP_ID=<guid>  DATA_USERS_GROUP_ID=<guid>
#   INVITE_REDIRECT_URL=<url>  SEND_INVITATION_MESSAGE=false
#   USER_TEMP_PASSWORD=<password>  # create local Member user instead of B2B invite
# ──────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

usage() {
  echo "Usage: $0 <user-email> [--display-name \"Name Surname\"] [--app-only | --data-only] [--remove]"
  echo ""
  echo "Adds the user as an Entra ID Member and assigns security group access."
  echo "If the user is missing, the script invites them as a Member by default."
  echo "Set USER_TEMP_PASSWORD to create a local Member account instead."
  echo ""
  echo "Options:"
  echo "  --display-name NAME  Use this display name instead of inferring it from email"
  echo "  --app-only   Only add/remove from the App-Users group (app login)"
  echo "  --data-only  Only add/remove from the Data-Users group (Fabric data)"
  echo "  --remove     Remove user from the specified group(s)"
  echo ""
  echo "Environment overrides:"
  echo "  APP_USERS_GROUP_ID       Object ID of the App-Users security group"
  echo "  DATA_USERS_GROUP_ID      Object ID of the Data-Users security group"
  echo "  INVITE_REDIRECT_URL      Redirect URL for B2B invitation redemption"
  echo "  SEND_INVITATION_MESSAGE  true/false; defaults to true for missing users"
  echo "  USER_TEMP_PASSWORD       Create local Member user with this temporary password"
  exit 1
}

# ── Parse arguments ───────────────────────────────────────────
[[ $# -lt 1 ]] && usage
[[ "$1" == "-h" || "$1" == "--help" ]] && usage

USER_EMAIL="$1"
shift

MODE="both"  # both | app-only | data-only
ACTION="add" # add | remove
DISPLAY_NAME_OVERRIDE=""

APP_USERS_GROUP_ID="${APP_USERS_GROUP_ID:-dcfe89c0-b221-459c-bb5e-d40dfd121819}"
DATA_USERS_GROUP_ID="${DATA_USERS_GROUP_ID:-09a2ccc2-03f5-4dba-bb59-49ae9ea9be95}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --display-name)
      [[ $# -lt 2 || -z "$2" ]] && { echo -e "${RED}--display-name requires a value${NC}"; usage; }
      DISPLAY_NAME_OVERRIDE="$2"
      shift 2
      ;;
    --app-only)  MODE="app-only";  shift ;;
    --data-only) MODE="data-only"; shift ;;
    --remove)    ACTION="remove";  shift ;;
    -h|--help)   usage ;;
    *) echo -e "${RED}Unknown option: $1${NC}"; usage ;;
  esac
done

if [[ ! "$USER_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo -e "${RED}Invalid email address: ${USER_EMAIL}${NC}"
  exit 1
fi

SEND_INVITATION_MESSAGE="${SEND_INVITATION_MESSAGE:-true}"
case "$SEND_INVITATION_MESSAGE" in
  true|false) ;;
  TRUE|True) SEND_INVITATION_MESSAGE="true" ;;
  FALSE|False) SEND_INVITATION_MESSAGE="false" ;;
  *)
    echo -e "${RED}SEND_INVITATION_MESSAGE must be true or false.${NC}"
    exit 1
    ;;
esac

# ── Verify Azure CLI login ────────────────────────────────────
if ! az account show &>/dev/null; then
  echo -e "${RED}Not logged in to Azure CLI. Run 'az login' first.${NC}"
  exit 1
fi

# ── Resolve group IDs ─────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$SCRIPT_DIR/terraform"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

title_case_word() {
  printf '%s' "$1" | awk '{ print toupper(substr($0, 1, 1)) tolower(substr($0, 2)) }'
}

infer_names_from_email() {
  local email="$1"
  local local_part cleaned part i
  local parts=()
  local surname_parts=()

  local_part="${email%@*}"
  local_part="${local_part%%+*}"
  MAIL_NICKNAME=$(printf '%s' "$local_part" | tr -cd '[:alnum:]_-')
  [[ -z "$MAIL_NICKNAME" ]] && MAIL_NICKNAME="user"

  cleaned=$(printf '%s' "$local_part" | sed -E 's/[._-]+/ /g; s/[^[:alnum:] ]+/ /g; s/[[:space:]]+/ /g; s/^ //; s/ $//')
  [[ -z "$cleaned" ]] && cleaned="$local_part"
  read -r -a parts <<< "$cleaned"

  INFERRED_GIVEN_NAME="User"
  INFERRED_SURNAME=""
  if [[ "${#parts[@]}" -gt 0 ]]; then
    INFERRED_GIVEN_NAME="$(title_case_word "${parts[0]}")"
    if [[ "${#parts[@]}" -gt 1 ]]; then
      for ((i = 1; i < ${#parts[@]}; i++)); do
        part="$(title_case_word "${parts[$i]}")"
        [[ -n "$part" ]] && surname_parts+=("$part")
      done
      INFERRED_SURNAME="${surname_parts[*]}"
    fi
  fi

  INFERRED_DISPLAY_NAME="$INFERRED_GIVEN_NAME"
  [[ -n "$INFERRED_SURNAME" ]] && INFERRED_DISPLAY_NAME="$INFERRED_GIVEN_NAME $INFERRED_SURNAME"

  if [[ -n "$DISPLAY_NAME_OVERRIDE" ]]; then
    local display_clean display_parts=()
    display_clean=$(printf '%s' "$DISPLAY_NAME_OVERRIDE" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')
    if [[ -n "$display_clean" ]]; then
      read -r -a display_parts <<< "$display_clean"
      INFERRED_DISPLAY_NAME="$display_clean"
      INFERRED_GIVEN_NAME="${display_parts[0]}"
      INFERRED_SURNAME=""
      if [[ "${#display_parts[@]}" -gt 1 ]]; then
        INFERRED_SURNAME="${display_parts[*]:1}"
      fi
    fi
  fi
}

az_user_field() {
  local value
  value=$(az ad user show --id "$USER_ID" --query "$1" -o tsv 2>/dev/null || true)
  case "$value" in
    null|None) value="" ;;
  esac
  printf '%s' "$value"
}

find_user_id() {
  local email="$1"
  local id

  id=$(az ad user show --id "$email" --query id -o tsv 2>/dev/null || true)
  [[ -n "$id" ]] && { printf '%s' "$id"; return; }

  id=$(az ad user list --filter "mail eq '$email'" --query "[0].id" -o tsv 2>/dev/null || true)
  [[ -n "$id" ]] && { printf '%s' "$id"; return; }

  id=$(az ad user list --filter "userPrincipalName eq '$email'" --query "[0].id" -o tsv 2>/dev/null || true)
  [[ -n "$id" ]] && { printf '%s' "$id"; return; }

  id=$(az ad user list --filter "otherMails/any(c:c eq '$email')" --query "[0].id" -o tsv 2>/dev/null || true)
  [[ -n "$id" ]] && printf '%s' "$id"
  return 0
}

load_user_profile() {
  USER_TYPE="$(az_user_field userType)"
  USER_GIVEN_NAME="$(az_user_field givenName)"
  USER_SURNAME="$(az_user_field surname)"
  USER_DISPLAY_NAME="$(az_user_field displayName)"
  USER_PRINCIPAL_NAME="$(az_user_field userPrincipalName)"
}

resolve_invite_redirect_url() {
  if [[ -n "${INVITE_REDIRECT_URL:-}" ]]; then
    return
  fi

  local fqdn=""
  if [[ -d "$TF_DIR/.terraform" ]]; then
    fqdn=$(cd "$TF_DIR" && terraform output -raw container_app_fqdn 2>/dev/null || true)
  fi

  if [[ -n "$fqdn" ]]; then
    INVITE_REDIRECT_URL="https://${fqdn}"
  else
    INVITE_REDIRECT_URL="https://myapps.microsoft.com"
  fi
}

create_local_member_user() {
  local body output
  local escaped_email escaped_display escaped_nickname escaped_password escaped_given escaped_surname

  escaped_email="$(json_escape "$USER_EMAIL")"
  escaped_display="$(json_escape "$INFERRED_DISPLAY_NAME")"
  escaped_nickname="$(json_escape "$MAIL_NICKNAME")"
  escaped_password="$(json_escape "$USER_TEMP_PASSWORD")"
  body="{\"accountEnabled\":true,\"displayName\":\"${escaped_display}\",\"mailNickname\":\"${escaped_nickname}\",\"userPrincipalName\":\"${escaped_email}\",\"passwordProfile\":{\"forceChangePasswordNextSignIn\":true,\"password\":\"${escaped_password}\"},\"userType\":\"Member\""

  if [[ -n "$INFERRED_GIVEN_NAME" ]]; then
    escaped_given="$(json_escape "$INFERRED_GIVEN_NAME")"
    body="${body},\"givenName\":\"${escaped_given}\""
  fi
  if [[ -n "$INFERRED_SURNAME" ]]; then
    escaped_surname="$(json_escape "$INFERRED_SURNAME")"
    body="${body},\"surname\":\"${escaped_surname}\""
  fi
  body="${body}}"

  echo -e "${CYAN}User not found. Creating local Entra ID Member user...${NC}"
  echo -e "  Display name: ${INFERRED_DISPLAY_NAME}"
  if ! output=$(az rest --only-show-errors --method post --url "https://graph.microsoft.com/v1.0/users" --headers "Content-Type=application/json" --body "$body" --query id -o tsv 2>&1); then
    echo -e "${RED}Failed to create local Member user.${NC}"
    echo "$output"
    exit 1
  fi
  USER_ID="$output"
  if [[ -z "$USER_ID" ]]; then
    echo -e "${RED}User creation succeeded but no user ID was returned.${NC}"
    exit 1
  fi
}

invite_member_user() {
  local body output
  local escaped_email escaped_display escaped_redirect

  resolve_invite_redirect_url
  escaped_email="$(json_escape "$USER_EMAIL")"
  escaped_display="$(json_escape "$INFERRED_DISPLAY_NAME")"
  escaped_redirect="$(json_escape "$INVITE_REDIRECT_URL")"
  body="{\"invitedUserEmailAddress\":\"${escaped_email}\",\"invitedUserDisplayName\":\"${escaped_display}\",\"invitedUserType\":\"Member\",\"inviteRedirectUrl\":\"${escaped_redirect}\",\"sendInvitationMessage\":${SEND_INVITATION_MESSAGE}}"

  echo -e "${CYAN}User not found. Inviting as Entra ID Member...${NC}"
  echo -e "  Display name: ${INFERRED_DISPLAY_NAME}"
  echo -e "  Invite redirect: ${INVITE_REDIRECT_URL}"
  if ! output=$(az rest --only-show-errors --method post --url "https://graph.microsoft.com/v1.0/invitations" --headers "Content-Type=application/json" --body "$body" --query "invitedUser.id" -o tsv 2>&1); then
    echo -e "${RED}Failed to invite Member user.${NC}"
    echo "$output"
    echo "Set USER_TEMP_PASSWORD to create a local tenant user instead of sending a B2B invitation."
    exit 1
  fi
  USER_ID="$output"
  if [[ -z "$USER_ID" ]]; then
    echo -e "${RED}Invitation succeeded but no user ID was returned.${NC}"
    exit 1
  fi
}

ensure_user_type_member() {
  local output
  if [[ "$USER_TYPE" == "Member" ]]; then
    echo -e "  userType: Member"
    return
  fi

  echo -e "${CYAN}Updating userType to Member...${NC}"
  if ! output=$(az rest --only-show-errors --method patch --url "https://graph.microsoft.com/v1.0/users/${USER_ID}" --headers "Content-Type=application/json" --body '{"userType":"Member"}' -o none 2>&1); then
    echo -e "${RED}Failed to set userType=Member for ${USER_EMAIL}.${NC}"
    echo "$output"
    exit 1
  fi
  USER_TYPE="Member"
  echo -e "  ${GREEN}✓ userType is Member${NC}"
}

add_profile_patch_prop() {
  local name="$1"
  local value
  value="$(json_escape "$2")"
  if [[ "$PROFILE_PATCH_COUNT" -gt 0 ]]; then
    PROFILE_PATCH_BODY="${PROFILE_PATCH_BODY},"
  fi
  PROFILE_PATCH_BODY="${PROFILE_PATCH_BODY}\"${name}\":\"${value}\""
  PROFILE_PATCH_COUNT=$((PROFILE_PATCH_COUNT + 1))
}

ensure_profile_names() {
  local output
  PROFILE_PATCH_BODY="{"
  PROFILE_PATCH_COUNT=0

  [[ -z "$USER_GIVEN_NAME" && -n "$INFERRED_GIVEN_NAME" ]] && add_profile_patch_prop "givenName" "$INFERRED_GIVEN_NAME"
  [[ -z "$USER_SURNAME" && -n "$INFERRED_SURNAME" ]] && add_profile_patch_prop "surname" "$INFERRED_SURNAME"
  if [[ -z "$USER_DISPLAY_NAME" || "$USER_DISPLAY_NAME" == "$USER_EMAIL" || "$USER_DISPLAY_NAME" == "$USER_PRINCIPAL_NAME" ]]; then
    add_profile_patch_prop "displayName" "$INFERRED_DISPLAY_NAME"
  fi

  PROFILE_PATCH_BODY="${PROFILE_PATCH_BODY}}"
  if [[ "$PROFILE_PATCH_COUNT" -eq 0 ]]; then
    return
  fi

  echo -e "${CYAN}Updating missing profile names from email...${NC}"
  if ! output=$(az rest --only-show-errors --method patch --url "https://graph.microsoft.com/v1.0/users/${USER_ID}" --headers "Content-Type=application/json" --body "$PROFILE_PATCH_BODY" -o none 2>&1); then
    echo -e "${RED}Failed to update profile names for ${USER_EMAIL}.${NC}"
    echo "$output"
    exit 1
  fi
  echo -e "  ${GREEN}✓ Profile name is ${INFERRED_DISPLAY_NAME}${NC}"
}

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

# ── Resolve or create user object ─────────────────────────────
infer_names_from_email "$USER_EMAIL"
echo -e "${CYAN}Looking up user: ${USER_EMAIL}${NC}"
USER_ID="$(find_user_id "$USER_EMAIL")"

if [[ -z "$USER_ID" ]]; then
  if [[ "$ACTION" == "remove" ]]; then
    echo -e "${RED}User not found in Entra ID: ${USER_EMAIL}${NC}"
    echo "Nothing to remove."
    exit 1
  fi

  if [[ -n "${USER_TEMP_PASSWORD:-}" ]]; then
    create_local_member_user
  else
    invite_member_user
  fi
fi

load_user_profile
if [[ "$ACTION" == "add" ]]; then
  ensure_user_type_member
  ensure_profile_names
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
