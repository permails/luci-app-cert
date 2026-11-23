#!/bin/sh
set -eu

CLIENT_DIR=/usr/lib/cert/client
LOG_TAG=cert
export CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

. /usr/lib/cert/functions.sh

TMP_DIR=$(mktemp -d /tmp/cert-update.XXXXXX)
UPDATE_DONE=0

on_exit() {
	local rc=$?
	if [ "$rc" -ne 0 ] && [ "$UPDATE_DONE" -eq 0 ]; then
		log err "update-client: acme.sh client update exited with error (exit $rc)"
	fi
	rm -rf "${TMP_DIR:-}"
}
trap on_exit EXIT

fail_update() {
	local msg="$1"
	local err_text=""
	log err "update-client: $msg"
	if [ -s "${TMP_DIR:-}/cmd.err" ]; then
		err_text=$(tail -n 20 "$TMP_DIR/cmd.err" 2>/dev/null || true)
		log_lines err "update-client" "$err_text"
		printf '%s\n' "$err_text" >&2
	fi
	printf '%s\n' "$msg" >&2
	exit 1
}

# Download latest master or release tarball from acme.sh official GitHub
URL="https://codeload.github.com/acmesh-official/acme.sh/tar.gz/refs/heads/master"
if [ -n "${1:-}" ]; then
	case "$1" in
		*[!A-Za-z0-9._/-]*|*..*|/*|*/)
			fail_update "Invalid version or branch ref: $1"
			;;
	esac
	URL="https://codeload.github.com/acmesh-official/acme.sh/tar.gz/$1"
fi

log info "update-client: downloading acme.sh & DNS APIs from $URL"
echo "Downloading acme.sh & DNS APIs from $URL ..."
if ! wget -O "$TMP_DIR/acme.tar.gz" "$URL" >"$TMP_DIR/cmd.err" 2>&1; then
	fail_update "Failed to download archive from $URL"
fi

mkdir -p "$TMP_DIR/extract"
if ! tar -xzf "$TMP_DIR/acme.tar.gz" -C "$TMP_DIR/extract" >"$TMP_DIR/cmd.err" 2>&1; then
	fail_update "Failed to extract downloaded archive from $URL"
fi

SRC_DIR=$(find "$TMP_DIR/extract" -mindepth 1 -maxdepth 1 -type d | head -n 1 || true)
if [ -z "$SRC_DIR" ] || [ ! -f "$SRC_DIR/acme.sh" ] || [ ! -d "$SRC_DIR/dnsapi" ]; then
	fail_update "Invalid archive: missing acme.sh or dnsapi"
fi

chmod 0755 "$SRC_DIR/acme.sh"

# Smoke test executable before replacing
if ! "$SRC_DIR/acme.sh" --version >/dev/null 2>"$TMP_DIR/cmd.err"; then
	fail_update "Downloaded acme.sh failed version check"
fi

if ! mkdir -p "$CLIENT_DIR/dnsapi" 2>"$TMP_DIR/cmd.err" || \
   ! cp -f "$SRC_DIR/acme.sh" "$CLIENT_DIR/acme.sh" 2>"$TMP_DIR/cmd.err" || \
   ! chmod 0755 "$CLIENT_DIR/acme.sh" 2>"$TMP_DIR/cmd.err"; then
	fail_update "Failed to install acme.sh binary into $CLIENT_DIR"
fi

# Replace dnsapi scripts cleanly
rm -rf "$CLIENT_DIR/dnsapi.new" "$CLIENT_DIR/dnsapi.old"
if ! mkdir -p "$CLIENT_DIR/dnsapi.new" 2>"$TMP_DIR/cmd.err" || \
   ! cp -f "$SRC_DIR/dnsapi/"*.sh "$CLIENT_DIR/dnsapi.new/" 2>"$TMP_DIR/cmd.err" || \
   ! mv "$CLIENT_DIR/dnsapi" "$CLIENT_DIR/dnsapi.old" 2>"$TMP_DIR/cmd.err" || \
   ! mv "$CLIENT_DIR/dnsapi.new" "$CLIENT_DIR/dnsapi" 2>"$TMP_DIR/cmd.err"; then
	if [ -d "$CLIENT_DIR/dnsapi.old" ] && [ ! -d "$CLIENT_DIR/dnsapi" ]; then
		mv "$CLIENT_DIR/dnsapi.old" "$CLIENT_DIR/dnsapi" 2>/dev/null || true
	fi
	fail_update "Failed to update DNS API scripts in $CLIENT_DIR/dnsapi"
fi
rm -rf "$CLIENT_DIR/dnsapi.old"
rm -f /tmp/cert-dnsinfo.cache

NEW_VER=$("$CLIENT_DIR/acme.sh" --version 2>/dev/null | tail -n 1 || echo "updated")
UPDATE_DONE=1
log info "update-client: updated acme.sh client & dnsapi to $NEW_VER"
echo "Updated acme.sh & DNS APIs to $NEW_VER"
