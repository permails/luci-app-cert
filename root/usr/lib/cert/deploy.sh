#!/bin/sh

CERT_DIR=${CERT_DIR:-/etc/ssl/cert}
RUN_DIR=${RUN_DIR:-/var/run/cert}
LOG_TAG=cert

. /lib/functions.sh
. /usr/lib/cert/functions.sh

write_deploy_status() {
	local cfg="$1"
	local state="$2"
	local message="$3"
	local clean_msg
	clean_msg=$(printf '%s' "$message" | tr '\r\n' '  ')
	mkdir -p "$RUN_DIR"
	{
		printf 'state=%s\n' "$state"
		printf 'time=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
		printf 'message=%s\n' "$clean_msg"
	} > "$RUN_DIR/deploy.$cfg"
}

validate_domain() {
	local d="$1"
	case "$d" in
		""|*[!A-Za-z0-9._*-]*|*..*|*/*|.*|*.)
			return 1
			;;
		*)
			return 0
			;;
	esac
}

validate_dest_path() {
	local p="$1"
	case "$p" in
		""|*[!A-Za-z0-9_./@-]*|/*../*|*/..)
			return 1
			;;
		/*)
			case "$p" in
				"$CERT_DIR"/*) return 1 ;;
			esac
			return 0
			;;
		*)
			return 1
			;;
	esac
}

install_one_file() {
	local src="$1"
	local dst="$2"
	local mode="$3"
	local method="$4"
	local dir tmp

	[ -n "$dst" ] || return 0
	if ! validate_dest_path "$dst"; then
		log err "deploy: invalid destination path '$dst'"
		return 1
	fi
	if [ ! -f "$src" ]; then
		log err "deploy: source file missing '$src'"
		return 1
	fi

	dir=$(dirname -- "$dst")
	if ! mkdir -p "$dir"; then
		log err "deploy: failed to create directory '$dir'"
		return 1
	fi

	if [ "$method" = "symlink" ]; then
		if ! ln -sf "$src" "$dst"; then
			log err "deploy: failed symlinking '$dst' -> '$src'"
			return 1
		fi
	else
		tmp="${dst}.certtmp.$$"
		if ! cp -f "$src" "$tmp" || ! chmod "$mode" "$tmp" || ! mv -f "$tmp" "$dst"; then
			rm -f "$tmp" 2>/dev/null
			log err "deploy: failed writing '$dst'"
			return 1
		fi
	fi
	return 0
}

_deploy_one_target() {
	local cfg="$1"
	local enabled domain name method cert_path fullchain_path key_path combined_path ca_path reload_cmd
	local files_count=0

	if [ -n "${ONLY_TARGET:-}" ] && [ "$cfg" != "$ONLY_TARGET" ]; then
		return 0
	fi

	config_get_bool enabled "$cfg" enabled 1
	if [ -z "${ONLY_TARGET:-}" ] && [ "$enabled" != 1 ]; then
		return 0
	fi

	config_get domain "$cfg" domain ""
	[ -n "$domain" ] || return 0
	config_get name "$cfg" name "$cfg"

	if ! validate_domain "$domain"; then
		log err "deploy[$name]: invalid domain '$domain'"
		if [ -n "${ONLY_TARGET:-}" ]; then
			TOTAL_COUNT=$((TOTAL_COUNT + 1))
			write_deploy_status "$cfg" "failed" "Invalid domain: $domain"
			FAIL_COUNT=$((FAIL_COUNT + 1))
		fi
		return 0
	fi
	if [ -n "${FILTER_DOMAIN:-}" ] && [ "$domain" != "$FILTER_DOMAIN" ]; then
		return 0
	fi

	config_get method "$cfg" method "copy"
	config_get cert_path "$cfg" cert_path ""
	config_get fullchain_path "$cfg" fullchain_path ""
	config_get key_path "$cfg" key_path ""
	config_get combined_path "$cfg" combined_path ""
	config_get ca_path "$cfg" ca_path ""
	config_get reload_cmd "$cfg" reload_cmd ""

	TOTAL_COUNT=$((TOTAL_COUNT + 1))

	if [ ! -f "$CERT_DIR/$domain.fullchain.crt" ] || [ ! -f "$CERT_DIR/$domain.key" ]; then
		log err "deploy[$name]: issued certificate files for '$domain' not found in $CERT_DIR"
		write_deploy_status "$cfg" "failed" "Missing source certificate files for $domain"
		FAIL_COUNT=$((FAIL_COUNT + 1))
		return 0
	fi

	for spec in \
		"cert:$cert_path:$CERT_DIR/$domain.crt:644" \
		"fullchain:$fullchain_path:$CERT_DIR/$domain.fullchain.crt:644" \
		"ca:$ca_path:$CERT_DIR/$domain.chain.crt:644" \
		"key:$key_path:$CERT_DIR/$domain.key:600" \
		"combined:$combined_path:$CERT_DIR/$domain.combined.crt:600"
	do
		local kind dst src mode
		kind=${spec%%:*}
		spec=${spec#*:}
		dst=${spec%%:*}
		spec=${spec#*:}
		src=${spec%%:*}
		mode=${spec#*:}
		[ -n "$dst" ] || continue
		if ! install_one_file "$src" "$dst" "$mode" "$method"; then
			log err "deploy[$name]: failed installing $kind to $dst"
			write_deploy_status "$cfg" "failed" "Failed installing $kind to $dst"
			FAIL_COUNT=$((FAIL_COUNT + 1))
			return 0
		fi
		files_count=$((files_count + 1))
	done

	if [ "$files_count" -eq 0 ] && [ -z "$reload_cmd" ]; then
		log err "deploy[$name]: no destination file paths configured"
		write_deploy_status "$cfg" "failed" "No destination file paths configured"
		FAIL_COUNT=$((FAIL_COUNT + 1))
		return 0
	fi

	if [ -n "$reload_cmd" ]; then
		if [ "$(printf '%s' "$reload_cmd" | tr -cd '\r\n' | wc -c)" -gt 0 ]; then
			log err "deploy[$name]: reload command must be a single line"
			write_deploy_status "$cfg" "failed" "Reload command must be a single line"
			FAIL_COUNT=$((FAIL_COUNT + 1))
			return 0
		fi
		local cmd_out
		if ! cmd_out=$(sh -c "$reload_cmd" 2>&1); then
			log err "deploy[$name]: reload command failed: $reload_cmd"
			log_lines err "deploy[$name]" "$cmd_out"
			write_deploy_status "$cfg" "failed" "Installed $files_count file(s), reload failed: $cmd_out"
			FAIL_COUNT=$((FAIL_COUNT + 1))
			return 0
		fi
	fi

	log info "deploy[$name]: installed $files_count file(s) for $domain"
	write_deploy_status "$cfg" "success" "Installed $files_count file(s)"
	OK_COUNT=$((OK_COUNT + 1))
}

run_domain() {
	FILTER_DOMAIN="${1:-}"
	ONLY_TARGET="${2:-}"
	TOTAL_COUNT=0
	OK_COUNT=0
	FAIL_COUNT=0
	export FILTER_DOMAIN ONLY_TARGET

	config_load cert
	config_foreach _deploy_one_target deploy

	if [ -n "$ONLY_TARGET" ] && [ "$TOTAL_COUNT" -eq 0 ]; then
		log_err_msg "deploy: target '$ONLY_TARGET' not found."
		return 1
	fi

	if [ "$FAIL_COUNT" -gt 0 ]; then
		log_err_msg "deploy: deployed $OK_COUNT/$TOTAL_COUNT target(s) with $FAIL_COUNT failure(s)."
		return 1
	fi

	if [ "$TOTAL_COUNT" -gt 0 ]; then
		echo "Deployed $OK_COUNT target(s) successfully."
	else
		echo "No active deploy targets configured."
	fi
	return 0
}

nginx_bind() {
	local server="${1:-}"
	local domain="${2:-}"
	local cmd_out

	case "$server" in
		""|*[!A-Za-z0-9_.-]*)
			log_err_msg "nginx_bind: invalid nginx server name '$server'"
			return 1
			;;
	esac
	if ! validate_domain "$domain" || [ ! -f "$CERT_DIR/$domain.fullchain.crt" ] || [ ! -f "$CERT_DIR/$domain.key" ]; then
		log_err_msg "nginx_bind: issued certificate for '$domain' not found in $CERT_DIR"
		return 1
	fi
	if ! command -v nginx-util >/dev/null 2>&1; then
		log_err_msg "nginx_bind: nginx-util not installed"
		return 1
	fi

	if ! cmd_out=$(nginx-util add_ssl "$server" acme "$CERT_DIR/$domain.fullchain.crt" "$CERT_DIR/$domain.key" 2>&1); then
		log err "nginx_bind: failed binding '$server' to $domain"
		log_lines err "nginx-util" "$cmd_out"
		[ -n "$cmd_out" ] && printf '%s\n' "$cmd_out" >&2
		return 1
	fi
	if [ -x /etc/init.d/nginx ]; then
		if ! cmd_out=$(/etc/init.d/nginx reload 2>&1); then
			log err "nginx_bind: failed reloading nginx for '$server'"
			log_lines err "nginx" "$cmd_out"
			[ -n "$cmd_out" ] && printf '%s\n' "$cmd_out" >&2
			return 1
		fi
	fi
	log info "nginx: bound '$server' to $domain"
	echo "Bound luci-nginx server '$server' to $domain."
}

nginx_unbind() {
	local server="${1:-}"
	local cmd_out

	case "$server" in
		""|*[!A-Za-z0-9_.-]*)
			log_err_msg "nginx_unbind: invalid nginx server name '$server'"
			return 1
			;;
	esac
	if ! command -v nginx-util >/dev/null 2>&1; then
		log_err_msg "nginx_unbind: nginx-util not installed"
		return 1
	fi

	nginx-util del_ssl "$server" acme >/dev/null 2>&1 || true
	if [ "$server" = "_lan" ]; then
		if ! cmd_out=$(nginx-util add_ssl _lan 2>&1); then
			log err "nginx_unbind: failed restoring default SSL for _lan"
			log_lines err "nginx-util" "$cmd_out"
			[ -n "$cmd_out" ] && printf '%s\n' "$cmd_out" >&2
			return 1
		fi
	fi
	if [ -x /etc/init.d/nginx ]; then
		if ! cmd_out=$(/etc/init.d/nginx reload 2>&1); then
			log err "nginx_unbind: failed reloading nginx after restoring '$server'"
			log_lines err "nginx" "$cmd_out"
			[ -n "$cmd_out" ] && printf '%s\n' "$cmd_out" >&2
			return 1
		fi
	fi
	log info "nginx: restored default SSL for '$server'"
	echo "Restored default SSL configuration for nginx server '$server'."
}

case "${1:-}" in
	run_domain)
		run_domain "${2:-}" "${3:-}"
		;;
	nginx_bind)
		nginx_bind "${2:-}" "${3:-}"
		;;
	nginx_unbind)
		nginx_unbind "${2:-}"
		;;
	*)
		log_err_msg "deploy: unknown action '${1:-}'"
		echo "Usage: $0 {run_domain [domain] [target]|nginx_bind <server> <domain>|nginx_unbind <server>}" >&2
		exit 1
		;;
esac
