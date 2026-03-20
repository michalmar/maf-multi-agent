#!/usr/bin/env bash
#
# Build the container image in ACR and deploy it to the Container App.
#
# Usage:
#   cd deploy && ./deploy.sh                # uses Terraform outputs
#   ./deploy.sh --rg myRg --acr myAcr --app myApp   # explicit values
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TF_DIR="$SCRIPT_DIR/terraform"

# ── Parse arguments or read from Terraform outputs ────────────
if [[ "${1:-}" == "--rg" ]]; then
    RG="$2"; ACR="$4"; APP="$6"
else
    echo "📦 Reading values from Terraform outputs..."
    cd "$TF_DIR"
    RG=$(terraform output -raw resource_group_name)
    ACR=$(terraform output -raw acr_name)
    ACR_SERVER=$(terraform output -raw acr_login_server)
    APP=$(terraform output -raw container_app_name)
    cd "$REPO_ROOT"
fi

ACR_SERVER="${ACR_SERVER:-${ACR}.azurecr.io}"
IMAGE="${ACR_SERVER}/${APP}:$(git rev-parse --short HEAD)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Resource Group:  $RG"
echo "  ACR:             $ACR_SERVER"
echo "  Container App:   $APP"
echo "  Image tag:       $IMAGE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Step 1: Build image in ACR ────────────────────────────────
echo "🔨 Building image in ACR (cloud build)..."
az acr build \
    --registry "$ACR" \
    --resource-group "$RG" \
    --image "${APP}:$(git rev-parse --short HEAD)" \
    --image "${APP}:latest" \
    --file Dockerfile \
    "$REPO_ROOT"

# ── Step 2: Update Container App ──────────────────────────────
echo "🚀 Updating Container App with new image..."
az containerapp update \
    --name "$APP" \
    --resource-group "$RG" \
    --image "$IMAGE"

# ── Step 3: Show result ──────────────────────────────────────
FQDN=$(az containerapp show --name "$APP" --resource-group "$RG" --query "properties.configuration.ingress.fqdn" -o tsv)
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Deployed successfully!"
echo "  🌐 https://${FQDN}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
