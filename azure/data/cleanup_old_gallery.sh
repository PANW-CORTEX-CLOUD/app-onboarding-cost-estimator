#!/bin/bash
# Cleanup old gallery resources from previous locations.
# Source this file and call cleanup_old_gallery() with the known ext_suffix:
#
#   source cleanup_old_gallery.sh
#   cleanup_old_gallery <mgmt_group> <ext_suffix> <host_sub_id> <location>
#
# The caller is responsible for resolving ext_suffix before calling this function.
# - ARM flow (onboard.sh): derive ext_suffix from Container Instance name
# - TF flow (null_resource): ext_suffix is known directly as local.ext_resource_suffix

#=================================================================#
# Cleanup old gallery resources                                    #
#                                                                 #
# Args:                                                           #
#   $1  mgmt_group    Management group ID (or tenant ID)          #
#   $2  ext_suffix    Extended resource suffix (already resolved) #
#   $3  host_sub_id   Host subscription ID to restore context to  #
#   $4  location      New resource group location                 #
#=================================================================#
cleanup_old_gallery() {
    local mgmt_group="$1"
    local ext_suffix="$2"
    local host_sub_id="$3"
    local location="$4"

    # Early exit if location is eastus — galleries are already in the right place
    if [[ "$(echo "$location" | tr '[:upper:]' '[:lower:]')" == "eastus" ]]; then
        log INFO "Resource group location is eastus — no old galleries to clean up."
        return 0
    fi

    log INFO "Starting old gallery cleanup (ext_suffix: ${ext_suffix})"

    # Enumerate subscriptions under the management group.
    # If the management group ID equals the tenant ID, list all tenant subscriptions.
    local local_tenant_id
    local_tenant_id=$(az account show --query tenantId --output tsv 2>/dev/null) || true

    if [[ -z "$local_tenant_id" ]]; then
        log ERROR "Failed to retrieve tenant ID from current Azure CLI context."
        return 1
    fi

    local subscriptions
    if [[ "$local_tenant_id" == "$mgmt_group" ]]; then
        log INFO "Management group matches tenant ID — listing all tenant subscriptions."
        subscriptions=$(az account list --query "[?tenantId=='${local_tenant_id}'].id" -o tsv 2>/dev/null) || true
    else
        log INFO "Listing subscriptions under management group: ${mgmt_group}"
        subscriptions=$(az account management-group subscription show-sub-under-mg \
            --name "$mgmt_group" \
            --query "[].name" -o tsv 2>/dev/null) || true
    fi

    if [[ -z "$subscriptions" ]]; then
        log INFO "No subscriptions found under management group ${mgmt_group}. Nothing to clean up."
        az account set --subscription "$host_sub_id" 2>/dev/null || true
        return 0
    fi

    local cleanup_count=0

    while IFS= read -r sub_id; do
        # sub_id may be a full resource ID (/subscriptions/<guid>) or just a GUID
        local sub_guid
        sub_guid=$(echo "$sub_id" | awk -F'/' '{print $NF}')

        log INFO "Processing subscription: ${sub_guid}"

        if ! az account set --subscription "$sub_guid" 2>/dev/null; then
            log WARN "Could not switch to subscription ${sub_guid} — skipping."
            continue
        fi

        local active_sub
        active_sub=$(az account show --query id -o tsv 2>/dev/null) || active_sub="unknown"
        log INFO "Active subscription after switch: ${active_sub}"

        # The RG is named: cortex-{ext_suffix} (shared across all subscriptions in the MG)
        local rg_name="cortex-${ext_suffix}"

        log INFO "Checking resource group: ${rg_name}"

        local rg_exists
        rg_exists=$(az group show --name "$rg_name" --query "name" -o tsv 2>/dev/null) && rg_exists="true" || rg_exists="false"

        log INFO "Resource group ${rg_name} exists: ${rg_exists}"

        if [[ "$rg_exists" != "true" ]]; then
            log INFO "Listing all cortex RGs in sub ${sub_guid} for diagnosis:"
            az group list --query "[?starts_with(name, 'cortex')].name" -o tsv 2>/dev/null || true
            continue
        fi

        log INFO "Checking subscription ${sub_guid} / resource group ${rg_name} for old eastus galleries..."

        local galleries
        galleries=$(az sig list \
            --resource-group "$rg_name" \
            --query "[?starts_with(name, 'cortex') && location == 'eastus'].name" \
            -o tsv 2>/dev/null) || galleries=""

        if [[ -z "$galleries" ]]; then
            continue
        fi

        while IFS= read -r gallery_name; do
            log INFO "Cleaning up gallery '${gallery_name}' in ${rg_name} (sub: ${sub_guid})"

            local image_defs
            image_defs=$(az sig image-definition list \
                --resource-group "$rg_name" \
                --gallery-name "$gallery_name" \
                --query "[].name" -o tsv 2>/dev/null) || image_defs=""

            if [[ -n "$image_defs" ]]; then
                while IFS= read -r image_def; do
                    local versions
                    versions=$(az sig image-version list \
                        --resource-group "$rg_name" \
                        --gallery-name "$gallery_name" \
                        --gallery-image-definition "$image_def" \
                        --query "[].name" -o tsv 2>/dev/null) || versions=""

                    if [[ -n "$versions" ]]; then
                        while IFS= read -r version; do
                            log INFO "  Deleting image version ${version} (image-def: ${image_def})"
                            az sig image-version delete \
                                --resource-group "$rg_name" \
                                --gallery-name "$gallery_name" \
                                --gallery-image-definition "$image_def" \
                                --gallery-image-version "$version" \
                                2>/dev/null || true
                        done <<< "$versions"
                    fi

                    log INFO "  Deleting image definition ${image_def}"
                    az sig image-definition delete \
                        --resource-group "$rg_name" \
                        --gallery-name "$gallery_name" \
                        --gallery-image-definition "$image_def" \
                        2>/dev/null || true
                done <<< "$image_defs"
            fi

            log INFO "  Deleting gallery ${gallery_name}"
            az sig delete \
                --resource-group "$rg_name" \
                --gallery-name "$gallery_name" \
                --no-wait 2>/dev/null || true

            cleanup_count=$((cleanup_count + 1))
        done <<< "$galleries"
    done <<< "$subscriptions"

    # Restore context to the host subscription
    az account set --subscription "$host_sub_id" 2>/dev/null || true

    if [[ $cleanup_count -gt 0 ]]; then
        log INFO "Gallery cleanup complete. Removed ${cleanup_count} old gallery(ies) from eastus."
        sleep 30
    else
        log INFO "No old eastus gallery resources found. Nothing to clean up."
    fi

    return 0
}
