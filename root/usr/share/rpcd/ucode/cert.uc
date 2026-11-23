'use strict';

import { access, basename, glob, popen, readfile, rename, stat, writefile } from 'fs';
import { cursor } from 'uci';
import { init_enabled } from 'luci.sys';

const CLIENT_DIR = '/usr/lib/cert/client';
const DNSAPI_DIR = CLIENT_DIR + '/dnsapi';
const DNSINFO_CACHE = '/tmp/cert-dnsinfo.cache';
const CERT_DIR = '/etc/ssl/cert';
const ACME_DIR = '/etc/cert/acme';
const RUN_DIR = '/var/run/cert';
const CERT_LOG_FILE = RUN_DIR + '/cert.log';

const MONTHS = {
	Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
	Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
};

const ALLOWED_ACTIONS = {
	start: true,
	stop: true,
	enable: true,
	disable: true,
	renew: true,
	force_renew: true,
	abort: true,
	deploy: true,
	nginx_bind: true,
	update_client: true
};

function shellquote(s) {
	return `'${replace(s, "'", "'\\''")}'`;
}

function hasProcComm(targetName) {
	for (let p in glob('/proc/[0-9]*/comm')) {
		let name = trim(readfile(p) || '');
		if (name == targetName)
			return true;
	}
	return false;
}

function checkListeningPorts() {
	let p80 = false;
	let p443 = false;
	for (let path in ['/proc/net/tcp', '/proc/net/tcp6']) {
		let raw = readfile(path);
		if (!raw) continue;
		for (let line in split(raw, '\n')) {
			let cols = split(trim(line), /[ \t]+/);
			if (length(cols) < 4 || cols[3] != '0A') continue;
			let local = uc(cols[1]);
			let suffix = substr(local, -5);
			if (suffix == ':0050') p80 = true;
			else if (suffix == ':01BB') p443 = true;
		}
	}
	return { '80': p80, '443': p443 };
}

function readKeyValStatuses(pattern, prefix) {
	let out = {};
	for (let f in glob(pattern)) {
		let st = stat(f);
		if (!st || st.type != 'file') continue;
		let b = basename(f);
		let sec = replace(b, prefix, '');
		let raw = readfile(f) || '';
		let entry = { state: '', time: '', message: '' };
		for (let line in split(raw, '\n')) {
			let eq = index(line, '=');
			if (eq <= 0) continue;
			let k = substr(line, 0, eq);
			let v = substr(line, eq + 1);
			if (k == 'state' || k == 'time' || k == 'message')
				entry[k] = v;
		}
		out[sec] = entry;
	}
	return out;
}

function getAcmeshVersion() {
	let acmePath = CLIENT_DIR + '/acme.sh';
	if (!access(acmePath, 'x'))
		return { present: false, version: '' };

	let head = readfile(acmePath, 4096) || '';
	let m = match(head, /\nVER=([^\r\n'"]+)/) || match(head, /^VER=([^\r\n'"]+)/);
	if (m && m[1])
		return { present: true, version: replace(trim(m[1]), /^[vV]/, '') };

	let fd = popen(shellquote(acmePath) + ' --version 2>/dev/null');
	let ver = '';
	if (fd) {
		let lines = split(trim(fd.read('all') || ''), '\n');
		fd.close();
		if (length(lines) > 0)
			ver = replace(trim(lines[length(lines) - 1]), /^[vV]/, '');
	}
	return { present: true, version: ver };
}

function getExternalCerts() {
	let out = [];
	let skip = { ca: true, dnsapi: true, deploy: true, notify: true, 'http.header': true };
	for (let d in glob('/root/.acme.sh/*')) {
		let st = stat(d);
		if (!st || st.type != 'directory') continue;
		let name = basename(d);
		if (skip[name]) continue;
		let base = replace(name, /_ecc$/, '');
		if (stat(`${d}/${base}.cer`)?.type == 'file' || stat(`${d}/${base}.conf`)?.type == 'file')
			push(out, d);
	}
	return out;
}

function getIssuedCerts() {
	let out = [];
	for (let f in glob(`${CERT_DIR}/*.fullchain.crt`)) {
		let st = stat(f);
		if (!st || st.type != 'file') continue;
		let domain = replace(basename(f), /\.fullchain\.crt$/, '');
		let not_before = '';
		let not_after = '';
		let issuer = '';

		let fd = popen(`openssl x509 -in ${shellquote(f)} -noout -startdate -enddate -issuer 2>/dev/null`);
		if (fd) {
			let raw = fd.read('all') || '';
			fd.close();
			for (let line in split(raw, '\n')) {
				if (index(line, 'notBefore=') == 0) not_before = substr(line, 10);
				else if (index(line, 'notAfter=') == 0) not_after = substr(line, 9);
				else if (index(line, 'issuer=') == 0) issuer = substr(line, 7);
			}
		}

		let is_staging = match(issuer, /Staging|STAGING|Fake LE|Test/) != null;
		if (!is_staging) {
			for (let c in [`${ACME_DIR}/${domain}/${domain}.conf`, `${ACME_DIR}/${domain}_ecc/${domain}.conf`]) {
				let craw = readfile(c);
				if (craw && index(craw, 'acme-staging') >= 0) {
					is_staging = true;
					break;
				}
			}
		}

		push(out, {
			domain,
			key_path: `${CERT_DIR}/${domain}.key`,
			cert_path: f,
			not_before,
			not_after,
			issuer,
			is_staging
		});
	}
	return out;
}

function getNginxServers() {
	let out = [];
	if (stat('/etc/config/nginx')?.type != 'file')
		return out;

	let ctx = null;
	try {
		ctx = cursor();
		if (ctx && ctx.load('nginx')) {
			ctx.foreach('nginx', 'server', (s) => {
				let srv = s['.name'];
				let mgr = s.uci_manage_ssl || '';
				let cert_f = s.ssl_certificate || '';
				let listen = type(s.listen) == 'array' ? join(' ', s.listen) : (s.listen || '');
				let combined = `${listen} ${mgr} ${cert_f}`;
				if (!match(combined, /ssl|self-signed|acme|\.crt|\.pem/))
					return;

				let bound_dom = '';
				if (index(cert_f, `${CERT_DIR}/`) == 0) {
					let rel = substr(cert_f, length(CERT_DIR) + 1);
					if (match(rel, /\.fullchain\.crt$/))
						bound_dom = replace(rel, /\.fullchain\.crt$/, '');
					else if (match(rel, /\.crt$/))
						bound_dom = replace(rel, /\.crt$/, '');
				}

				push(out, {
					name: srv,
					manager: mgr,
					cert: cert_f,
					bound_domain: bound_dom
				});
			});
		}
	} catch (e) {
		// ignore uci read error
	}
	if (ctx) {
		try { ctx.unload(); } catch (e2) {}
	}
	return out;
}

function extractDnsInfo(src, id) {
	for (let q in ["'", '"']) {
		let prefix = id + '_info=' + q;
		let pos = index(src, '\n' + prefix);
		if (pos >= 0) {
			pos += 1 + length(prefix);
		} else if (substr(src, 0, length(prefix)) == prefix) {
			pos = length(prefix);
		} else {
			continue;
		}
		let end = index(src, q + '\n', pos);
		if (end < 0)
			end = index(src, q, pos);
		if (end > pos)
			return substr(src, pos, end - pos);
	}
	return null;
}

const methods = {
	get_status: {
		call: function(request) {
			let service_enabled = false;
			try {
				service_enabled = access('/etc/init.d/cert', 'x') && init_enabled('cert');
			} catch (e) {
				service_enabled = length(glob('/etc/rc.d/S*cert')) > 0;
			}

			let acmesh = getAcmeshVersion();
			let dnsapi_count = length(glob(`${DNSAPI_DIR}/dns_*.sh`));

			let cron_entry = '';
			let cron_raw = readfile('/etc/crontabs/root');
			if (cron_raw) {
				for (let line in split(cron_raw, '\n')) {
					if (index(line, '/etc/init.d/cert') >= 0) {
						cron_entry = line;
						break;
					}
				}
			}

			return {
				service_enabled,
				cron_running: hasProcComm('crond'),
				nginx_running: hasProcComm('nginx'),
				acmesh_present: acmesh.present,
				acmesh_version: acmesh.version,
				dnsapi_count,
				cron_entry,
				ports: checkListeningPorts(),
				external_certs: getExternalCerts(),
				statuses: readKeyValStatuses(`${RUN_DIR}/status.*`, /^status\./),
				certs: getIssuedCerts(),
				nginx_servers: getNginxServers(),
				deploy_statuses: readKeyValStatuses(`${RUN_DIR}/deploy.*`, /^deploy\./)
			};
		}
	},

	get_dnsinfo: {
		call: function(request) {
			let dirStat = stat(DNSAPI_DIR);
			if (!dirStat || dirStat.type != 'directory')
				return { text: '' };

			let files = sort(glob(`${DNSAPI_DIR}/dns_*.sh`));
			let stamp = `${length(files)}_${dirStat.mtime || 0}`;
			let header = `#CACHE_STAMP:${stamp}\n`;

			let cached = readfile(DNSINFO_CACHE);
			if (cached && index(cached, header) == 0)
				return { text: substr(cached, length(header)) };

			let parts = [];
			for (let f in files) {
				let st = stat(f);
				if (!st || st.type != 'file') continue;
				let id = replace(basename(f), /\.sh$/, '');
				if (!match(id, /^dns_[A-Za-z0-9_]+$/)) continue;
				let src = readfile(f);
				if (!src) continue;
				let info = extractDnsInfo(src, id);
				if (info)
					push(parts, `${id}\n${info}\n`);
			}

			let body = join('\n', parts);
			if (length(parts) > 0)
				body += '\n';

			let tmp = `${DNSINFO_CACHE}.${stat('/proc/self')?.ino || 'tmp'}`;
			try {
				writefile(tmp, header + body);
				rename(tmp, DNSINFO_CACHE);
			} catch (e) {}

			return { text: body };
		}
	},

	get_logs: {
		call: function(request) {
			let seen = {};
			let entries = [];
			let seq = 0;

			for (let p in [`${CERT_LOG_FILE}.1`, CERT_LOG_FILE]) {
				let raw = readfile(p);
				if (!raw) continue;
				for (let line in split(raw, '\n')) {
					let m = match(line, /^\[([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2})\] \[[a-z]+\] /);
					if (!m || seen[line]) continue;
					seen[line] = true;
					push(entries, { ts: m[1], seq: ++seq, line });
				}
			}

			let fd = popen('logread 2>/dev/null');
			if (fd) {
				let raw = fd.read('all') || '';
				fd.close();
				for (let line in split(raw, '\n')) {
					let m = match(line, /^[A-Z][a-z][a-z][ \t]+([A-Z][a-z][a-z])[ \t]+([0-9]+)[ \t]+([0-9]{2}:[0-9]{2}:[0-9]{2})[ \t]+([0-9]{4})[ \t]+[a-z0-9]+\.([a-z]+)[ \t]+(.*)$/);
					if (!m) continue;
					let mon = MONTHS[m[1]];
					if (!mon) continue;
					let body = m[6];
					if (!match(body, /^(cert(-[A-Za-z0-9_]+)?|runner\.sh)(\[[0-9]+\])?:/) &&
					    !match(body, /^procd:.*(\/etc\/rc\.d\/[SK][0-9]*cert|\/etc\/init\.d\/cert|cert::)/) &&
					    !match(body, /(acme\.sh|\/usr\/lib\/cert\/|cert-status\.sh|cert-dnsinfo\.sh)/))
						continue;

					let day = sprintf('%02d', +m[2]);
					let ts = `${m[4]}-${mon}-${day} ${m[3]}`;
					let norm = `[${ts}] [${m[5] || 'info'}] ${body}`;
					if (seen[norm]) continue;
					seen[norm] = true;
					push(entries, { ts, seq: ++seq, line: norm });
				}
			}

			sort(entries, (a, b) => {
				if (a.ts < b.ts) return -1;
				if (a.ts > b.ts) return 1;
				return a.seq - b.seq;
			});

			let start = length(entries) > 800 ? length(entries) - 800 : 0;
			let lines = [];
			for (let i = start; i < length(entries); i++)
				push(lines, entries[i].line);

			return { lines };
		}
	},

	service_action: {
		args: { action: 'string', arg1: 'string', arg2: 'string' },
		call: function(request) {
			let action = request.args?.action;
			if (!action || !ALLOWED_ACTIONS[action])
				return { code: 1, stdout: '', stderr: 'Invalid action' };

			let cmdArgs = [shellquote('/etc/init.d/cert'), shellquote(action)];
			for (let a in [request.args?.arg1, request.args?.arg2]) {
				if (a == null || a == '') {
					if (length(cmdArgs) == 2 && request.args?.arg2 != null && request.args?.arg2 != '') {
						cmdArgs[2] = "''";
					}
					continue;
				}
				if (!match(a, /^[A-Za-z0-9._*@:\/-]+$/) || index(a, '..') >= 0)
					return { code: 1, stdout: '', stderr: 'Invalid argument' };
				push(cmdArgs, shellquote(a));
			}

			let cmd = join(' ', cmdArgs) + ' 2>&1; printf "\\n__CERT_RC__=%d\\n" "$?"';
			let fd = popen(cmd);
			if (!fd)
				return { code: 1, stdout: '', stderr: 'Failed to execute service command' };

			let raw = fd.read('all') || '';
			fd.close();

			let rc = 1;
			let m = match(raw, /\n__CERT_RC__=(\d+)\s*$/);
			if (m) {
				rc = +m[1];
				raw = substr(raw, 0, length(raw) - length(m[0]));
			}
			let out = trim(raw);
			return {
				code: rc,
				stdout: rc == 0 ? out : '',
				stderr: rc != 0 ? out : ''
			};
		}
	}
};

return { 'luci.cert': methods };
