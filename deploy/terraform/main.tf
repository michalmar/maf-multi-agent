terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

# ── Resource Group ────────────────────────────────────────────
resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
}

# ── Container Registry ────────────────────────────────────────
resource "azurerm_container_registry" "main" {
  name                = var.acr_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = false
}

# ── Log Analytics (required by Container App Environment) ─────
resource "azurerm_log_analytics_workspace" "main" {
  name                = "${var.app_name}-logs"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

# ── Container App Environment ─────────────────────────────────
resource "azurerm_container_app_environment" "main" {
  name                       = "${var.app_name}-env"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
}

# ── User-Assigned Managed Identity ────────────────────────────
resource "azurerm_user_assigned_identity" "main" {
  name                = "${var.app_name}-identity"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
}

# Grant AcrPull so the Container App can pull images
resource "azurerm_role_assignment" "acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.main.principal_id
}

# Grant Azure AI Developer on the AI services resource (for Foundry + OpenAI)
resource "azurerm_role_assignment" "ai_developer" {
  count                = var.ai_services_resource_id != "" ? 1 : 0
  scope                = var.ai_services_resource_id
  role_definition_name = "Azure AI User"
  principal_id         = azurerm_user_assigned_identity.main.principal_id
}

# Grant Contributor on the Fabric capacity resource (for status check + resume)
# Scoped to the single capacity resource — NOT the subscription or resource group.
# Needed actions: Microsoft.Fabric/capacities/read, .../resume/action
resource "azurerm_role_assignment" "fabric_capacity_contributor" {
  count                = var.fabric_capacity_resource_id != "" ? 1 : 0
  scope                = var.fabric_capacity_resource_id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.main.principal_id
}

# ── Fabric Data Agent — Authentication ────────────────────────
# Fabric Data Agent requires **user identity tokens** for data queries.
# Service principal / managed identity tokens are rejected at the data layer.
#
# Architecture:
#   - Frontend acquires a Fabric-scoped user token via MSAL (browser login)
#   - Token is passed through: POST /api/run → workflow → dispatcher → MCP client
#   - MCP client uses the user token as Bearer for Fabric API calls
#   - DefaultAzureCredential (MI) is used as fallback for MCP handshake only
#
# The MSAL SPA app registration is created outside Terraform (az ad app create).
# NEXT_PUBLIC_MSAL_CLIENT_ID and NEXT_PUBLIC_MSAL_TENANT_ID are build-time
# Next.js variables with hardcoded defaults in frontend/lib/msal-config.ts.
#
# Post-apply manual steps:
#   1. Add the Managed Identity to your Fabric workspace (for MCP handshake):
#      Fabric Portal → Workspace settings → Manage access →
#      Add the MI (use managed_identity_principal_id output) as Admin
#   2. Create an Entra SPA app registration with:
#      - Redirect URIs: http://localhost:3000, https://<aca-fqdn>
#      - Delegated permission: Fabric DataAgent.Execute.All
#      - Admin consent granted
#   3. Update frontend/lib/msal-config.ts with the app's client ID + tenant ID

# ── Container App (starts with hello-world, updated by deploy.sh) ─
resource "azurerm_container_app" "main" {
  name                         = var.app_name
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.main.id]
  }

  registry {
    server   = azurerm_container_registry.main.login_server
    identity = azurerm_user_assigned_identity.main.id
  }

  template {
    min_replicas = 1
    max_replicas = 1

    container {
      name   = "app"
      image  = "mcr.microsoft.com/k8se/quickstart:latest"
      cpu    = 1.0
      memory = "2Gi"

      env {
        name  = "PROJECT_ENDPOINT"
        value = var.project_endpoint
      }
      env {
        name  = "AZURE_OPENAI_CHAT_DEPLOYMENT_NAME"
        value = var.azure_openai_chat_deployment_name
      }
      env {
        name  = "AZURE_OPENAI_SUMMARY_DEPLOYMENT_NAME"
        value = var.azure_openai_summary_deployment_name
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.main.client_id
      }
      env {
        name  = "ENABLE_INSTRUMENTATION"
        value = "true"
      }

      # Fabric capacity status check (optional)
      dynamic "env" {
        for_each = var.fabric_capacity_resource_id != "" ? [1] : []
        content {
          name  = "FABRIC_CAPACITY_RESOURCE_ID"
          value = var.fabric_capacity_resource_id
        }
      }

      # Fabric Data Agent MCP — only injected when enabled
      dynamic "env" {
        for_each = var.enable_fabric_data_agent ? [1] : []
        content {
          name  = "FABRIC_DATA_AGENT_MCP_URL"
          value = var.fabric_data_agent_mcp_url
        }
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 3000
    transport        = "auto"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }
}
