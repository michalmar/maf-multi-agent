output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "acr_login_server" {
  value = azurerm_container_registry.main.login_server
}

output "acr_name" {
  value = azurerm_container_registry.main.name
}

output "container_app_name" {
  value = azurerm_container_app.main.name
}

output "container_app_fqdn" {
  value = azurerm_container_app.main.ingress[0].fqdn
}

output "managed_identity_principal_id" {
  description = "Principal ID of the managed identity — add to Fabric workspace as Admin"
  value       = azurerm_user_assigned_identity.main.principal_id
}

output "managed_identity_client_id" {
  description = "Client ID set as AZURE_CLIENT_ID in the container"
  value       = azurerm_user_assigned_identity.main.client_id
}

# ── Easy Auth outputs ─────────────────────────────────────────

output "easyauth_app_registration_id" {
  description = "App registration client ID for Easy Auth"
  value       = var.enable_easy_auth ? azuread_application.easyauth[0].client_id : ""
}

output "easyauth_token_store_account" {
  description = "Token store storage account name"
  value       = var.enable_easy_auth ? local.easyauth_storage_name : ""
}
