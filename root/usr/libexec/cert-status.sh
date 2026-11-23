#!/bin/sh

json_str() {
	printf '%s' "$1" | tr '\r\n\t' '   ' | sed 's/\\/\\\\/g; s/"/\\"/g'
}

port_listening() {
	local hex_port="$1"
	awk -v p=":${hex_port}$" '$4 == "0A" && $2 ~ p { f=1; exit } END { exit !f }' /proc/net/tcp /proc/net/tcp6 2>/dev/null
}

service_enabled=false
if [ -x /etc/init.d/cert ] && /etc/init.d/cert enabled 2>/dev/null; then
	service_enabled=true
fi

cron_running=false
if pgrep crond >/dev/null 2>&1; then
	cron_running=true
fi

nginx_running=false
if pgrep nginx >/dev/null 2>&1; then
	nginx_running=true
fi

acmesh_present=false
acmesh_version=""
if [ -x /usr/lib/cert/client/acme.sh ]; then
	acmesh_present=true
	acmesh_version=$(/usr/lib/cert/client/acme.sh --version 2>/dev/null | tail -n 1 | tr -d 'vV')
fi

dnsapi_count=0
if [ -d /usr/lib/cert/client/dnsapi ]; then
	dnsapi_count=$(find /usr/lib/cert/client/dnsapi -maxdepth 1 -type f -name 'dns_*.sh' 2>/dev/null | wc -l | tr -d ' ')
fi

cron_entry=""
if [ -r /etc/crontabs/root ]; then
	cron_entry=$(grep -F '/etc/init.d/cert' /etc/crontabs/root 2>/dev/null | head -n 1)
fi

port80=false
port443=false
port_listening 0050 && port80=true
port_listening 01BB && port443=true

printf '{\n'
printf '  "service_enabled": %s,\n' "$service_enabled"
printf '  "cron_running": %s,\n' "$cron_running"
printf '  "nginx_running": %s,\n' "$nginx_running"
printf '  "acmesh_present": %s,\n' "$acmesh_present"
printf '  "acmesh_version": "%s",\n' "$(json_str "$acmesh_version")"
printf '  "dnsapi_count": %s,\n' "$dnsapi_count"
printf '  "cron_entry": "%s",\n' "$(json_str "$cron_entry")"
printf '  "ports": { "80": %s, "443": %s },\n' "$port80" "$port443"

# External certs outside /etc/cert/acme (/root/.acme.sh)
printf '  "external_certs": ['
first=1
for base in /root/.acme.sh; do
	[ -d "$base" ] || continue
	for d in "$base"/*/; do
		[ -d "$d" ] || continue
		name=$(basename "$d")
		case "$name" in
			ca|dnsapi|deploy|notify|http.header) continue ;;
		esac
		[ -f "$d/${name%_ecc}.cer" ] || [ -f "$d/${name%_ecc}.conf" ] || continue
		[ "$first" = 1 ] || printf ', '
		first=0
		printf '"%s"' "$(json_str "$base/$name")"
	done
done
printf '],\n'

# Per-section runtime status from /var/run/cert/status.*
printf '  "statuses": {\n'
first=1
for f in /var/run/cert/status.*; do
	[ -f "$f" ] || continue
	sec=${f#/var/run/cert/status.}
	st=""
	tm=""
	msg=""
	while IFS='=' read -r k v; do
		case "$k" in
			state) st="$v" ;;
			time) tm="$v" ;;
			message) msg="$v" ;;
		esac
	done < "$f"
	[ "$first" = 1 ] || printf ',\n'
	first=0
	printf '    "%s": { "state": "%s", "time": "%s", "message": "%s" }' \
		"$(json_str "$sec")" "$(json_str "$st")" "$(json_str "$tm")" "$(json_str "$msg")"
done
printf '\n  },\n'

# Issued certificates under /etc/ssl/cert
printf '  "certs": [\n'
first=1
if [ -d /etc/ssl/cert ]; then
	for f in /etc/ssl/cert/*.fullchain.crt; do
		[ -f "$f" ] || continue
		fname=$(basename "$f")
		domain=${fname%.fullchain.crt}
		not_before=""
		not_after=""
		issuer=""
		if command -v openssl >/dev/null 2>&1; then
			x509_out=$(openssl x509 -in "$f" -noout -startdate -enddate -issuer 2>/dev/null)
			not_before=$(printf '%s\n' "$x509_out" | sed -n 's/^notBefore=//p' | head -n 1)
			not_after=$(printf '%s\n' "$x509_out" | sed -n 's/^notAfter=//p' | head -n 1)
			issuer=$(printf '%s\n' "$x509_out" | sed -n 's/^issuer=//p' | head -n 1)
		fi
		is_staging=false
		case "$issuer" in
			*Staging*|*STAGING*|*"Fake LE"*|*Test*) is_staging=true ;;
		esac
		if [ "$is_staging" = false ]; then
			for c in "/etc/cert/acme/$domain/$domain.conf" "/etc/cert/acme/${domain}_ecc/$domain.conf"; do
				if [ -f "$c" ] && grep -q "acme-staging" "$c" 2>/dev/null; then
					is_staging=true
					break
				fi
			done
		fi
		[ "$first" = 1 ] || printf ',\n'
		first=0
		printf '    { "domain": "%s", "key_path": "%s", "cert_path": "%s", "not_before": "%s", "not_after": "%s", "issuer": "%s", "is_staging": %s }' \
			"$(json_str "$domain")" \
			"$(json_str "/etc/ssl/cert/$domain.key")" \
			"$(json_str "/etc/ssl/cert/$domain.fullchain.crt")" \
			"$(json_str "$not_before")" \
			"$(json_str "$not_after")" \
			"$(json_str "$issuer")" \
			"$is_staging"
	done
fi
printf '\n  ],\n'

# luci-nginx server SSL bindings from /etc/config/nginx
printf '  "nginx_servers": [\n'
first=1
if [ -f /etc/config/nginx ] && command -v uci >/dev/null 2>&1; then
	for srv in $(uci -q show nginx | sed -n 's/^nginx\.\([^.=]*\)=server$/\1/p'); do
		mgr=$(uci -q get "nginx.${srv}.uci_manage_ssl")
		cert_f=$(uci -q get "nginx.${srv}.ssl_certificate")
		has_ssl=false
		case "$(uci -q get "nginx.${srv}.listen") $mgr $cert_f" in
			*ssl*|*self-signed*|*acme*|*.crt*|*.pem*) has_ssl=true ;;
		esac
		[ "$has_ssl" = true ] || continue
		bound_dom=""
		case "$cert_f" in
			/etc/ssl/cert/*.fullchain.crt)
				bound_dom=${cert_f#/etc/ssl/cert/}
				bound_dom=${bound_dom%.fullchain.crt}
				;;
			/etc/ssl/cert/*.crt)
				bound_dom=${cert_f#/etc/ssl/cert/}
				bound_dom=${bound_dom%.crt}
				;;
		esac
		[ "$first" = 1 ] || printf ',\n'
		first=0
		printf '    { "name": "%s", "manager": "%s", "cert": "%s", "bound_domain": "%s" }' \
			"$(json_str "$srv")" "$(json_str "$mgr")" "$(json_str "$cert_f")" "$(json_str "$bound_dom")"
	done
fi
printf '\n  ],\n'

# Per-deploy-target statuses from /var/run/cert/deploy.*
printf '  "deploy_statuses": {\n'
first=1
for f in /var/run/cert/deploy.*; do
	[ -f "$f" ] || continue
	sec=${f#/var/run/cert/deploy.}
	st=""
	tm=""
	msg=""
	while IFS='=' read -r k v; do
		case "$k" in
			state) st="$v" ;;
			time) tm="$v" ;;
			message) msg="$v" ;;
		esac
	done < "$f"
	[ "$first" = 1 ] || printf ',\n'
	first=0
	printf '    "%s": { "state": "%s", "time": "%s", "message": "%s" }' \
		"$(json_str "$sec")" "$(json_str "$st")" "$(json_str "$tm")" "$(json_str "$msg")"
done
printf '\n  }\n'
printf '}\n'
