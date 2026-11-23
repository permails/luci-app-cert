#!/bin/sh

CERT_LOG_FILE=/var/run/cert/cert.log

{
	[ -f "${CERT_LOG_FILE}.1" ] && cat "${CERT_LOG_FILE}.1" 2>/dev/null || true
	[ -f "$CERT_LOG_FILE" ] && cat "$CERT_LOG_FILE" 2>/dev/null || true
} | awk '
BEGIN {
	split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", mnames, " ")
	for (i = 1; i <= 12; i++) mon[mnames[i]] = sprintf("%02d", i)
}
# Pass 1: Persistent plugin RAM log lines ([YYYY-MM-DD HH:MM:SS] [prio] tag: msg)
/^\[[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]\] \[[a-z]+\] / {
	if (!seen[$0]++) {
		ts = substr($0, 2, 19)
		n++
		ts_arr[n] = ts
		lines[n] = $0
	}
	next
}
END {
	cmd = "logread 2>/dev/null"
	while ((cmd | getline line) > 0) {
		# OpenWrt logread format: Mon Nov 23 16:07:04 2026 daemon.err cert: message...
		if (match(line, /^[A-Z][a-z][a-z] +[A-Z][a-z][a-z] +[0-9]+ +[0-9][0-9]:[0-9][0-9]:[0-9][0-9] +[0-9][0-9][0-9][0-9] +[a-z0-9]+\.[a-z]+ +/)) {
			hdr = substr(line, 1, RLENGTH)
			body = substr(line, RLENGTH + 1)
			split(hdr, f, " ")
			if (f[2] in mon) {
				ts = sprintf("%s-%s-%02d %s", f[5], mon[f[2]], f[3] + 0, f[4])
				split(f[6], fp, ".")
				sev = (fp[2] != "" ? fp[2] : "info")
				if (body ~ /^(cert(-[A-Za-z0-9_]+)?|runner\.sh)(\[[0-9]+\])?:/ ||
				    body ~ /^procd:.*(\/etc\/rc\.d\/[SK][0-9]*cert|\/etc\/init\.d\/cert|cert::)/ ||
				    body ~ /(acme\.sh|\/usr\/lib\/cert\/|cert-status\.sh|cert-dnsinfo\.sh)/) {
					norm = "[" ts "] [" sev "] " body
					if (!seen[norm]++) {
						n++
						ts_arr[n] = ts
						lines[n] = norm
					}
				}
			}
		}
	}
	close(cmd)
	for (i = 1; i <= n; i++) {
		printf "%s\t%07d\t%s\n", ts_arr[i], i, lines[i]
	}
}
' | LC_ALL=C sort -t '	' -k1,1 -k2,2 | cut -f3- | tail -n 800
