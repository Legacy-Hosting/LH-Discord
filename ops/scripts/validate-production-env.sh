#!/usr/bin/env bash
set -Eeuo pipefail

environment_file=${1:-/etc/legacy-hosting/discord.env}
if [[ ! -f $environment_file ]]; then
  echo "Missing protected Discord environment: $environment_file" >&2
  exit 1
fi
permissions=$(stat -c '%a' "$environment_file")
if (( (8#$permissions & 077) != 0 )); then
  echo "$environment_file must have mode 0600 or stricter" >&2
  exit 1
fi

set -a
. "$environment_file"
set +a
required=(NODE_ENV DISCORD_TOKEN DISCORD_APPLICATION_ID DISCORD_GUILD_ID LH_SSO_URL \
  LH_DISCORD_INTERNAL_TOKEN DISCORD_ROLE_FOUNDER_ID DISCORD_ROLE_MANAGEMENT_ID \
  DISCORD_ROLE_ADMINISTRATOR_ID DISCORD_ROLE_DEVELOPER_ID \
  DISCORD_ROLE_INFRASTRUCTURE_ID DISCORD_ROLE_SUPPORT_ID DISCORD_ROLE_SALES_ID)
for name in "${required[@]}"; do
  if [[ -z ${!name:-} ]]; then
    echo "Missing Discord setting: $name" >&2
    exit 1
  fi
done
if [[ $NODE_ENV != production ]]; then
  echo "NODE_ENV must be production" >&2
  exit 1
fi
if [[ $LH_SSO_URL != https://* ]]; then
  echo "LH_SSO_URL must use HTTPS" >&2
  exit 1
fi
if [[ ${#DISCORD_TOKEN} -lt 20 || ${#LH_DISCORD_INTERNAL_TOKEN} -lt 32 ]]; then
  echo "Discord and SSO credentials do not meet their minimum lengths" >&2
  exit 1
fi

snowflake_names=(DISCORD_APPLICATION_ID DISCORD_GUILD_ID \
  DISCORD_ROLE_FOUNDER_ID DISCORD_ROLE_MANAGEMENT_ID \
  DISCORD_ROLE_ADMINISTRATOR_ID DISCORD_ROLE_DEVELOPER_ID \
  DISCORD_ROLE_INFRASTRUCTURE_ID DISCORD_ROLE_SUPPORT_ID DISCORD_ROLE_SALES_ID)
declare -A seen_snowflakes=()
for name in "${snowflake_names[@]}"; do
  value=${!name}
  if [[ ! $value =~ ^[0-9]{17,20}$ ]]; then
    echo "$name must be a Discord snowflake" >&2
    exit 1
  fi
  if [[ -n ${seen_snowflakes[$value]:-} ]]; then
    echo "$name duplicates ${seen_snowflakes[$value]}" >&2
    exit 1
  fi
  seen_snowflakes[$value]=$name
done

echo "Discord production environment validation passed without printing secrets."
