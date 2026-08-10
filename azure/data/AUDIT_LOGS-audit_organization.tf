resource "null_resource" "version_hash" {
  triggers = {
    version = local.version_hash
  }
}

data "azapi_resource_list" "check_insights_limits" {
  type      = "Microsoft.Insights/diagnosticSettings@2021-05-01-preview"
  parent_id = data.azurerm_management_group.az_management_group.id
}

data "azurerm_role_definition" "eventhub_data_receiver" {
  name = "Azure Event Hubs Data Receiver"
}

resource "azurerm_eventhub_namespace" "cortex_eventhub_namespace" {
  name                     = "CortexEventHubNamespace-${local.ext_resource_suffix}"
  location                 = var.resource_group_location
  resource_group_name      = azurerm_resource_group.cortex_onboarding_rg.name
  sku                      = "Standard"
  capacity                 = 1
  tags                     = var.tags
  auto_inflate_enabled     = true
  maximum_throughput_units = 20

  network_rulesets {
    default_action = "Deny"
    ip_rule {
      ip_mask = local.allowed_ips[0]
    }
    ip_rule {
      ip_mask = local.allowed_ips[1]
    }
    trusted_service_access_enabled = true
  }
}

resource "azurerm_eventhub" "cortex_eventhub" {
  name              = "CortexEventHub-${local.ext_resource_suffix}"
  namespace_id      = azurerm_eventhub_namespace.cortex_eventhub_namespace.id
  partition_count   = 20
  message_retention = 7
}

resource "azurerm_role_assignment" "eventhub_role_assignment" {
  scope              = azurerm_eventhub_namespace.cortex_eventhub_namespace.id
  principal_id       = azurerm_user_assigned_identity.cortex_audit_uami.principal_id
  role_definition_id = "${data.azurerm_subscription.current.id}${data.azurerm_role_definition.eventhub_data_receiver.id}"
}

resource "azurerm_eventhub_namespace_authorization_rule" "cortex_eventhub_namespace_authz_rule" {
  name                = "CortexEventHubNamespaceAuthzRule-${local.ext_resource_suffix}"
  namespace_name      = azurerm_eventhub_namespace.cortex_eventhub_namespace.name
  resource_group_name = azurerm_resource_group.cortex_onboarding_rg.name
  listen              = true
  send                = true
}

resource "azurerm_eventhub_consumer_group" "cortex_consumer_group" {
  name                = "CortexEventhubConsumerGroup-${local.ext_resource_suffix}"
  namespace_name      = azurerm_eventhub_namespace.cortex_eventhub_namespace.name
  eventhub_name       = azurerm_eventhub.cortex_eventhub.name
  resource_group_name = azurerm_resource_group.cortex_onboarding_rg.name
}

# Management Group-level diagnostic setting — routes Activity Logs from all child subscriptions into EventHub
resource "azapi_resource" "cortex_mg_diagnostics" {
  type      = "Microsoft.Insights/diagnosticSettings@2021-05-01-preview"
  parent_id = data.azurerm_management_group.az_management_group.id
  name      = "CortexMonitorDiagnosticSettings-${local.ext_resource_suffix}"
  body = {
    properties = {
      eventHubAuthorizationRuleId = azurerm_eventhub_namespace_authorization_rule.cortex_eventhub_namespace_authz_rule.id
      eventHubName                = azurerm_eventhub.cortex_eventhub.name
      logs = [
        {
          categoryGroup = null
          category      = "Administrative"
          enabled       = true
        }
      ]
    }
  }
  lifecycle {
    precondition {
      condition     = length(data.azapi_resource_list.check_insights_limits.output.value) < 5
      error_message = "The ${data.azurerm_management_group.az_management_group.display_name} management group already has 5 diagnostic settings. Azure limits this to 5 per management group scope. Please delete one before retrying."
    }
    ignore_changes = [
      body
    ]
    replace_triggered_by = [
      null_resource.version_hash
    ]
  }
}

# ORGANIZATION-specific: Tenant-level diagnostic setting — routes AAD/Entra ID logs into EventHub
locals {
  diagnostic_log_categories = [
    "SignInLogs",
    "AuditLogs",
    "NonInteractiveUserSignInLogs",
    "ServicePrincipalSignInLogs",
    "ManagedIdentitySignInLogs",
    "ProvisioningLogs",
    "ADFSSignInLogs",
    "MicrosoftGraphActivityLogs"
  ]
}

resource "azapi_resource" "cortex_tenant_diagnostics" {
  type      = "microsoft.aadiam/diagnosticSettings@2017-04-01"
  parent_id = "/"
  name      = "CortexMonitorAadDiagnosticSettings-${local.ext_resource_suffix}"
  body = {
    properties = {
      eventHubAuthorizationRuleId = azurerm_eventhub_namespace_authorization_rule.cortex_eventhub_namespace_authz_rule.id
      eventHubName                = azurerm_eventhub.cortex_eventhub.name
      logs = [
        for category in local.diagnostic_log_categories : {
          category        = category
          enabled         = true
          retentionPolicy = { enabled = true, days = 0 }
        }
      ]
    }
  }
  lifecycle {
    ignore_changes = [
      body
    ]
    replace_triggered_by = [
      null_resource.version_hash
    ]
  }
}


