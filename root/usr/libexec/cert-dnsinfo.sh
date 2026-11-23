#!/bin/ash
DNSAPI_DIR=/usr/lib/cert/client/dnsapi
CACHE_FILE=/tmp/cert-dnsinfo.cache

[ ! -d "$DNSAPI_DIR" ] && exit 0

count=$(find "$DNSAPI_DIR" -maxdepth 1 -type f -name 'dns_*.sh' 2>/dev/null | wc -l | tr -d ' ')
stamp="${count}_$(ls -ld "$DNSAPI_DIR" 2>/dev/null | tr -s ' ' '_' | cut -d_ -f6-8)"

if [ -s "$CACHE_FILE" ]; then
  cached_stamp=$(head -n 1 "$CACHE_FILE" 2>/dev/null)
  if [ "$cached_stamp" = "#CACHE_STAMP:$stamp" ]; then
    tail -n +2 "$CACHE_FILE"
    exit 0
  fi
fi

TMP_CACHE="${CACHE_FILE}.$$"
{
  printf '#CACHE_STAMP:%s\n' "$stamp"
  for f in "$DNSAPI_DIR"/dns_*.sh
  do
    [ -f "$f" ] || continue
    filename=$(basename -- "$f")
    dns_api="${filename%.*}"
    case "$dns_api" in
      dns_*[!A-Za-z0-9_]*|""|*[!A-Za-z0-9_]*) continue ;;
    esac
    dns_api_info_var="${dns_api}_info"
    (
      # shellcheck source=./dnsapi/dns_*.sh
      . "$f" >/dev/null 2>&1
      eval info_val=\"\$"$dns_api_info_var"\"
      if [ -n "$info_val" ]; then
        printf '%s\n%s\n\n' "$dns_api" "$info_val"
      fi
    ) 2>/dev/null
  done
} > "$TMP_CACHE" && mv -f "$TMP_CACHE" "$CACHE_FILE"

tail -n +2 "$CACHE_FILE"
