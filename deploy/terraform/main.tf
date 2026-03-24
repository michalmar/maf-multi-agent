terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
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

# ── Fabric Data Agent — Service Principal ─────────────────────
# Creates an Entra ID app registration + SP with Power BI API
# permissions required by Fabric Data Agent MCP.
#
# Post-apply manual steps:
#   1. Grant admin consent: Azure Portal → Entra ID → App registrations
#      → <app> → API permissions → Grant admin consent
#   2. Add SP to Fabric workspace: Fabric Portal → Workspace settings
#      → Manage access → Add the SP as Member or Contributor

data "azuread_client_config" "current" {
  count = var.enable_fabric_data_agent ? 1 : 0
}

# Look up Power BI Service to resolve delegated permission IDs dynamically
data "azuread_service_principal" "power_bi" {
  count     = var.enable_fabric_data_agent ? 1 : 0
  client_id = "00000009-0000-0000-c000-000000000000" # Power BI Service
}

resource "azuread_application" "fabric_data_agent" {
  count        = var.enable_fabric_data_agent ? 1 : 0
  display_name = "${var.app_name}-fabric-data-agent"
  owners       = [data.azuread_client_config.current[0].object_id]

  required_resource_access {
    resource_app_id = "00000009-0000-0000-c000-000000000000" # Power BI Service

    dynamic "resource_access" {
      for_each = toset([
        "Workspace.ReadWrite.All",
        "Item.ReadWrite.All",
        "Dataset.ReadWrite.All",
        "DataAgent.Read.All",
        "DataAgent.Execute.All",
      ])
      content {
        id   = data.azuread_service_principal.power_bi[0].oauth2_permission_scope_ids[resource_access.value]
        type = "Scope" # Delegated
      }
    }
  }
}

resource "azuread_service_principal" "fabric_data_agent" {
  count     = var.enable_fabric_data_agent ? 1 : 0
  client_id = azuread_application.fabric_data_agent[0].client_id
  owners    = [data.azuread_client_config.current[0].object_id]
}

resource "azuread_application_password" "fabric_data_agent" {
  count          = var.enable_fabric_data_agent ? 1 : 0
  application_id = azuread_application.fabric_data_agent[0].id
  display_name   = "fabric-mcp-secret"

  rotate_when_changed = {
    rotation = "1"
  }
}

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

  # Fabric SP client secret (stored encrypted by Container Apps)
  dynamic "secret" {
    for_each = var.enable_fabric_data_agent ? [1] : []
    content {
      name  = "fabric-sp-client-secret"
      value = azuread_application_password.fabric_data_agent[0].value
    }
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
      dynamic "env" {
        for_each = var.enable_fabric_data_agent ? [1] : []
        content {
          name  = "FABRIC_SP_TENANT_ID"
          value = data.azuread_client_config.current[0].tenant_id
        }
      }
      dynamic "env" {
        for_each = var.enable_fabric_data_agent ? [1] : []
        content {
          name  = "FABRIC_SP_CLIENT_ID"
          value = azuread_application.fabric_data_agent[0].client_id
        }
      }
      dynamic "env" {
        for_each = var.enable_fabric_data_agent ? [1] : []
        content {
          name        = "FABRIC_SP_CLIENT_SECRET"
          secret_name = "fabric-sp-client-secret"
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
