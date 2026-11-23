STATUS_DIR=${STATUS_DIR:-/var/run/cert}
LOG_TAG=${LOG_TAG:-cert}
CERT_LOG_FILE=${CERT_LOG_FILE:-$STATUS_DIR/cert.log}

log_prio_num() {
	case "$1" in
		emerg) echo 0 ;;
		alert) echo 1 ;;
		crit) echo 2 ;;
		err) echo 3 ;;
		warn) echo 4 ;;
		notice) echo 5 ;;
		info) echo 6 ;;
		debug) echo 7 ;;
		*) echo 6 ;;
	esac
}

effective_log_level() {
	if [ -n "${CERT_LOG_LEVEL:-}" ]; then
		printf '%s' "$CERT_LOG_LEVEL"
		return 0
	fi
	if [ -n "${log_level:-}" ]; then
		CERT_LOG_LEVEL="$log_level"
	elif [ "${debug:-0}" = 1 ]; then
		CERT_LOG_LEVEL="debug"
	elif command -v uci >/dev/null 2>&1; then
		CERT_LOG_LEVEL=$(uci -q get cert.@global[0].log_level 2>/dev/null || true)
		if [ -z "$CERT_LOG_LEVEL" ]; then
			if [ "$(uci -q get cert.@global[0].debug 2>/dev/null || echo 0)" = 1 ]; then
				CERT_LOG_LEVEL="debug"
			else
				CERT_LOG_LEVEL="info"
			fi
		fi
	else
		CERT_LOG_LEVEL="info"
	fi
	export CERT_LOG_LEVEL
	printf '%s' "$CERT_LOG_LEVEL"
}

append_cert_log() {
	local prio="$1"
	local msg="$2"
	local log_dir ts sz
	[ -n "$msg" ] || return 0
	log_dir=$(dirname -- "$CERT_LOG_FILE")
	mkdir -p "$log_dir" 2>/dev/null || return 0
	if [ -f "$CERT_LOG_FILE" ]; then
		sz=$(wc -c < "$CERT_LOG_FILE" 2>/dev/null || echo 0)
		case "$sz" in
			*[!0-9]*) sz=0 ;;
		esac
		if [ "$sz" -ge 65536 ]; then
			mv -f "$CERT_LOG_FILE" "${CERT_LOG_FILE}.1" 2>/dev/null || true
		fi
	fi
	ts=$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo '1970-01-01 00:00:00')
	printf '[%s] [%s] %s: %s\n' "$ts" "$prio" "$LOG_TAG" "$msg" >> "$CERT_LOG_FILE" 2>/dev/null || true
}

log() {
	local prio="$1"
	local lvl cur_num req_num
	shift
	lvl=$(effective_log_level)
	cur_num=$(log_prio_num "$lvl")
	req_num=$(log_prio_num "$prio")
	if [ "$req_num" -le "$cur_num" ] || [ "$req_num" -le 3 ]; then
		logger -t "$LOG_TAG" -p "daemon.$prio" -- "$@" 2>/dev/null || true
		append_cert_log "$prio" "$*"
	fi
}

log_lines() {
	local prio="$1"
	local prefix="$2"
	local text="$3"
	local line
	[ -n "$text" ] || return 0
	printf '%s\n' "$text" | while IFS= read -r line || [ -n "$line" ]; do
		[ -n "$line" ] || continue
		if [ -n "$prefix" ]; then
			log "$prio" "$prefix: $line"
		else
			log "$prio" "$line"
		fi
	done
}

log_err_msg() {
	log err "$*"
	printf '%s\n' "$*" >&2
}

write_status() {
	local section="$1"
	local state="$2"
	local message="$3"
	[ -n "$section" ] || return 0
	mkdir -p "$STATUS_DIR"
	local ts
	ts=$(date '+%Y-%m-%d %H:%M:%S')
	message=$(printf '%s' "$message" | tr '\r\n' '  ')
	local tmp="$STATUS_DIR/.status.$section.$$"
	{
		printf 'state=%s\n' "$state"
		printf 'time=%s\n' "$ts"
		printf 'message=%s\n' "$message"
	} > "$tmp" && mv -f "$tmp" "$STATUS_DIR/status.$section"
}

NFT_HANDLE=

add_nft_rule() {
	local main_domain="$1"
	local listen_port="$2"
	local nft_out

	[ -n "$listen_port" ] || return 0
	case "$listen_port" in
		*[!0-9]*)
			log err "Invalid listen port $listen_port for $main_domain"
			return 1
			;;
	esac

	nft list chain inet fw4 input >/dev/null 2>&1 || return 0

	if ! nft_out=$(nft -a -e insert rule inet fw4 input tcp dport "$listen_port" counter accept comment \"CERT $main_domain\" 2>&1); then
		log err "Failed to add nftables rule for port $listen_port ($main_domain)"
		log_lines err "nft" "$nft_out"
		return 1
	fi
	NFT_HANDLE=$(printf '%s\n' "$nft_out" | grep -o 'handle [0-9]\+' | head -n 1 || true)
	log debug "Added nftables rule for port $listen_port with $NFT_HANDLE"
	echo "$NFT_HANDLE"
}

del_nft_rule() {
	local nft_out
	if [ -n "$NFT_HANDLE" ]; then
		# shellcheck disable=SC2086
		if ! nft_out=$(nft delete rule inet fw4 input $NFT_HANDLE 2>&1); then
			log err "Failed to delete nftables rule $NFT_HANDLE"
			log_lines err "nft" "$nft_out"
		else
			log debug "Deleted nftables rule with $NFT_HANDLE"
		fi
		NFT_HANDLE=""
	fi
}
