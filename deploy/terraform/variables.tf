variable "subscription_id" {
  description = "Azure subscription ID"
  type        = string
}

variable "resource_group_name" {
  description = "Name of the resource group to create"
  type        = string
  default     = "rg-maf-demo"
}

variable "location" {
  description = "Azure region"
  type        = string
  default     = "eastus"
}

variable "acr_name" {
  description = "Azure Container Registry name (must be globally unique, alphanumeric only)"
  type        = string
}

variable "app_name" {
  description = "Container App name"
  type        = string
  default     = "maf-multi-agent"
}

# ── AI service configuration ──────────────────────────────────

variable "project_endpoint" {
  description = "Azure AI Foundry project endpoint URL"
  type        = string
}

variable "azure_openai_chat_deployment_name" {
  description = "Azure OpenAI deployment name for the orchestrator"
  type        = string
  default     = "gpt-5.2"
}

variable "azure_openai_summary_deployment_name" {
  description = "Azure OpenAI deployment name for event summaries"
  type        = string
  default     = "gpt-4.1-nano"
}

variable "ai_services_resource_id" {
  description = "Full resource ID of the Azure AI Services resource (for RBAC). Leave empty to skip."
  type        = string
  default     = ""
}

# ── Fabric Data Agent ─────────────────────────────────────────

variable "enable_fabric_data_agent" {
  description = "Enable Fabric Data Agent MCP integration. Injects MCP URL env var into the Container App."
  type        = bool
  default     = false
}

variable "fabric_data_agent_mcp_url" {
  description = "Fabric Data Agent MCP endpoint URL (required when enable_fabric_data_agent = true)"
  type        = string
  default     = ""
}

variable "fabric_capacity_resource_id" {
  description = "Full ARM resource ID of the Fabric capacity (for status checks). Leave empty to disable."
  type        = string
  default     = ""
}

# ── Easy Auth (ACA Entra ID login) ────────────────────────────
# Gates the entire app behind Entra ID login and provides user tokens
# for Fabric Data Agent (which requires user identity for data queries).

variable "enable_easy_auth" {
  description = "Enable ACA Easy Auth with Entra ID. Creates app registration, token store, and auth config. Required for Fabric Data Agent in production."
  type        = bool
  default     = false
}

variable "easyauth_storage_account_name" {
  description = "Storage account name for Easy Auth token store (globally unique, alphanumeric, 3-24 chars). Auto-generated from app_name if empty."
  type        = string
  default     = ""
}

# ── Email notifications ───────────────────────────────────────

variable "mail_sender_address" {
  description = "Admin mailbox for sending email notifications via Graph API. Leave empty to disable. Requires Mail.Send app permission on the managed identity."
  type        = string
  default     = ""
}
