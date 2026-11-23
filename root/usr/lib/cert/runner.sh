#!/bin/sh
set -u
ACME=/usr/lib/cert/client/acme.sh
LOG_TAG=cert
NOTIFY=/usr/lib/cert/notify.sh

. /usr/lib/cert/functions.sh

export CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
export NO_TIMESTAMP=1

: "${section:=}"
: "${FORCE_RENEW:=0}"
: "${debug:=0}"
: "${log_level:=}"
[ "$log_level" = "debug" ] && debug=1
: "${staging:=0}"
: "${key_type:=ec256}"
: "${listen_port:=}"
: "${acme_server:=}"
: "${days:=}"
: "${cert_profile:=}"
: "${dns:=}"
: "${calias:=}"
: "${dalias:=}"
: "${dns_wait:=}"
: "${domains:=}"
: "${main_domain:=}"
: "${account_email:=}"
: "${validation_method:=}"
: "${eab_kid:=}"
: "${eab_hmac_key:=}"

ACME_CHILD_PID=""
OUT_LOG_PID=""
ERR_LOG_PID=""
OUT_FIFO=""
ERR_FIFO=""

cleanup_log_fifos() {
	[ -n "${OUT_LOG_PID:-}" ] && kill "$OUT_LOG_PID" 2>/dev/null || true
	[ -n "${ERR_LOG_PID:-}" ] && kill "$ERR_LOG_PID" 2>/dev/null || true
	[ -n "${OUT_FIFO:-}" ] && rm -f "$OUT_FIFO" 2>/dev/null || true
	[ -n "${ERR_FIFO:-}" ] && rm -f "$ERR_FIFO" 2>/dev/null || true
	OUT_LOG_PID=""
	ERR_LOG_PID=""
	OUT_FIFO=""
	ERR_FIFO=""
}

link_certs() {
	local domain_dir="$1"
	local main_domain="$2"

	if ! mkdir -p "$CERT_DIR" 2>/dev/null; then
		log err "Failed to create certificate directory $CERT_DIR for $main_domain"
		return 1
	fi

	if ! (
		umask 077
		cat "$domain_dir/fullchain.cer" "$domain_dir/$main_domain.key" >"$domain_dir/combined.cer"
	); then
		log err "Failed to generate combined PEM file for $main_domain"
		return 1
	fi

	if ! ln -sf "$domain_dir/$main_domain.cer" "$CERT_DIR/$main_domain.crt" || \
	   ! ln -sf "$domain_dir/$main_domain.key" "$CERT_DIR/$main_domain.key" || \
	   ! ln -sf "$domain_dir/fullchain.cer" "$CERT_DIR/$main_domain.fullchain.crt" || \
	   ! ln -sf "$domain_dir/combined.cer" "$CERT_DIR/$main_domain.combined.crt" || \
	   ! ln -sf "$domain_dir/ca.cer" "$CERT_DIR/$main_domain.chain.crt"; then
		log err "Failed to create symlinks in $CERT_DIR for $main_domain"
		return 1
	fi
}

run_acmesh_locked() {
	local lock_file="$1"
	local domain_conf="$2"
	shift 2
	# Strip stale SAVED_* credentials from both account.conf and domain.conf inside lock
	flock "$lock_file" sh -c '
		state="$1"
		dconf="$2"
		shift 2
		if [ -f "$state/account.conf" ]; then
			sed -i "/^SAVED_/d" "$state/account.conf"
		fi
		if [ -n "$dconf" ] && [ -f "$dconf" ]; then
			sed -i "/^SAVED_/d" "$dconf"
		fi
		exec "$@"
	' _ "$state_dir" "$domain_conf" "$ACME" "$@"
}

stream_fifo_to_log() {
	local prio="$1"
	local fifo="$2"
	local line
	while IFS= read -r line || [ -n "$line" ]; do
		[ -n "$line" ] || continue
		log "$prio" "$line"
	done < "$fifo"
}

run_acmesh_with_logs() {
	local lock_file="$1"
	local domain_conf="$2"
	local rc=0
	shift 2

	mkdir -p "$STATUS_DIR" 2>/dev/null || true
	OUT_FIFO="$STATUS_DIR/.acme.out.$$"
	ERR_FIFO="$STATUS_DIR/.acme.err.$$"
	rm -f "$OUT_FIFO" "$ERR_FIFO"

	if mkfifo "$OUT_FIFO" "$ERR_FIFO" 2>/dev/null; then
		stream_fifo_to_log info "$OUT_FIFO" &
		OUT_LOG_PID=$!
		stream_fifo_to_log err "$ERR_FIFO" &
		ERR_LOG_PID=$!
		run_acmesh_locked "$lock_file" "$domain_conf" "$@" >"$OUT_FIFO" 2>"$ERR_FIFO" &
		ACME_CHILD_PID=$!
		wait "$ACME_CHILD_PID"
		rc=$?
		ACME_CHILD_PID=""
		wait "$OUT_LOG_PID" "$ERR_LOG_PID" 2>/dev/null || true
		rm -f "$OUT_FIFO" "$ERR_FIFO"
		OUT_LOG_PID=""
		ERR_LOG_PID=""
		OUT_FIFO=""
		ERR_FIFO=""
		return "$rc"
	fi

	log warn "mkfifo unavailable in $STATUS_DIR; falling back to procd log stream"
	run_acmesh_locked "$lock_file" "$domain_conf" "$@" &
	ACME_CHILD_PID=$!
	wait "$ACME_CHILD_PID"
	rc=$?
	ACME_CHILD_PID=""
	return "$rc"
}

conf_get() {
	local file="$1"
	local key="$2"
	sed -n "s/^${key}='\(.*\)'$/\1/p" "$file" 2>/dev/null | head -n 1
}

conf_matches_uci() {
	local conf_file="$1"
	local expected_alt=""
	local d
	set -f
	for d in $domains; do
		[ "$d" = "$main_domain" ] && continue
		expected_alt="${expected_alt:+$expected_alt,}$d"
	done
	set +f
	[ -n "$expected_alt" ] || expected_alt="no"

	local conf_alt conf_webroot
	conf_alt=$(conf_get "$conf_file" "Le_Alt")
	[ -n "$conf_alt" ] || conf_alt="no"
	[ "$conf_alt" = "$expected_alt" ] || return 1

	conf_webroot=$(conf_get "$conf_file" "Le_Webroot")
	case "$validation_method" in
		dns)
			[ "$conf_webroot" = "$dns" ] || return 1
			;;
		standalone)
			[ "$conf_webroot" = "no" ] || return 1
			;;
		alpn)
			[ "$conf_webroot" = "tls" ] || return 1
			;;
		webroot)
			[ "${conf_webroot%/}" = "${CHALLENGE_DIR%/}" ] || return 1
			;;
	esac
	return 0
}

handle_signal() {
	local notify_op=$1
	local label_op=$2
	wait_notify() {
		wait 2>/dev/null || true
		cleanup_log_fifos
		log err "$label_op aborted: $main_domain"
		write_status "$section" "failed" "$label_op aborted for $main_domain"
		$NOTIFY "${notify_op}-failed"
		exit 1
	}

	trap wait_notify TERM
	local cgroup
	cgroup=$(cut -d : -f 3 /proc/$$/cgroup 2>/dev/null || true)
	case "$cgroup" in
		/services/cert/*)
			if [ -r "/sys/fs/cgroup${cgroup}/cgroup.procs" ]; then
				local pids
				pids=$(tr '\n' ' ' < "/sys/fs/cgroup${cgroup}/cgroup.procs")
				[ -n "$pids" ] && kill -TERM $pids 2> /dev/null
			fi
			;;
	esac

	kill -TERM -$$ 2> /dev/null

	trap "" TERM
	term_descendants() {
		local pids="$1"
		local pid=""
		for pid in $pids; do
			term_descendants "$(pgrep -P "$pid")"
			kill -TERM "$pid" 2> /dev/null
		done
	}
	term_descendants "$(jobs -p)"

	del_nft_rule
	wait_notify
}

case ${1:-} in
get)
	if [ ! -x "$ACME" ]; then
		log err "Missing acme.sh client at $ACME"
		write_status "$section" "failed" "acme.sh not found at $ACME"
		exit 1
	fi

	if [ -z "$section" ] || case "$section" in *[!A-Za-z0-9_-]*) true ;; *) false ;; esac; then
		log err "Invalid section identifier"
		exit 1
	fi

	if [ -z "$domains" ] || [ -z "$main_domain" ]; then
		log err "No domains configured"
		write_status "$section" "failed" "No domains configured"
		exit 1
	fi

	case "$main_domain" in
		*[!A-Za-z0-9._*-]*|*..*|*/*|.*|*.)
			log err "Invalid primary domain: $main_domain"
			write_status "$section" "failed" "Invalid primary domain"
			exit 1
			;;
	esac

	ecc_flag=""
	case $key_type in
	ec*)
		keylength="ec-${key_type#ec}"
		domain_dir="$state_dir/${main_domain}_ecc"
		ecc_flag="--ecc"
		;;
	rsa*)
		keylength="${key_type#rsa}"
		domain_dir="$state_dir/$main_domain"
		;;
	*)
		log err "Unsupported key_type: $key_type"
		write_status "$section" "failed" "Unsupported key_type: $key_type"
		exit 1
		;;
	esac

	log info "Running ACME for $main_domain with validation_method $validation_method"
	write_status "$section" "running" "Processing $main_domain ($validation_method)"
	lock_file="$state_dir/acme-sh.lock"
	if ! mkdir -p "$state_dir"; then
		log err "Failed to create ACME state directory $state_dir"
		write_status "$section" "failed" "Failed to create state directory"
		exit 1
	fi
	chmod 0700 "$state_dir" 2>/dev/null || true

	sig_current=$(printf 'domains=%s|method=%s|dns=%s|server=%s|staging=%s|key_type=%s|days=%s|profile=%s|calias=%s|dalias=%s|dns_wait=%s|port=%s|email=%s|eab=%s' \
		"$domains" "$validation_method" "$dns" "$acme_server" "$staging" "$key_type" "$days" "$cert_profile" "$calias" "$dalias" "$dns_wait" "$listen_port" "$account_email" "${eab_kid}:${eab_hmac_key}")

	staging_moved=0
	need_issue=0

	if [ -e "$domain_dir" ]; then
		if [ ! -f "$domain_dir/$main_domain.conf" ] || [ ! -f "$domain_dir/$main_domain.cer" ]; then
			log warn "Incomplete ACME state in $domain_dir, resetting for fresh issuance"
			rm -rf "$domain_dir.failed"
			mv "$domain_dir" "$domain_dir.failed" || log err "Failed moving incomplete directory $domain_dir"
			need_issue=1
		elif [ "$staging" = 0 ] && grep -q "acme-staging" "$domain_dir/$main_domain.conf"; then
			rm -rf "$domain_dir.staging"
			mv "$domain_dir" "$domain_dir.staging" || log err "Failed moving staging directory $domain_dir"
			log info "Certificates were previously issued from a staging server, but staging option is disabled, moved to $domain_dir.staging."
			staging_moved=1
			need_issue=1
		elif [ -f "$domain_dir/.openwrt_cert.sig" ]; then
			sig_saved=$(cat "$domain_dir/.openwrt_cert.sig" 2>/dev/null || true)
			if [ "$sig_saved" != "$sig_current" ]; then
				log info "Configuration changed for $main_domain, re-issuing certificate with updated settings"
				need_issue=1
			fi
		else
			if ! conf_matches_uci "$domain_dir/$main_domain.conf"; then
				log info "Existing certificate configuration differs from UCI for $main_domain, re-issuing certificate"
				need_issue=1
			fi
		fi
	else
		need_issue=1
	fi

	if [ "$need_issue" = 0 ]; then
		set --
		[ "$debug" = 1 ] && set -- "$@" --debug
		[ -n "$ecc_flag" ] && set -- "$@" "$ecc_flag"
		[ "$FORCE_RENEW" = 1 ] && set -- "$@" --force
		[ -n "$days" ] && set -- "$@" --days "$days"
		set -- "$@" --renew --home "$state_dir" -d "$main_domain" \
			--pre-hook "$NOTIFY prepare" \
			--renew-hook "$NOTIFY renewed"

		log info "$ACME $*"
		trap "handle_signal renew Renewal" INT TERM
		if ! add_nft_rule "$main_domain" "$listen_port"; then
			trap - INT TERM
			write_status "$section" "failed" "Firewall rule setup failed for $main_domain"
			$NOTIFY renew-failed
			exit 1
		fi
		run_acmesh_with_logs "$lock_file" "$domain_dir/$main_domain.conf" "$@"
		status=$?
		trap - INT TERM
		del_nft_rule

		case $status in
		0)
			if ! link_certs "$domain_dir" "$main_domain"; then
				write_status "$section" "failed" "Failed linking renewed certificates for $main_domain"
				$NOTIFY renew-failed
				exit 1
			fi
			printf '%s\n' "$sig_current" > "$domain_dir/.openwrt_cert.sig"
			$NOTIFY renewed
			if [ -x /usr/lib/cert/deploy.sh ]; then
				/usr/lib/cert/deploy.sh run_domain "$main_domain" || log err "Post-renewal deployment failed for $main_domain"
			fi
			log info "Certificate renewed successfully for $main_domain"
			write_status "$section" "success" "Certificate renewed for $main_domain"
			exit 0
			;;
		2)
			link_certs "$domain_dir" "$main_domain" || true
			printf '%s\n' "$sig_current" > "$domain_dir/.openwrt_cert.sig"
			write_status "$section" "valid" "Certificate is valid (renewal not due yet)"
			exit 0
			;;
		*)
			log err "Renewal failed for $main_domain (exit $status)"
			write_status "$section" "failed" "Renewal failed for $main_domain (exit $status); check Certificate Log"
			$NOTIFY renew-failed
			exit 1
			;;
		esac
	fi

	set --
	[ "$debug" = 1 ] && set -- "$@" --debug
	[ -n "$ecc_flag" ] && set -- "$@" "$ecc_flag"
	if [ -e "$domain_dir" ] || [ "$FORCE_RENEW" = 1 ]; then
		set -- "$@" --force
	fi

	set -f
	for d in $domains; do
		set -- "$@" -d "$d"
	done
	set +f
	set -- "$@" --keylength "$keylength" --accountemail "$account_email"

	if [ "$acme_server" ]; then
		set -- "$@" --server "$acme_server"
	elif [ "$staging" = 1 ]; then
		set -- "$@" --server letsencrypt_test
	else
		set -- "$@" --server letsencrypt
	fi

	if [ "$days" ]; then
		set -- "$@" --days "$days"
	fi

	if [ "$cert_profile" ]; then
		set -- "$@" --cert-profile "$cert_profile"
	fi

	if [ -n "$eab_kid" ] && [ -n "$eab_hmac_key" ]; then
		set -- "$@" --eab-kid "$eab_kid" --eab-hmac-key "$eab_hmac_key"
	fi

	case "$validation_method" in
	"dns")
		if [ -z "$dns" ]; then
			log err "DNS validation selected but dns API is not configured"
			write_status "$section" "failed" "DNS validation selected without DNS API"
			exit 1
		fi
		set -- "$@" --dns "$dns"
		if [ "$dalias" ]; then
			set -- "$@" --domain-alias "$dalias"
			if [ "$calias" ]; then
				log err "Both domain and challenge aliases are defined. Ignoring the challenge alias."
			fi
		elif [ "$calias" ]; then
			set -- "$@" --challenge-alias "$calias"
		fi
		if [ "$dns_wait" ]; then
			set -- "$@" --dnssleep "$dns_wait"
		fi
		;;
	"standalone")
		if ! add_nft_rule "$main_domain" "$listen_port"; then
			write_status "$section" "failed" "Firewall rule setup failed for $main_domain"
			exit 1
		fi
		set -- "$@" --standalone --listen-v6 --httpport "$listen_port"
		;;
	"alpn")
		if ! add_nft_rule "$main_domain" "$listen_port"; then
			write_status "$section" "failed" "Firewall rule setup failed for $main_domain"
			exit 1
		fi
		set -- "$@" --alpn --listen-v6 --tlsport "$listen_port"
		;;
	"webroot")
		if ! mkdir -p "$CHALLENGE_DIR" 2>/dev/null; then
			log err "Failed to create webroot challenge directory $CHALLENGE_DIR"
			write_status "$section" "failed" "Failed to create challenge directory"
			exit 1
		fi
		if ! add_nft_rule "$main_domain" "$listen_port"; then
			write_status "$section" "failed" "Firewall rule setup failed for $main_domain"
			exit 1
		fi
		set -- "$@" --webroot "$CHALLENGE_DIR"
		;;
	*)
		log err "Unsupported validation_method $validation_method"
		write_status "$section" "failed" "Unsupported validation_method: $validation_method"
		exit 1
		;;
	esac

	set -- "$@" --issue --home "$state_dir" \
		--pre-hook "$NOTIFY prepare" \
		--renew-hook "$NOTIFY renewed"

	log info "$ACME $*"
	trap "handle_signal issue Issuance" INT TERM
	run_acmesh_with_logs "$lock_file" "$domain_dir/$main_domain.conf" "$@"
	status=$?
	trap - INT TERM
	del_nft_rule

	case $status in
	0)
		if ! link_certs "$domain_dir" "$main_domain"; then
			write_status "$section" "failed" "Failed linking issued certificates for $main_domain"
			$NOTIFY issue-failed
			exit 1
		fi
		printf '%s\n' "$sig_current" > "$domain_dir/.openwrt_cert.sig"
		$NOTIFY issued
		if [ -x /usr/lib/cert/deploy.sh ]; then
			/usr/lib/cert/deploy.sh run_domain "$main_domain" || log err "Post-issuance deployment failed for $main_domain"
		fi
		log info "Certificate issued successfully for $main_domain"
		write_status "$section" "success" "Certificate issued for $main_domain"
		;;
	*)
		if [ "$staging_moved" = 1 ] && [ -d "$domain_dir.staging" ]; then
			rm -rf "$domain_dir"
			mv "$domain_dir.staging" "$domain_dir" || log err "Failed restoring staging directory $domain_dir.staging"
			log err "Staging certificate restored"
		elif [ -d "$domain_dir" ] && [ ! -f "$domain_dir/$main_domain.cer" ]; then
			rm -rf "$domain_dir.failed"
			mv "$domain_dir" "$domain_dir.failed" || log err "Failed moving failed state to $domain_dir.failed"
			log err "State moved to $domain_dir.failed"
		fi
		log err "Issuance failed for $main_domain (exit $status)"
		write_status "$section" "failed" "Issuance failed for $main_domain (exit $status); check Certificate Log"
		$NOTIFY issue-failed
		exit 1
		;;
	esac
	;;
*)
	log err "Unknown runner command: ${1:-}"
	exit 1
	;;
esac
