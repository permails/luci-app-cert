#!/bin/sh
set -u

LOG_TAG=cert
. /usr/lib/cert/functions.sh

event="${1:-}"

if ! ACTION="$event" hotplug-call cert 2>/dev/null; then
	log err "notify: hotplug-call cert failed for event '$event'"
fi

case "$event" in
renewed)
	ubus call service event '{"type":"cert.renew","data":{}}' >/dev/null 2>&1 || true
	# Emit acme.renew so OpenWrt nginx service_triggers reload automatically
	ubus call service event '{"type":"acme.renew","data":{}}' >/dev/null 2>&1 || true
	;;
issued)
	ubus call service event '{"type":"cert.issue","data":{}}' >/dev/null 2>&1 || true
	ubus call service event '{"type":"acme.renew","data":{}}' >/dev/null 2>&1 || true
	;;
issue-failed|renew-failed)
	log err "notify: ACME certificate event reported failure ($event)"
	;;
esac
