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
  description = "Principal ID of the managed identity — use for additional RBAC assignments"
  value       = azurerm_user_assigned_identity.main.principal_id
}

output "managed_identity_client_id" {
  description = "Client ID set as AZURE_CLIENT_ID in the container"
  value       = azurerm_user_assigned_identity.main.client_id
}

# ── Fabric Data Agent outputs ─────────────────────────────────

output "fabric_managed_identity_principal_id" {
  description = "Principal ID to add to the Fabric workspace for MCP access"
  value       = azurerm_user_assigned_identity.main.principal_id
}
