#!/usr/bin/env bash
# Provider-neutral operations for off-host database backups. Source this after
# loading .env.production; callers own logging and error handling.

backup_storage_init() {
  BACKUP_PREFIX="${BACKUP_PREFIX:-db}"
  local configured="${BACKUP_PROVIDER:-}"
  local has_s3=0 has_azure=0
  [ -n "${BACKUP_BUCKET:-}" ] && has_s3=1
  [ -n "${BACKUP_AZURE_CONTAINER:-}" ] && has_azure=1

  if [ -z "$configured" ]; then
    if [ "$has_s3" -eq 1 ] && [ "$has_azure" -eq 0 ]; then configured=s3
    elif [ "$has_s3" -eq 0 ] && [ "$has_azure" -eq 1 ]; then configured=azure
    else
      echo "Set BACKUP_PROVIDER=s3 or azure (or configure exactly one backup target)" >&2
      return 1
    fi
  fi

  case "$configured" in
    s3)
      : "${BACKUP_BUCKET:?BACKUP_BUCKET must be set for S3 backups}"
      command -v aws >/dev/null 2>&1 || { echo "aws CLI is required for S3 backups" >&2; return 1; }
      BACKUP_PROVIDER=s3
      AWS_ARGS=()
      [ -n "${AWS_ENDPOINT_URL:-}" ] && AWS_ARGS+=(--endpoint-url "${AWS_ENDPOINT_URL}")
      ;;
    azure)
      : "${BACKUP_AZURE_CONTAINER:?BACKUP_AZURE_CONTAINER must be set for Azure Blob backups}"
      command -v az >/dev/null 2>&1 || { echo "Azure CLI (az) is required for Azure Blob backups" >&2; return 1; }
      if [ -z "${BACKUP_AZURE_CONNECTION_STRING:-${AZURE_STORAGE_CONNECTION_STRING:-}}" ] && [ -z "${BACKUP_AZURE_ACCOUNT:-${AZURE_STORAGE_ACCOUNT:-}}" ]; then
        echo "Set BACKUP_AZURE_CONNECTION_STRING or BACKUP_AZURE_ACCOUNT for Azure Blob backups" >&2
        return 1
      fi
      BACKUP_PROVIDER=azure
      AZURE_ARGS=()
      if [ -n "${BACKUP_AZURE_CONNECTION_STRING:-${AZURE_STORAGE_CONNECTION_STRING:-}}" ]; then
        AZURE_ARGS+=(--connection-string "${BACKUP_AZURE_CONNECTION_STRING:-${AZURE_STORAGE_CONNECTION_STRING}}")
      else
        # Managed identity / az login. The identity needs Storage Blob Data
        # Contributor on the dedicated backup container.
        AZURE_ARGS+=(--account-name "${BACKUP_AZURE_ACCOUNT:-${AZURE_STORAGE_ACCOUNT}}" --auth-mode login)
      fi
      ;;
    *) echo "Unsupported BACKUP_PROVIDER: $configured (use s3 or azure)" >&2; return 1 ;;
  esac
}

backup_storage_upload() {
  local file="$1" name="$2"
  if [ "$BACKUP_PROVIDER" = s3 ]; then
    aws "${AWS_ARGS[@]}" s3 cp "$file" "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${name}" --only-show-errors
  else
    az storage blob upload --container-name "$BACKUP_AZURE_CONTAINER" --name "${BACKUP_PREFIX}/${name}" --file "$file" --overwrite true --only-show-errors "${AZURE_ARGS[@]}"
  fi
}

backup_storage_list() {
  if [ "$BACKUP_PROVIDER" = s3 ]; then
    aws "${AWS_ARGS[@]}" s3 ls "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/" | awk '{print $4}'
  else
    az storage blob list --container-name "$BACKUP_AZURE_CONTAINER" --prefix "${BACKUP_PREFIX}/" --query '[].name' -o tsv --only-show-errors "${AZURE_ARGS[@]}" | sed "s#^${BACKUP_PREFIX}/##"
  fi
}

backup_storage_download() {
  local name="$1" destination="$2"
  if [ "$BACKUP_PROVIDER" = s3 ]; then
    aws "${AWS_ARGS[@]}" s3 cp "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${name}" "$destination" --only-show-errors
  else
    az storage blob download --container-name "$BACKUP_AZURE_CONTAINER" --name "${BACKUP_PREFIX}/${name}" --file "$destination" --overwrite true --only-show-errors "${AZURE_ARGS[@]}"
  fi
}

backup_storage_delete() {
  local name="$1"
  if [ "$BACKUP_PROVIDER" = s3 ]; then
    aws "${AWS_ARGS[@]}" s3 rm "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${name}" --only-show-errors
  else
    az storage blob delete --container-name "$BACKUP_AZURE_CONTAINER" --name "${BACKUP_PREFIX}/${name}" --only-show-errors "${AZURE_ARGS[@]}"
  fi
}

backup_storage_label() {
  if [ "$BACKUP_PROVIDER" = s3 ]; then printf 's3://%s/%s' "$BACKUP_BUCKET" "$BACKUP_PREFIX"; else printf 'azure://%s/%s' "$BACKUP_AZURE_CONTAINER" "$BACKUP_PREFIX"; fi
}
