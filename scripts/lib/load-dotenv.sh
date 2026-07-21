#!/usr/bin/env bash
# Load dotenv assignments without evaluating them as shell code. Production
# display names, URLs, and secrets may legally contain shell metacharacters.

load_dotenv_file() {
  local file="$1" line key value first last
  [ -f "$file" ] || return 0

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|'#'*) continue ;; esac

    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue

    # Docker Compose accepts quoted dotenv values. Remove only matching outer
    # quotes; do not interpolate or execute the contents.
    if [ "${#value}" -ge 2 ]; then
      first="${value:0:1}"
      last="${value: -1}"
      if { [ "$first" = '"' ] && [ "$last" = '"' ]; } || { [ "$first" = "'" ] && [ "$last" = "'" ]; }; then
        value="${value:1:${#value}-2}"
      fi
    fi
    export "$key=$value"
  done < "$file"
}
