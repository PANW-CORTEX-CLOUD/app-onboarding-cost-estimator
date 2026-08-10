resource "null_resource" "modules_notification_dependencies" {
	depends_on = [
		azurerm_user_assigned_identity.cortex_audit_uami,
		azurerm_federated_identity_credential.cortex_audit_federated_identity,
		azurerm_storage_account.cortex_storage_account,
		azurerm_role_assignment.storage_account_role_assignment,
		null_resource.version_hash,
		azurerm_eventhub_namespace.cortex_eventhub_namespace,
		azurerm_eventhub.cortex_eventhub,
		azurerm_role_assignment.eventhub_role_assignment,
		azurerm_eventhub_namespace_authorization_rule.cortex_eventhub_namespace_authz_rule,
		azurerm_eventhub_consumer_group.cortex_consumer_group,
		azapi_resource.cortex_mg_diagnostics,
		azapi_resource.cortex_tenant_diagnostics
	]
}

locals {
	modules_notification_data = {
		audit_organization = {
			audience                                 = var.audience
			storage_account_name                     = azurerm_storage_account.cortex_storage_account.name
			tenant_id                                = var.tenant_id
			client_id                                = azurerm_user_assigned_identity.cortex_audit_uami.client_id
			namespace                                = azurerm_eventhub_namespace.cortex_eventhub_namespace.name
			eventhub_name                            = azurerm_eventhub.cortex_eventhub.name
			eventhub_resource_group_name             = azurerm_resource_group.cortex_onboarding_rg.name
			azure_audit_eventhub_consumer_group_name = azurerm_eventhub_consumer_group.cortex_consumer_group.name
			
		}
	}
}