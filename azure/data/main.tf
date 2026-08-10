##################################
# Required input variables:
#
# management_group_id  : Azure Management Group ID.
# subscription_id  : Azure Subscription ID
# resource_group_location : An Azure location to use for the obboarding resource group
##################################
variable "template_version" {
  type        = map(any)
  description = "Template version"
}

variable "connector_id" {
  type = string
}

variable "resource_group_location" {
  type        = string
  description = "Resource Group Location - Public: (australiacentral,australiacentral2,australiaeast,australiasoutheast,brazilsouth,brazilsoutheast,brazilus,canadacentral,canadaeast,centralindia,centralus,centraluseuap,eastasia,eastus,eastus2,eastus2euap,francecentral,francesouth,germanynorth,germanywestcentral,israelcentral,italynorth,japaneast,japanwest,jioindiacentral,jioindiawest,koreacentral,koreasouth,malaysiasouth,mexicocentral,newzealandnorth,northcentralus,northeurope,norwayeast,norwaywest,polandcentral,qatarcentral,southafricanorth,southafricawest,southcentralus,southeastasia,southindia,spaincentral,swedencentral,swedensouth,switzerlandnorth,switzerlandwest,uaecentral,uaenorth,uksouth,ukwest,westcentralus,westeurope,westindia,westus,westus2,westus3,australiaeastfoundational,austriaeast,chilecentral,eastusslv,indonesiacentral,israelnorthwest,malaysiawest,southcentralus2,southeastus,southeastus3,southwestus)\nGovernment: (usgovarizona,usgovtexas,usgovvirginia)"
}

variable "management_group_id" {
  type        = string
  description = "Management group that will be onboarded. Azure Portal -> Management groups -> ID"
}

variable "tenant_id" {
  type        = string
  description = "Tenant id that management group belongs to. azure portal -> tenant properties -> tenant id"
}

variable "subscription_id" {
  type        = string
  description = "Subscription id that belongs to the tenant."
}

variable "cloud_environment" {
  type        = string
  description = "Azure cloud environment (public or usgovernment)"
  default     = "public"
  validation {
    condition     = contains(["public", "usgovernment"], var.cloud_environment)
    error_message = "Cloud environment must be either 'public' or 'usgovernment'."
  }
}

variable "upload_output_url" {
  type        = string
  description = "URL to upload the TF outpost"
}

variable "outpost_client_id" {
  type        = string
  description = "client_id of outpost"
}

variable "customer_object_id" {
  type        = string
  description = "object_id of outpost application"
}

variable "tags" {
  type        = map(any)
  description = "Tags to add to resources"
}

variable "template_id" {
  type        = string
  description = "Template id"
}

variable "resource_suffix" {
  type        = string
  description = "A suffix added to resources"
}

variable "policy_template" {
  type = string
}

locals {
  suffix_split        = split("-", var.resource_suffix)
  suffix_parts        = "${local.suffix_split[0]}-${local.suffix_split[1]}"
  short_lcaas         = substr(var.resource_suffix, length(var.resource_suffix) - 5, 5)
  uniq                = substr(md5(join("", [var.subscription_id, var.management_group_id, var.tenant_id, var.resource_suffix])), 0, 10)
  ext_resource_suffix = "${local.suffix_parts}-${local.short_lcaas}-${local.uniq}"
  cortex_name         = "cortex-${local.ext_resource_suffix}"
  version_hash        = base64sha256(jsonencode(var.template_version))
}

data "azurerm_subscription" "current" {
  subscription_id = var.subscription_id
}

data "azurerm_management_group" "az_management_group" {
  name = var.management_group_id
}

data "azuread_service_principal" "outpost_application" {
  object_id = var.customer_object_id
}


#############################
# Initializing the provider #
#############################
terraform {
  required_providers {
    azuread = {
      source  = "hashicorp/azuread"
      version = "3.6.0"
    }
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "4.52.0"
    }
    azapi = {
      source  = "Azure/azapi"
      version = "2.7.0"
    }
    terracurl = {
      source  = "devops-rob/terracurl"
      version = "2.1.0"
    }
  }
  required_version = "~> 1"
}

provider "azuread" {
  tenant_id   = var.tenant_id
  environment = var.cloud_environment
}

provider "azurerm" {
  tenant_id       = var.tenant_id
  subscription_id = var.subscription_id
  environment     = var.cloud_environment
  features {
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
}

provider "azapi" {
  tenant_id   = var.tenant_id
  environment = var.cloud_environment
}

#################################
# Granting GraphAPI permissions #
#################################
data "azuread_application_published_app_ids" "well_known" {}
resource "azuread_service_principal" "microsoft_graph" {
  client_id    = data.azuread_application_published_app_ids.well_known.result.MicrosoftGraph
  use_existing = true
}

locals {
  _graphAPIRoles_json = jsondecode(file("./graphAPIRoles.json"))
  graphAPIPermissions = concat(
    local._graphAPIRoles_json.common_roles,
    var.cloud_environment == "public" ? local._graphAPIRoles_json.public_only_roles : []
  ) # Version 1.3.0
}
resource "azuread_app_role_assignment" "org_graph_permissions" {
  for_each            = toset(local.graphAPIPermissions)
  principal_object_id = data.azuread_service_principal.outpost_application.object_id
  resource_object_id  = azuread_service_principal.microsoft_graph.object_id
  app_role_id         = each.value
}

#############################
# Creating Cortex Resources #
#############################
resource "azurerm_resource_group" "cortex_onboarding_rg" {
  name     = "cortex-onboarding-${var.resource_suffix}"
  location = var.resource_group_location
  tags     = var.tags
}

resource "azurerm_role_definition" "cortex_mi_role" {
  name        = "cortex-mi-role-${var.resource_suffix}"
  scope       = data.azurerm_subscription.current.id
  description = "Custom role for Managed Identity (${var.resource_suffix})"

  permissions {
    actions = [
      "Microsoft.Resources/deployments/read",
      "Microsoft.Resources/deployments/write",
      "Microsoft.Resources/deployments/operationStatuses/read",
      "Microsoft.Resources/deployments/operations/read",
      "Microsoft.Resources/deployments/validate/action",
      "Microsoft.Resources/deployments/cancel/action",
      "Microsoft.Resources/subscriptions/resourceGroups/read",
      "Microsoft.Resources/subscriptions/resourceGroups/write",
      "Microsoft.Resources/subscriptions/resourceGroups/resources/read",
      "Microsoft.Resources/subscriptions/resourceGroups/validateMoveResources/action",
      "Microsoft.Resources/subscriptions/resourceGroups/moveResources/action",
      "Microsoft.Resources/subscriptions/read",
      "Microsoft.Authorization/roleDefinitions/read",
      "Microsoft.Authorization/roleDefinitions/write",
      "Microsoft.Authorization/roleDefinitions/delete",
      "Microsoft.Authorization/roleAssignments/read",
      "Microsoft.Authorization/roleAssignments/write",
      "Microsoft.Authorization/roleAssignments/delete",
      "Microsoft.Authorization/policyDefinitions/read",
      "Microsoft.Authorization/policyDefinitions/write",
      "Microsoft.Authorization/policyDefinitions/delete",
      "Microsoft.Authorization/policyAssignments/read",
      "Microsoft.Authorization/policyAssignments/write",
      "Microsoft.Authorization/policyAssignments/delete",
      "Microsoft.Compute/galleries/read",
      "Microsoft.Compute/galleries/write",
      "Microsoft.Compute/galleries/delete"
    ]
  }

  assignable_scopes = [
    data.azurerm_subscription.current.id,
    data.azurerm_management_group.az_management_group.id
  ]
}

resource "azurerm_user_assigned_identity" "cortex_mi" {
  name                = "cortex-mi-${var.resource_suffix}"
  resource_group_name = azurerm_resource_group.cortex_onboarding_rg.name
  location            = var.resource_group_location
  tags                = var.tags
}

resource "azurerm_role_assignment" "cortex_mi_assignment" {
  scope                            = data.azurerm_management_group.az_management_group.id
  principal_id                     = azurerm_user_assigned_identity.cortex_mi.principal_id
  skip_service_principal_aad_check = true
  role_definition_id               = "/providers/Microsoft.Authorization/roleDefinitions/${azurerm_role_definition.cortex_mi_role.role_definition_id}"
}

resource "azurerm_role_definition" "cortex_platform_reader_role" {
  name        = "cortex-reader-${local.ext_resource_suffix}"
  scope       = data.azurerm_management_group.az_management_group.id
  description = "Cortex Cloud reader role ${local.ext_resource_suffix}"

  permissions {
    actions = ["*/read"]
  }

  assignable_scopes = [
    data.azurerm_management_group.az_management_group.id
  ]
}

locals {
  # Load permissions from external JSON file and compute based on cloud environment
  _permissions_json = jsondecode(file("./custom_actions_permissions.json"))

  # Final computed permissions based on cloud environment
  # - Public: includes both common_permissions and public_only_permissions
  # - Government: includes only common_permissions
  custom_actions_permissions = var.cloud_environment == "public" ? concat(
    local._permissions_json.common_permissions,
    local._permissions_json.public_only_permissions
  ) : local._permissions_json.common_permissions
}

resource "azurerm_role_definition" "cortex_platform_actions_role" {
  name        = "cortex-actions-${local.ext_resource_suffix}"
  scope       = data.azurerm_management_group.az_management_group.id
  description = "Cortex Cloud actions role ${local.ext_resource_suffix}"
  permissions {
    actions     = local.custom_actions_permissions
    not_actions = []
  }
  assignable_scopes = [
    data.azurerm_management_group.az_management_group.id
  ]
}

resource "azurerm_role_assignment" "assign_reader_role" {
  scope                            = data.azurerm_management_group.az_management_group.id
  principal_id                     = data.azuread_service_principal.outpost_application.object_id
  skip_service_principal_aad_check = true
  role_definition_id               = azurerm_role_definition.cortex_platform_reader_role.role_definition_resource_id
}

resource "azurerm_role_assignment" "assign_action_role" {
  scope                            = data.azurerm_management_group.az_management_group.id
  principal_id                     = data.azuread_service_principal.outpost_application.object_id
  skip_service_principal_aad_check = true
  role_definition_id               = azurerm_role_definition.cortex_platform_actions_role.role_definition_resource_id
}

locals {
  policy_params = jsonencode({
    extResourceSuffix : { value : "[format('{0}-{1}', '${local.ext_resource_suffix}', take(subscription().subscriptionId, 8))]" }
    versionHash : { value : local.version_hash }
    cortexName : { value : local.cortex_name }
    resourceGroupLocation : { value : var.resource_group_location }
  })
  policy_rule = templatefile("./policy_template.json.tftmpl", { # Version 1.2.4
    cortex_name             = local.cortex_name
    role_definition_id      = azurerm_role_definition.cortex_mi_role.role_definition_resource_id
    resource_group_location = var.resource_group_location
    policy_template         = var.policy_template
    policy_params           = local.policy_params
    version_hash            = local.version_hash
  })
}

resource "azurerm_policy_definition" "cortex_policy" {
  name                = "cortex-${local.ext_resource_suffix}"
  policy_type         = "Custom"
  mode                = "All"
  display_name        = "cortex-${local.ext_resource_suffix}"
  management_group_id = data.azurerm_management_group.az_management_group.id
  policy_rule         = local.policy_rule
}

resource "azurerm_management_group_policy_assignment" "cortex_policy" {
  management_group_id  = data.azurerm_management_group.az_management_group.id
  name                 = local.ext_resource_suffix
  policy_definition_id = azurerm_policy_definition.cortex_policy.id
  display_name         = "Cortex Policy cortex-${local.ext_resource_suffix}"
  location             = var.resource_group_location
  identity {
    type         = "UserAssigned"
    identity_ids = toset([azurerm_user_assigned_identity.cortex_mi.id])
  }
  resource_selectors {
    name = "Only Subscriptions"
    selectors {
      in   = ["Microsoft.Resources/subscriptions"]
      kind = "resourceType"
    }
  }
}

resource "azurerm_role_definition" "cortex_policy_role" {
  name        = "cortex-policy-${var.resource_suffix}"
  scope       = data.azurerm_management_group.az_management_group.id
  description = "Used by cortex policy (${var.resource_suffix})"
  permissions {
    actions = [
      "Microsoft.PolicyInsights/remediations/read",
      "Microsoft.PolicyInsights/remediations/write"
    ]
  }
  assignable_scopes = [data.azurerm_management_group.az_management_group.id]
}

resource "azurerm_role_assignment" "cortex_policy" {
  scope                            = data.azurerm_management_group.az_management_group.id
  principal_id                     = data.azuread_service_principal.outpost_application.object_id
  skip_service_principal_aad_check = true
  role_definition_id               = azurerm_role_definition.cortex_policy_role.role_definition_resource_id
}

locals {
  template_id      = var.template_id
  notification_url = var.upload_output_url
  version          = var.template_version
  connector_id     = var.connector_id
  resources_data = merge({
    client_id = var.outpost_client_id,
    # Important Note:
    # When using the "azurerm_role_definition.cortex_policy_role" and it's "...remediations/write" permissions,
    # only the specific policy and assignment created in these templates will be used. 
    # This is why the policy assignment id is being saved.
    policy_assignment_id    = azurerm_management_group_policy_assignment.cortex_policy.id,
    resource_group_name     = local.cortex_name,
    resource_group_location = var.resource_group_location,
  }, local.modules_notification_data)
  _http_status_codes = {
    ok       = 200
    accepted = 202
  }
  http_timeout_seconds = 30 # Arbitrary
  _notification_request_raw_payload = {
    operation           = "create_connector"
    template_id         = local.template_id
    template_version    = local.version
    connector_id        = local.connector_id
    provisioning_method = "TF"
    account_id          = data.azurerm_subscription.current.subscription_id
    account_name        = ""
    account_group       = var.management_group_id
    organization_id     = var.tenant_id
    credentials = {
      client_id = var.outpost_client_id
      tenant_id = var.tenant_id
    }
    resources_data = local.resources_data

  }
}

resource "terracurl_request" "create_connector_notification" {
  depends_on = [
    azurerm_management_group_policy_assignment.cortex_policy,
    null_resource.modules_notification_dependencies
  ]

  name           = "create_connector_notification"
  response_codes = [local._http_status_codes.ok, local._http_status_codes.accepted]
  method         = "PUT"
  url            = local.notification_url
  headers = {
    "Content-Type" = "application/json"
  }
  timeout      = local.http_timeout_seconds
  max_retry    = 3
  request_body = jsonencode(local._notification_request_raw_payload)

  skip_destroy = true
}

output "tenant_id" { value = var.tenant_id }
output "subscription_id" { value = data.azurerm_subscription.current.display_name }
output "management_group" { value = var.management_group_id }
output "resources_data" {
  value     = local.resources_data
  sensitive = false
}
output "client_id" { value = var.outpost_client_id }
output "connector_id" { value = var.connector_id }
output "ext_resource_suffix" { value = local.ext_resource_suffix }
