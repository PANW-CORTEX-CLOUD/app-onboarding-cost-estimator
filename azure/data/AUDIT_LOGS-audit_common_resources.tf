variable "audit_storage_allowed_ips" {
	type = string
	description = "Collections IPs to connect to Audit Storage Account"
}
variable "collector_sa_unique_id" {
	type = string
	description = "Unique ID of the service account used by Azure Eventhub collector"
}
variable "audience" {
	type = string
	description = "Audience for federated principal"
}


locals {
  allowed_ips = split(",", var.audit_storage_allowed_ips)
}

resource "azurerm_user_assigned_identity" "cortex_audit_uami" {
  location            = var.resource_group_location
  name                = "cortexAuditUAMI-${local.ext_resource_suffix}"
  resource_group_name = azurerm_resource_group.cortex_onboarding_rg.name
  tags                = var.tags
}

resource "azurerm_federated_identity_credential" "cortex_audit_federated_identity" {
  name                = "${azurerm_user_assigned_identity.cortex_audit_uami.name}-cortexAuditFederatedIdentity-${local.ext_resource_suffix}"
  resource_group_name = azurerm_resource_group.cortex_onboarding_rg.name
  audience            = [var.audience]
  issuer              = "https://accounts.google.com"
  parent_id           = azurerm_user_assigned_identity.cortex_audit_uami.id
  subject             = var.collector_sa_unique_id
}

data "azurerm_role_definition" "storage_blob_data_contributor" {
  name = "Storage Blob Data Contributor"
}

resource "azurerm_storage_account" "cortex_storage_account" {
  name                = "cxa${replace(local.ext_resource_suffix, "-", "")}"
  resource_group_name = azurerm_resource_group.cortex_onboarding_rg.name

  location                         = var.resource_group_location
  cross_tenant_replication_enabled = false
  https_traffic_only_enabled       = true
  public_network_access_enabled    = true
  account_tier                     = "Standard"
  account_replication_type         = "LRS"
  min_tls_version                  = "TLS1_2"

  network_rules {
    default_action = "Deny"
    ip_rules       = split(",", var.audit_storage_allowed_ips)
  }

  identity {
    type = "SystemAssigned"
  }

  tags = var.tags
}

resource "azurerm_role_assignment" "storage_account_role_assignment" {
  scope              = azurerm_storage_account.cortex_storage_account.id
  principal_id       = azurerm_user_assigned_identity.cortex_audit_uami.principal_id
  role_definition_id = "${data.azurerm_subscription.current.id}${data.azurerm_role_definition.storage_blob_data_contributor.id}"
}


