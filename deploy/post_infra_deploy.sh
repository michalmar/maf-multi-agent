#!/usr/bin/env bash
#
# Post-infrastructure setup — run ONCE after `terraform apply`.
#
# Automates verification and prints the single manual step
# that cannot be automated (Fabric workspace access).
#
# For EXISTING deployments with manually-configured Easy Auth:
#   Import the auth config into state BEFORE running terraform apply:
#
#   cd deploy/terraform
#   terraform import 'azapi_resource.easyauth[0]' \
#     '/subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.App/containerApps/<app>/authConfigs/current'
#
#   After apply, you can delete the old manually-created resources:
#   - Old app registration (if Terraform created a new one)
#   - Old storage account (if Terraform created a new one)
#
# Usage:
#   cd deploy && ./post_infra_deploy.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TF_DIR="$SCRIPT_DIR/terraform"

# ── Read Terraform outputs ────────────────────────────────────
echo "📦 Reading Terraform outputs..."
cd "$TF_DIR"

RG=$(terraform output -raw resource_group_name)
APP=$(terraform output -raw container_app_name)
FQDN=$(terraform output -raw container_app_fqdn)
MI_PRINCIPAL_ID=$(terraform output -raw managed_identity_principal_id)
EASYAUTH_APP_ID=$(terraform output -raw easyauth_app_registration_id 2>/dev/null || echo "")
EASYAUTH_STORAGE=$(terraform output -raw easyauth_token_store_account 2>/dev/null || echo "")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Post-Infrastructure Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Resource Group:  $RG"
echo "  Container App:   $APP"
echo "  FQDN:            https://$FQDN"
echo "  MI Principal ID: $MI_PRINCIPAL_ID"
if [ -n "$EASYAUTH_APP_ID" ]; then
    echo "  Easy Auth App:   $EASYAUTH_APP_ID"
    echo "  Token Store:     $EASYAUTH_STORAGE"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Step 1: Verify Easy Auth ─────────────────────────────────
if [ -n "$EASYAUTH_APP_ID" ]; then
    echo "🔍 Verifying Easy Auth configuration..."
    AUTH_ENABLED=$(az containerapp auth show \
        --name "$APP" --resource-group "$RG" \
        --query "platform.enabled" -o tsv 2>/dev/null || echo "unknown")

    if [ "$AUTH_ENABLED" = "true" ]; then
        echo "   ✅ Easy Auth is enabled"
    else
        echo "   ❌ Easy Auth status: $AUTH_ENABLED"
        echo "   Run 'terraform apply' again or check for errors."
    fi

    # Verify token store accessibility
    echo ""
    echo "🔍 Verifying token store storage account..."
    PUBLIC_ACCESS=$(az storage account show \
        --name "$EASYAUTH_STORAGE" --resource-group "$RG" \
        --query "publicNetworkAccess" -o tsv 2>/dev/null || echo "unknown")

    if [ "$PUBLIC_ACCESS" = "Enabled" ]; then
        echo "   ✅ Token store is publicly accessible (required for Easy Auth sidecar)"
    else
        echo "   ⚠️  Token store publicNetworkAccess=$PUBLIC_ACCESS"
        echo "   Easy Auth sidecar needs public access. Run:"
        echo "   az storage account update --name $EASYAUTH_STORAGE --resource-group $RG --public-network-access Enabled"
    fi
    echo ""
fi

# ── Step 2: Fabric Workspace (manual) ────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ⚠️  MANUAL STEP REQUIRED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Add the Managed Identity to your Fabric workspace as Admin:"
echo ""
echo "  1. Go to https://app.fabric.microsoft.com"
echo "  2. Open your workspace → Settings → Manage access"
echo "  3. Click 'Add people or groups'"
echo "  4. Search by Object ID: $MI_PRINCIPAL_ID"
echo "  5. Set role to 'Admin'"
echo ""
echo "  This grants the MI access for the MCP handshake with the Data Agent."
echo "  (Fabric has no public API for workspace access management.)"
echo ""

# ── Step 3: Summary ──────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Infrastructure setup complete!"
echo "  🌐 https://${FQDN}"
echo ""
echo "  Next: run ./deploy.sh to build and deploy the app image."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
