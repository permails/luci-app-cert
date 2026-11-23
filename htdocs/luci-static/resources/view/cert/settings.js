'use strict';
'require form';
'require rpc';
'require uci';
'require ui';
'require view';

const callGetStatus = rpc.declare({
	object: 'luci.cert',
	method: 'get_status',
	expect: {}
});

const callServiceAction = rpc.declare({
	object: 'luci.cert',
	method: 'service_action',
	params: ['action', 'arg1', 'arg2'],
	expect: { code: 1, stdout: '', stderr: '' }
});

return view.extend({
	load() {
		return Promise.all([
			L.resolveDefault(callGetStatus(), {}),
			L.resolveDefault(uci.load('ddns')),
			L.resolveDefault(uci.load('cert')),
		]);
	},

	render(data) {
		let status = (data[0] && typeof data[0] === 'object') ? data[0] : {};
		let ddnsDomains = _collectDdnsDomains();
		let m, s, o;

		let styleEl = E('style', {}, `
			#maincontent ul.tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; margin: 0 0 16px 0; border-radius: 8px; background: var(--background-color-medium); background: color-mix(in srgb, var(--background-color-low) 60%, var(--background-color-high)); border: 1px solid var(--border-color-low); background-image: none; background-size: auto; }
			#maincontent ul.tabs > li { height: auto !important; max-width: none; margin: 0 !important; border-radius: 6px; border: 1px solid transparent; background: transparent; background-image: none; color: var(--text-color-medium); transition: background 0.15s ease, color 0.15s ease; }
			#maincontent ul.tabs > li > a { padding: 6px 14px; line-height: 1.4; font-size: 13.5px; font-weight: 500; border-radius: 6px; background: transparent; }
			#maincontent ul.tabs > li:not(.active):hover { background: var(--background-color-high); background-image: none; color: var(--primary-color-high); }
			#maincontent ul.tabs > li.active { background: var(--background-color-high); background-image: none; border-color: var(--border-color-low); color: var(--primary-color-high); font-weight: 600; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08); }
			#cbi-cert { background: var(--background-color-medium); background: color-mix(in srgb, var(--background-color-low) 60%, var(--background-color-high)); border: 1px solid var(--border-color-low); border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; }
			#cbi-cert > h2 { margin-top: 0 !important; }
			#cbi-cert > .cbi-map-descr { margin-bottom: 14px; }
			#cbi-cert > .cbi-section { margin: 16px 0 0 0; padding: 0; border-radius: 8px; border: 1px solid var(--border-color-low); background: var(--background-color-high); overflow: hidden; box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05); }
			#cbi-cert > .cbi-map-descr + .cbi-section { margin-top: 0; }
			#cbi-cert > .cbi-section > h3 { margin: 0 !important; padding: 12px 16px; background: var(--background-color-high); border-bottom: 1px solid var(--border-color-low); font-size: 14px; font-weight: 600; line-height: 1.35; color: var(--text-color-high); }
			#cbi-cert > .cbi-section > .cbi-section-node { padding: 6px 18px 8px 18px; }
			#cbi-cert > .cbi-section .cbi-value { margin: 0; padding: 12px 0; border-bottom: 1px solid var(--border-color-low); }
			#cbi-cert > .cbi-section .cbi-value:last-child { border-bottom: none; }
			.cert-dot { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
			.cert-dot::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
			.cert-dot-ok { color: var(--success-color-low); background: rgba(var(--success-color-high-rgb), 0.12); }
			:root[data-darkmode="true"] .cert-dot-ok { color: var(--success-color-high); }
			.cert-code-box { margin: 0; padding: 10px 12px; border-radius: 6px; background: color-mix(in srgb, var(--background-color-medium) 55%, var(--background-color-high)); border: 1px solid var(--border-color-low); font-size: 12px; line-height: 1.5; max-width: 100%; overflow-x: auto; }
			@media screen and (max-width: 768px), screen and (max-device-width: 600px) {
				#maincontent ul.tabs { margin: 0 0 12px 0; padding: 4px; background: color-mix(in srgb, var(--background-color-low) 60%, var(--background-color-high)); background-image: none; }
				#maincontent ul.tabs > li { flex: 1 1 auto; justify-content: center; height: auto !important; }
				#maincontent ul.tabs > li > a { width: 100%; text-align: center; padding: 6px 10px; line-height: 1.35; font-size: 13px; }
				#cbi-cert { padding: 14px 12px; border-radius: 8px; }
				#cbi-cert > .cbi-section > h3 { padding: 10px 14px; font-size: 13.5px; }
				#cbi-cert > .cbi-section > .cbi-section-node { padding: 4px 14px 8px 14px; }
				#cbi-cert > .cbi-section .cbi-value { display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 10px 0; }
				#cbi-cert > .cbi-section .cbi-value > label.cbi-value-title { width: 100% !important; text-align: left !important; padding: 0 !important; }
				#cbi-cert > .cbi-section .cbi-value > .cbi-value-field { width: 100% !important; margin-left: 0 !important; }
				#cbi-cert input[type="text"], #cbi-cert input[type="password"] { width: 100%; font-size: 16px; min-height: 38px; box-sizing: border-box; }
				#cbi-cert .cbi-button { white-space: normal; height: auto; min-height: 36px; line-height: 1.35; padding: 6px 12px; max-width: 100%; }
				.cert-code-box { font-size: 11.5px; white-space: pre-wrap; word-break: break-word; }
			}
		`);

		m = new form.Map('cert', _('Global Settings'),
			_('Configure ACME account identity, logging, and optional integrations.'));

		s = m.section(form.TypedSection, 'global', _('ACME Account'));
		s.anonymous = true;

		o = s.option(form.Value, 'account_email', _('Account email'),
			_('Email address registered with the ACME CA for renewal and expiry notifications.'));
		o.rmempty = false;
		o.default = 'email@example.org';
		o.placeholder = 'email@example.org';
		o.validate = function (section_id, value) {
			if (!value || !value.trim()) {
				return _('Account email is required');
			}
			if (value.trim().toLowerCase() === 'email@example.org') {
				return _('Please replace email@example.org with your real email address');
			}
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
				return _('Please enter a valid email address');
			}
			return true;
		};

		o = s.option(form.ListValue, 'log_level', _('Log level'),
			_('Minimum log severity recorded to system log and Certificate Log. Errors are always recorded.'));
		o.value('err', _('Error only (err)'));
		o.value('warn', _('Warning and above (warn)'));
		o.value('info', _('Info and above (info, default)'));
		o.value('debug', _('Debug verbose (debug)'));
		o.default = 'info';
		o.rmempty = false;
		o.cfgvalue = function (section_id) {
			let v = uci.get('cert', section_id, 'log_level');
			if (v) return v;
			return uci.get('cert', section_id, 'debug') === '1' ? 'debug' : 'info';
		};
		o.write = function (section_id, value) {
			uci.set('cert', section_id, 'log_level', value);
			uci.set('cert', section_id, 'debug', value === 'debug' ? '1' : '0');
		};

		if (ddnsDomains.length > 0) {
			let ddnsList = ddnsDomains.map(d => d.domains[0]);
			s = m.section(form.TypedSection, '_ddns_import', _('DDNS Integration'));
			s.anonymous = true;
			s.cfgsections = () => ['_ddns'];

			o = s.option(form.Button, '_import_ddns', _('Import from DDNS'),
				_('Detected compatible DDNS domain configurations: %s').format(ddnsList.join(', ')));
			o.inputtitle = _('Import') + ': ' + ddnsList.join(', ');
			o.inputstyle = 'apply';
			o.onclick = function () {
				_importDdns(ddnsDomains);
			};
		}

		if (status.nginx_running) {
			s = m.section(form.TypedSection, '_nginx_guide', _('luci-nginx Integration'));
			s.anonymous = true;
			s.cfgsections = () => ['_nginx'];

			o = s.option(form.DummyValue, '_nginx_note', _('Automatic Reload'),
				_('luci-app-cert automatically emits acme.renew events so nginx reloads after every issuance and renewal.'));
			o.rawhtml = true;
			o.cfgvalue = () => '<span class="cert-dot cert-dot-ok">' + _('Enabled') + '</span>';

			o = s.option(form.DummyValue, '_nginx_webroot', _('HTTP-01 Webroot Rule (if not using DNS-01)'),
				_('luci-nginx redirects port 80 to 443 by default. If you use Webroot mode instead of DNS-01, add this location block to your HTTP server:'));
			o.rawhtml = true;
			o.cfgvalue = () => '<pre class="cert-code-box">location ^~ /.well-known/acme-challenge/ {\n    alias /var/run/cert/challenge/.well-known/acme-challenge/;\n}</pre>';
		}

		s = m.section(form.TypedSection, '_maintenance', _('ACME Client Maintenance'));
		s.anonymous = true;
		s.cfgsections = () => ['_maint'];

		o = s.option(form.DummyValue, '_cur_ver', _('Installed Version'));
		o.cfgvalue = () => (status.acmesh_version ? ('acme.sh v' + status.acmesh_version) : 'acme.sh') +
			(status.dnsapi_count ? (' (' + status.dnsapi_count + ' DNS APIs)') : '');

		o = s.option(form.Button, '_update_client', _('Online Client Update'),
			_('Fetch the latest acme.sh and DNS API scripts directly from GitHub (requires internet access).'));
		o.inputtitle = _('Update acme.sh & DNS APIs');
		o.inputstyle = 'action';
		o.onclick = function (ev) {
			let btn = ev.target;
			btn.disabled = true;
			btn.textContent = _('Updating...');
			return callServiceAction('update_client', '', '').then(res => {
				btn.disabled = false;
				btn.textContent = _('Update acme.sh & DNS APIs');
				if (res.code !== 0) {
					ui.addNotification(null, E('p', _('Update failed: %s').format(res.stderr || res.stdout || '')), 'error');
				} else {
					ui.addNotification(null, E('p', res.stdout || _('Updated acme.sh & DNS APIs.')), 'info');
					window.location.reload();
				}
			}).catch(err => {
				btn.disabled = false;
				btn.textContent = _('Update acme.sh & DNS APIs');
				ui.addNotification(null, E('p', err.message || String(err)), 'error');
			});
		};

		return m.render().then(node => {
			node.insertBefore(styleEl, node.firstChild);
			return node;
		});
	}
});

function _collectDdnsDomains() {
	let ddnsDomains = [];
	let ddnsServices = uci.sections('ddns', 'service');
	for (let ddnsService of ddnsServices) {
		if (!ddnsService['domain']) continue;
		let dnsApi = '';
		let credentials = [];
		switch (ddnsService.service_name) {
			case 'duckdns.org':
				dnsApi = 'dns_duckdns';
				credentials = ['DuckDNS_Token="' + (ddnsService['password'] || '') + '"'];
				break;
			case 'dynv6.com':
				dnsApi = 'dns_dynv6';
				credentials = ['DYNV6_TOKEN="' + (ddnsService['password'] || '') + '"'];
				break;
			case 'afraid.org-v2-basic':
				dnsApi = 'dns_freedns';
				credentials = [
					'FREEDNS_User="' + (ddnsService['username'] || '') + '"',
					'FREEDNS_Password="' + (ddnsService['password'] || '') + '"',
				];
				break;
			case 'cloudflare.com-v4':
				dnsApi = 'dns_cf';
				credentials = ['CF_Token="' + (ddnsService['password'] || '') + '"'];
				break;
		}
		if (credentials.length > 0) {
			ddnsDomains.push({
				sectionId: ddnsService['.name'],
				domains: [ddnsService['domain']],
				dnsApi: dnsApi,
				credentials: credentials,
			});
		}
	}
	return ddnsDomains;
}

function _importDdns(ddnsDomains) {
	let certSections = uci.sections('cert', 'cert');
	let certSectionNames = new Map();
	let certSectionDomains = new Map();
	for (let s of certSections) {
		certSectionNames.set(s['.name'], null);
		if (s.domains) {
			for (let d of s.domains) {
				certSectionDomains.set(d, s['.name']);
			}
		}
	}
	let importedDomains = {};
	let importedErrors = [];
	for (let ddnsDomain of ddnsDomains) {
		let sectionId = ddnsDomain.sectionId;
		if (certSectionNames.has(sectionId)) {
			sectionId += '_' + new Date().getTime();
		}
		if (ddnsDomain.domains) {
			for (let d of ddnsDomain.domains) {
				let dupDomainSection = certSectionDomains.get(d);
				if (dupDomainSection) {
					importedErrors.push(_('The domain %s in DDNS %s is already configured in %s.')
						.format(d, sectionId, dupDomainSection));
				}
			}
		}
		importedDomains[sectionId] = {
			'enabled': '1',
			'key_type': 'ec256',
			'staging': '0',
			'domains': ddnsDomain.domains,
			'validation_method': 'dns',
			'dns': ddnsDomain.dnsApi,
			'credentials': ddnsDomain.credentials,
		};
	}
	ui.showModal(_('Check the configurations of the added domain certificates'), [
		E('pre', { 'style': 'max-height:300px;overflow:auto;' }, JSON.stringify(importedDomains, null, 2)),
		E('p', importedErrors.join(' ')),
		E('div', { 'class': 'right' }, [
			E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Cancel')),
			' ',
			E('button', {
				'class': 'btn cbi-button-action',
				'click': ui.createHandlerFn(this, function () {
					for (let [sectionId, opts] of Object.entries(importedDomains)) {
						uci.add('cert', 'cert', sectionId);
						for (let [key, val] of Object.entries(opts)) {
							uci.set('cert', sectionId, key, val);
						}
					}
					uci.save().then(() => {
						window.location.href = L.url('admin/services/cert/overview');
					});
				})
			}, _('Save'))
		])
	]);
}
