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

output "app_users_group_id" {
  description = "Object ID of the App-Users security group — members can log in"
  value       = var.enable_easy_auth ? azuread_group.app_users[0].object_id : ""
}

output "app_users_group_name" {
  description = "Display name of the App-Users security group"
  value       = var.enable_easy_auth ? azuread_group.app_users[0].display_name : ""
}

output "data_users_group_id" {
  description = "Object ID of the Data-Users security group — members get Fabric data access"
  value       = var.enable_easy_auth ? azuread_group.data_users[0].object_id : ""
}

output "data_users_group_name" {
  description = "Display name of the Data-Users security group"
  value       = var.enable_easy_auth ? azuread_group.data_users[0].display_name : ""
}

# ── VNet outputs ──────────────────────────────────────────────

output "vnet_id" {
  description = "VNet resource ID (empty when VNet is disabled)"
  value       = var.enable_vnet ? azurerm_virtual_network.main[0].id : ""
}

output "aca_subnet_id" {
  description = "ACA infrastructure subnet ID"
  value       = var.enable_vnet ? azurerm_subnet.aca_infra[0].id : ""
}

output "pe_subnet_id" {
  description = "Private endpoints subnet ID"
  value       = var.enable_vnet ? azurerm_subnet.private_endpoints[0].id : ""
}

output "tokenstore_private_endpoint_ip" {
  description = "Private IP of the token store private endpoint"
  value       = var.enable_vnet && var.enable_easy_auth ? azurerm_private_endpoint.tokenstore[0].private_service_connection[0].private_ip_address : ""
}
