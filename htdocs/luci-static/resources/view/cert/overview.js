'use strict';
'require form';
'require fs';
'require poll';
'require rpc';
'require uci';
'require ui';
'require view';
"require view.cert.dnsapi as dnsapi";

const callGetStatus = rpc.declare({
	object: 'luci.cert',
	method: 'get_status',
	expect: {}
});

const callGetDnsInfo = rpc.declare({
	object: 'luci.cert',
	method: 'get_dnsinfo',
	expect: { text: '' }
});

const callServiceAction = rpc.declare({
	object: 'luci.cert',
	method: 'service_action',
	params: ['action', 'arg1', 'arg2'],
	expect: { code: 1, stdout: '', stderr: '' }
});

let _statusBox = null;
let _certsBox = null;
let _latestStatus = {};
let _selectedTarget = null;

return view.extend({
	load() {
		return Promise.all([
			L.resolveDefault(callGetStatus(), {}),
			L.resolveDefault(callGetDnsInfo(), ''),
			L.resolveDefault(fs.lines('/proc/sys/kernel/hostname'), ''),
			L.resolveDefault(uci.load('cert')),
		]);
	},

	render(data) {
		_latestStatus = (data[0] && typeof data[0] === 'object') ? data[0] : {};
		let dnsApiInfoText = data[1] || '';
		let apiInfos = dnsapi.parseFile(dnsApiInfoText);
		let hasDnsApi = Boolean(_latestStatus.acmesh_present || (_latestStatus.dnsapi_count || 0) > 0);
		let hostname = data[2];
		let systemDomain = _guessDomain(hostname);
		let wikiInstructionUrl = 'https://github.com/acmesh-official/acme.sh/wiki/dnsapi';
		let m, s, o;

		let styleEl = E('style', {}, `
			#maincontent ul.tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; margin: 0 0 16px 0; border-radius: 8px; background: var(--background-color-medium); background: color-mix(in srgb, var(--background-color-low) 60%, var(--background-color-high)); border: 1px solid var(--border-color-low); background-image: none; background-size: auto; }
			#maincontent ul.tabs > li { height: auto !important; max-width: none; margin: 0 !important; border-radius: 6px; border: 1px solid transparent; background: transparent; background-image: none; color: var(--text-color-medium); transition: background 0.15s ease, color 0.15s ease; }
			#maincontent ul.tabs > li > a { padding: 6px 14px; line-height: 1.4; font-size: 13.5px; font-weight: 500; border-radius: 6px; background: transparent; }
			#maincontent ul.tabs > li:not(.active):hover { background: var(--background-color-high); background-image: none; color: var(--primary-color-high); }
			#maincontent ul.tabs > li.active { background: var(--background-color-high); background-image: none; border-color: var(--border-color-low); color: var(--primary-color-high); font-weight: 600; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08); }
			#maincontent #cbi-cert { background: transparent; border: none; border-radius: 0; padding: 0; margin-bottom: 16px; }
			#maincontent #cbi-cert > h2 { margin-top: 0 !important; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
			#cert_service_badge { font-size: 12px; padding: 3px 10px; line-height: 1.4; }
			#maincontent #cbi-cert > .cbi-map-descr { margin-bottom: 14px; }
			#maincontent #cert_status_panel, #maincontent .cert-tables-box { background: var(--background-color-medium); background: color-mix(in srgb, var(--background-color-low) 60%, var(--background-color-high)); border: 1px solid var(--border-color-low); border-radius: 10px; padding: 18px 20px; margin: 0 0 16px 0; }
			#maincontent .cert-tables-box { margin-bottom: 0; }
			#maincontent .cert-tables-box > #cbi-cert-cert { margin-top: 0 !important; }
			#modal_overlay > .modal.cbi-modal { border-radius: 10px; border: 1px solid var(--border-color-low); padding: 18px 22px 14px 22px; overflow: visible; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16); }
			#modal_overlay > .modal.cbi-modal > h4 { max-width: none; width: auto; font-size: 16px; font-weight: 600; margin: -18px -22px 16px -22px; padding: 14px 22px; border-radius: 10px 10px 0 0; background: var(--background-color-medium); border-bottom: 1px solid var(--border-color-low); color: var(--text-color-high); }
			#modal_overlay > .modal.cbi-modal #cbi-cert, #modal_overlay > .modal.cbi-modal .cbi-section { background: transparent; border: none; border-radius: 0; padding: 0; margin: 0; box-shadow: none; }
			#modal_overlay > .modal.cbi-modal .cbi-tabmenu { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; margin: 0 0 16px 0; border-radius: 8px; background: var(--background-color-medium); border: 1px solid var(--border-color-low); }
			#modal_overlay > .modal.cbi-modal .cbi-tabmenu > li { height: auto; margin: 0; border-radius: 6px; border: 1px solid transparent; background: transparent; color: var(--text-color-medium); transition: background 0.15s ease, color 0.15s ease; }
			#modal_overlay > .modal.cbi-modal .cbi-tabmenu > li > a { padding: 5px 13px; line-height: 1.4; font-size: 13px; border-radius: 6px; }
			#modal_overlay > .modal.cbi-modal .cbi-tabmenu > .cbi-tab-disabled:hover { background: var(--background-color-high); color: var(--primary-color-high); }
			#modal_overlay > .modal.cbi-modal .cbi-tabmenu > li:not(.cbi-tab-disabled) { background: var(--background-color-high); border-color: var(--border-color-low); color: var(--primary-color-high); font-weight: 600; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06); }
			#modal_overlay > .modal.cbi-modal .cbi-value { margin: 0; padding: 10px 0; border-bottom: 1px solid var(--border-color-low); }
			#modal_overlay > .modal.cbi-modal .cbi-value:last-child { border-bottom: none; }
			#modal_overlay > .modal.cbi-modal > .button-row { max-width: none; width: auto; margin: 14px -22px -14px -22px; padding: 12px 22px; border-radius: 0 0 10px 10px; background: var(--background-color-medium); border-top: 1px solid var(--border-color-low); }
			.cert-combo { position: relative; width: 100%; max-width: 460px; }
			.cert-combo-box { position: relative; display: flex; align-items: center; width: 100%; }
			.cert-combo-input { width: 100% !important; max-width: none !important; padding-right: 54px !important; box-sizing: border-box; }
			.cert-combo-actions { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: center; gap: 2px; }
			.cert-combo-btn { border: none; background: transparent; color: var(--text-color-medium); cursor: pointer; padding: 3px 6px; font-size: 13px; line-height: 1; border-radius: 4px; }
			.cert-combo-btn:hover { background: var(--background-color-medium); color: var(--text-color-high); }
			.cert-combo-menu { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 1200; background: var(--background-color-high); border: 1px solid var(--border-color-medium); border-radius: 8px; box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16); display: none; flex-direction: column; overflow: hidden; }
			.cert-combo-menu.open { display: flex; }
			.cert-combo-meta { padding: 6px 10px; font-size: 12px; color: var(--text-color-medium); background: var(--background-color-medium); border-bottom: 1px solid var(--border-color-low); }
			.cert-combo-list { max-height: 240px; overflow-y: auto; padding: 4px; }
			.cert-combo-item { padding: 7px 10px; border-radius: 6px; cursor: pointer; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--text-color-high); }
			.cert-combo-item:hover, .cert-combo-item.active { background: color-mix(in srgb, var(--primary-color-high) 10%, var(--background-color-high)); }
			.cert-combo-item.selected { font-weight: 600; color: var(--primary-color-high); }
			.cert-combo-id { font-size: 11px; color: var(--text-color-medium); font-family: monospace; white-space: nowrap; }
			.cert-combo-empty { padding: 14px 10px; text-align: center; font-size: 12px; color: var(--text-color-medium); }
			.cert-creds-wrap { width: 100%; max-width: 460px; }
			.cert-cred-hint { margin: 0 0 10px 0; padding: 6px 10px; border-radius: 6px; font-size: 12px; color: var(--text-color-medium); background: var(--background-color-medium); border: 1px solid var(--border-color-low); line-height: 1.45; }
			.cert-cred-row { margin-bottom: 10px; width: 100%; }
			.cert-cred-row:last-child { margin-bottom: 0; }
			.cert-cred-label { display: flex; align-items: center; gap: 6px; font-weight: 500; margin-bottom: 4px; flex-wrap: wrap; }
			.cert-cred-box { position: relative; display: flex; align-items: center; width: 100%; }
			.cert-cred-input { width: 100% !important; max-width: none !important; box-sizing: border-box; }
			.cert-cred-input.has-toggle { padding-right: 58px !important; }
			.cert-cred-toggle { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); border: none; background: transparent; color: var(--text-color-medium); cursor: pointer; padding: 3px 7px; font-size: 12px; line-height: 1.2; border-radius: 4px; }
			.cert-cred-toggle:hover { background: var(--background-color-medium); color: var(--text-color-high); }
			.cert-cred-warn { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; padding: 4px 8px; border-radius: 4px; font-size: 12px; color: var(--danger-color-high, #c9302c); background: color-mix(in srgb, var(--danger-color-high, #c9302c) 8%, var(--background-color-high)); border: 1px solid color-mix(in srgb, var(--danger-color-high, #c9302c) 24%, transparent); }
			.cert-cred-fix { border: 1px solid currentColor; background: transparent; color: inherit; cursor: pointer; padding: 1px 7px; border-radius: 4px; font-size: 11px; white-space: nowrap; }
			.cert-cred-fix:hover { background: color-mix(in srgb, var(--danger-color-high, #c9302c) 12%, transparent); }
			.cert-row-collapsed { display: none !important; }
			#modal_overlay > .modal.cbi-modal .cbi-value.cert-row-join-bottom { border-bottom: none !important; padding-bottom: 4px; }
			#modal_overlay > .modal.cbi-modal .cbi-value.cert-row-joined { border-top: none !important; padding-top: 4px; }
			.cert-cred-raw-link { display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; padding: 0; border: none; background: transparent; color: var(--text-color-medium); font-size: 12px; cursor: pointer; }
			.cert-cred-raw-link:hover { color: var(--primary-color-high); text-decoration: underline; }
			#cert_status_panel { margin-bottom: 0; }
			.cert-header-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
			.cert-header-bar h3 { margin: 0 !important; }
			.cert-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
			.cert-toolbar select { width: auto; min-width: 170px; max-width: 260px; height: 28px; padding: 2px 8px; font-size: 12.5px; border-radius: 3px; }
			.cert-toolbar .cbi-button[disabled] { opacity: 0.45; cursor: not-allowed; }
			.cert-summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 4px; }
			.cert-card { padding: 14px 16px; border-radius: 8px; border: 1px solid var(--border-color-low); background: var(--background-color-high); box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05); display: flex; flex-direction: column; justify-content: space-between; min-height: 90px; }
			.cert-card-ok { background: color-mix(in srgb, var(--success-color-high) 5%, var(--background-color-high)); border-color: color-mix(in srgb, var(--success-color-high) 18%, var(--border-color-low)); }
			.cert-card-info { background: color-mix(in srgb, var(--primary-color-high) 5%, var(--background-color-high)); border-color: color-mix(in srgb, var(--primary-color-high) 18%, var(--border-color-low)); }
			.cert-card-warn { background: color-mix(in srgb, var(--warn-color-high) 7%, var(--background-color-high)); border-color: color-mix(in srgb, var(--warn-color-high) 36%, var(--border-color-low)); }
			.cert-card-err { background: color-mix(in srgb, var(--error-color-high) 5.5%, var(--background-color-high)); border-color: color-mix(in srgb, var(--error-color-high) 26%, var(--border-color-low)); }
			.cert-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
			.cert-card-title { font-size: 12px; font-weight: 600; color: var(--text-color-medium); }
			.cert-card-body { display: flex; flex-direction: column; justify-content: space-between; gap: 6px; flex: 1 1 auto; }
			.cert-card-main { font-size: 18px; font-weight: 600; line-height: 1.3; color: var(--text-color-high); word-break: break-word; }
			.cert-card-sub { font-size: 12px; color: var(--text-color-medium); display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
			.cert-dot { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
			.cert-dot::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
			.cert-dot-ok { color: var(--success-color-low); background: rgba(var(--success-color-high-rgb), 0.12); }
			.cert-dot-info { color: var(--primary-color-low); background: rgba(25, 118, 210, 0.12); background: color-mix(in srgb, var(--primary-color-high) 12%, transparent); }
			.cert-dot-warn { color: var(--text-color-high); background: rgba(239, 189, 11, 0.22); background: color-mix(in srgb, var(--warn-color-high) 22%, transparent); }
			.cert-dot-warn::before { background: var(--warn-color-high); }
			.cert-dot-err { color: var(--error-color-low); background: rgba(var(--error-color-high-rgb), 0.12); }
			:root[data-darkmode="true"] .cert-dot-ok { color: var(--success-color-high); }
			:root[data-darkmode="true"] .cert-dot-info { color: var(--primary-color-high); }
			:root[data-darkmode="true"] .cert-dot-warn { color: var(--warn-color-low); }
			:root[data-darkmode="true"] .cert-dot-err { color: var(--error-color-high); }
			.cert-panel, #cbi-cert-cert { margin: 20px 0 0 0; padding: 0; border: none; border-radius: 0; background: transparent; overflow: visible; box-shadow: none; }
			.cert-panel-head, #cbi-cert-cert > h3 { display: inline-flex; min-width: 176px; height: 36px; box-sizing: border-box; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 8px 0 !important; padding: 0 14px; border: 1px solid color-mix(in srgb, var(--primary-color-high) 24%, var(--border-color-medium)); border-radius: 8px; background: color-mix(in srgb, var(--primary-color-high) 7%, var(--background-color-high)); font-size: 13.5px; font-weight: 600; line-height: 1.35; color: var(--primary-color-low); box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04); }
			.cert-panel-head h3 { margin: 0 !important; font-size: 13.5px; font-weight: 600; line-height: 1.35; color: inherit; }
			:root[data-darkmode="true"] .cert-panel-head, :root[data-darkmode="true"] #cbi-cert-cert > h3 { color: var(--primary-color-high); }
			.cert-panel-body { padding: 0; border-radius: 8px; border: 1px solid var(--border-color-medium); background: var(--background-color-high); overflow-x: auto; overflow-y: hidden; box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06); }
			#cbi-cert-cert > .cbi-section-descr { padding: 10px 16px 0 16px; margin: 0; }
			.cert-count-pill { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; color: var(--primary-color-low); background: var(--background-color-high); border: 1px solid color-mix(in srgb, var(--primary-color-high) 20%, transparent); }
			:root[data-darkmode="true"] .cert-count-pill { color: var(--primary-color-high); }
			.cert-panel .table.cbi-section-table, #cbi-cert-cert .table.cbi-section-table { border: none; border-radius: 0; border-collapse: collapse; margin-bottom: 0; }
			.cert-panel .tr.table-titles, #cbi-cert-cert .tr.cbi-section-table-titles { background: var(--background-color-medium); background: color-mix(in srgb, var(--background-color-low) 40%, var(--background-color-high)); }
			.cert-panel .tr.table-titles > .th, #cbi-cert-cert .tr.cbi-section-table-titles > .th, #cbi-cert-cert .cbi-section-table-titles.named::before { border-top: none; border-bottom: 1px solid var(--border-color-low); font-size: 11.5px; font-weight: 600; letter-spacing: 0.02em; color: var(--text-color-medium); padding: 9px 14px; background: transparent; white-space: nowrap; }
			.cert-panel .tr.table-titles:hover .th, #cbi-cert-cert .tr.cbi-section-table-titles:hover .th, #cbi-cert-cert .cbi-section-table-titles.named:hover::before { background: transparent; }
			.cert-panel .table.cbi-section-table .td, #cbi-cert-cert .table.cbi-section-table .td, #cbi-cert-cert .cbi-section-table-row[data-title]::before { border-top: 1px solid var(--border-color-low); padding: 10px 14px; vertical-align: middle; }
			.cert-panel .tr.table-titles + .tr > .td, #cbi-cert-cert .tr.cbi-section-table-titles + .tr > .td, #cbi-cert-cert .tr.cbi-section-table-titles + .cbi-section-table-row[data-title]::before { border-top: none; }
			.cert-panel .cbi-rowstyle-2, #cbi-cert-cert .cbi-rowstyle-2 { background: transparent; }
			.cert-panel .cbi-section-table .tr:not(.table-titles):not(.placeholder):hover .td, #cbi-cert-cert .cbi-section-table .tr:not(.cbi-section-table-titles):not(.placeholder):hover .td, #cbi-cert-cert .cbi-section-table .tr:not(.cbi-section-table-titles):not(.placeholder):hover::before { background-color: color-mix(in srgb, var(--primary-color-high) 3%, var(--background-color-high)); }
			.cert-panel .td.cbi-section-actions, .cert-panel .th.cbi-section-actions { width: 1%; white-space: nowrap; }
			.cert-panel .td.cbi-section-actions > * { display: inline-flex; flex-wrap: nowrap; gap: 6px; justify-content: flex-end; align-items: center; }
			.cert-panel .td.cbi-section-actions .cbi-button { flex: 0 0 auto; white-space: nowrap; }
			.cert-panel .tr.placeholder, #cbi-cert-cert .tr.placeholder { height: 52px; }
			.cert-panel .tr.placeholder > .td, #cbi-cert-cert .tr.placeholder > .td { line-height: 52px; padding: 0 16px; border-top: none; color: var(--text-color-medium); font-size: 12.5px; }
			#cbi-cert-cert .cbi-section-create { display: flex; align-items: center; padding: 10px 16px; margin: 0; gap: 8px; background: color-mix(in srgb, var(--background-color-low) 35%, var(--background-color-high)); border-top: 1px solid var(--border-color-low); width: 100%; }
			#cbi-cert-cert .cbi-section-create > * { flex: 0 0 auto; margin: 0; }
			.cert-tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
			.cert-tag-ok { color: var(--success-color-low); background: rgba(var(--success-color-high-rgb), 0.12); }
			.cert-tag-warn { color: var(--text-color-high); background: rgba(239, 189, 11, 0.22); background: color-mix(in srgb, var(--warn-color-high) 22%, transparent); }
			.cert-tag-err { color: var(--error-color-low); background: rgba(var(--error-color-high-rgb), 0.12); }
			.cert-tag-info { color: var(--primary-color-low); background: rgba(25, 118, 210, 0.12); background: color-mix(in srgb, var(--primary-color-high) 12%, transparent); }
			.cert-tag-muted { color: var(--text-color-medium); background: var(--background-color-low); }
			:root[data-darkmode="true"] .cert-tag-ok { color: var(--success-color-high); }
			:root[data-darkmode="true"] .cert-tag-warn { color: var(--warn-color-low); }
			:root[data-darkmode="true"] .cert-tag-err { color: var(--error-color-high); }
			:root[data-darkmode="true"] .cert-tag-info { color: var(--primary-color-high); }
			.cert-note { margin-top: 10px; padding: 8px 12px; border-radius: 4px; font-size: 12.5px; line-height: 1.5; border: 1px solid var(--border-color-low); border-left: 3px solid var(--warn-color-high); background: var(--background-color-medium); color: var(--text-color-high); }
			.cert-note-err { border-left-color: var(--error-color-high); }
			.cert-dns-meta { margin-bottom: 8px; font-size: 12px; opacity: 0.8; display: flex; flex-wrap: wrap; gap: 4px 12px; word-break: break-word; overflow-wrap: anywhere; }
			.cert-dns-meta code { word-break: break-all; }
			.cert-inline-line { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; max-width: 100%; }
			.cert-issuer-text { display: inline-block; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
			.cert-files-line { font-size: 12px; line-height: 1.5; white-space: nowrap; }
			.cert-files-line code { white-space: nowrap; }
			.cert-deploy-wrap { display: flex; flex-direction: column; gap: 12px; }
			.cert-deploy-card { border: 1px solid var(--border-color-low); border-radius: 8px; padding: 12px 14px; background: var(--background-color-high); }
			.cert-deploy-card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
			.cert-deploy-card-title { font-size: 13.5px; font-weight: 600; color: var(--text-color-high); display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
			.cert-deploy-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-top: 1px solid var(--border-color-low); }
			.cert-deploy-row:first-of-type { border-top: none; }
			.cert-deploy-path { font-size: 12px; color: var(--text-color-high); min-width: 0; flex: 1 1 240px; }
			.cert-deploy-path code { word-break: break-all; }
			.cert-deploy-btns { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; }
			.cert-deploy-target { border: 1px solid var(--border-color-low); border-radius: 6px; padding: 10px 12px; margin-top: 8px; background: color-mix(in srgb, var(--background-color-medium) 45%, var(--background-color-high)); }
			.cert-deploy-form { border: 1px solid color-mix(in srgb, var(--primary-color-high) 26%, var(--border-color-low)); border-radius: 8px; padding: 12px 14px; margin-top: 10px; background: color-mix(in srgb, var(--primary-color-high) 3%, var(--background-color-high)); }
			.cert-deploy-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
			.cert-deploy-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
			.cert-deploy-field.full { grid-column: 1 / -1; }
			.cert-deploy-field label { font-size: 12px; font-weight: 600; color: var(--text-color-medium); }
			.cert-deploy-field input:not([type="checkbox"]):not([type="radio"]), .cert-deploy-field select { width: 100%; max-width: none; box-sizing: border-box; }
			.cert-deploy-field label.cert-deploy-check { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12.5px; font-weight: 500; color: var(--text-color-high); }
			.cert-deploy-check input[type="checkbox"] { width: auto; height: auto; margin: 0; flex: 0 0 auto; }
			@media screen and (max-width: 860px) {
				.cert-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
			}
			@media screen and (max-width: 768px), screen and (max-device-width: 600px) {
				#maincontent ul.tabs { margin: 0 0 12px 0; padding: 4px; background: color-mix(in srgb, var(--background-color-low) 60%, var(--background-color-high)); background-image: none; }
				#maincontent ul.tabs > li { flex: 1 1 auto; justify-content: center; height: auto !important; }
				#maincontent ul.tabs > li > a { width: 100%; text-align: center; padding: 6px 10px; line-height: 1.35; font-size: 13px; }
				#maincontent #cert_status_panel, #maincontent .cert-tables-box { padding: 14px 12px; border-radius: 8px; margin-bottom: 12px; }
				.cert-header-bar { flex-direction: column; align-items: stretch; gap: 8px; }
				.cert-toolbar { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
				.cert-toolbar select { grid-column: 1 / -1; width: 100%; min-width: 0; max-width: none; height: 38px; font-size: 16px; box-sizing: border-box; }
				.cert-toolbar .cert-svc-btn, .cert-toolbar .cert-abort-btn { grid-column: 1 / -1; }
				.cert-toolbar .cbi-button { width: 100%; min-height: 36px; margin: 0; box-sizing: border-box; text-align: center; }
				.cert-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
				.cert-card { min-height: 82px; padding: 12px 13px; }
				.cert-card-main { font-size: 16px; }
				.cert-panel, #cbi-cert-cert { margin-top: 14px; }
				.cert-panel-head, #cbi-cert-cert > h3 { min-width: 152px; max-width: 100%; height: 34px; padding: 0 12px; font-size: 13px; margin-bottom: 6px !important; }
				.cert-panel .table.cbi-section-table, #cbi-cert-cert .table.cbi-section-table { display: flex; flex-direction: column; width: 100%; }
				.cert-panel .tr.table-titles, #cbi-cert-cert .tr.cbi-section-table-titles { display: none !important; }
				.cert-panel .tr:not(.table-titles):not(.placeholder), #cbi-cert-cert .tr:not(.cbi-section-table-titles):not(.placeholder) { display: flex; flex-wrap: wrap; align-items: flex-start; padding: 10px 12px; margin: 0; border-top: 1px solid var(--border-color-low); gap: 6px 10px; }
				.cert-panel .tr.table-titles + .tr, #cbi-cert-cert .tr.cbi-section-table-titles + .tr { border-top: none; }
				.cert-panel .tr:not(.placeholder) > .td, #cbi-cert-cert .tr:not(.placeholder) > .td { flex: 1 1 calc(50% - 10px); min-width: 130px; padding: 3px 0; border-top: none !important; font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; word-break: break-word; }
				.cert-inline-line, .cert-files-line, .cert-files-line code { white-space: normal; word-break: break-all; flex-wrap: wrap; }
				.cert-issuer-text { max-width: 100%; white-space: normal; }
				.cert-panel .td[data-title]::before, #cbi-cert-cert .td[data-title]::before { content: attr(data-title); display: block; font-size: 11px; font-weight: 600; color: var(--text-color-medium); margin-bottom: 2px; }
				.cert-panel .td.cbi-section-actions, #cbi-cert-cert .td.cbi-section-actions { flex: 1 1 100% !important; width: 100%; max-width: 100%; padding: 8px 0 2px 0; border-top: 1px dashed var(--border-color-low) !important; text-align: left; white-space: normal; }
				.cert-panel .td.cbi-section-actions > *, #cbi-cert-cert .td.cbi-section-actions > * { display: flex !important; flex-wrap: wrap; justify-content: flex-end; gap: 6px; width: 100%; }
				.cert-panel .td.cbi-section-actions .cbi-button, #cbi-cert-cert .td.cbi-section-actions .cbi-button { width: auto; flex: 1 1 auto; min-height: 34px; text-align: center; }
				#cbi-cert-cert .cbi-section-create { padding: 10px 12px; flex-wrap: wrap; box-sizing: border-box; }
				#cbi-cert-cert .cbi-section-create > div, #cbi-cert-cert .cbi-section-create input[type="text"] { flex: 1 1 180px; width: 100%; min-width: 0; font-size: 16px; min-height: 36px; box-sizing: border-box; }
				#cbi-cert-cert .cbi-section-create .cbi-button { min-height: 36px; }
				#modal_overlay > .modal.cbi-modal { width: calc(100vw - 20px) !important; max-width: none !important; margin: 10px auto; padding: 14px 14px 12px 14px; border-radius: 10px; }
				#modal_overlay > .modal.cbi-modal > h4 { margin: -14px -14px 12px -14px; padding: 12px 14px; font-size: 15px; }
				#modal_overlay > .modal.cbi-modal > .button-row { margin: 12px -14px -12px -14px; padding: 10px 14px; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
				#modal_overlay > .modal.cbi-modal .cbi-tabmenu > li { flex: 1 1 auto; text-align: center; height: auto !important; }
				#modal_overlay > .modal.cbi-modal .cbi-tabmenu > li > a { padding: 6px 10px; line-height: 1.35; font-size: 12.5px; }
				#modal_overlay > .modal.cbi-modal .cbi-value { display: flex; flex-direction: column; align-items: stretch; gap: 4px; }
				#modal_overlay > .modal.cbi-modal .cbi-value > label.cbi-value-title { width: 100% !important; text-align: left !important; padding: 0 !important; margin-bottom: 2px; }
				#modal_overlay > .modal.cbi-modal .cbi-value > .cbi-value-field { width: 100% !important; margin-left: 0 !important; }
				.cert-combo, .cert-creds-wrap { max-width: 100%; }
				.cert-combo-input, .cert-cred-input { font-size: 16px !important; min-height: 38px; }
				.cert-combo-list { max-height: 42vh; }
				.cert-combo-item { padding: 9px 10px; }
			}
			@media screen and (max-width: 520px) {
				.cert-summary-grid { grid-template-columns: 1fr; }
				.cert-panel .tr:not(.placeholder) > .td, #cbi-cert-cert .tr:not(.placeholder) > .td { flex: 1 1 100%; }
				#modal_overlay > .modal.cbi-modal > .button-row > .btn, #modal_overlay > .modal.cbi-modal > .button-row > .cbi-button { flex: 1 1 auto; }
				.cert-deploy-grid { grid-template-columns: 1fr; }
			}
		`);

		m = new form.Map('cert', _('Certificate Management Service'),
			_('Manage automated ACME certificates, monitor renewal health, and bind certificates to luci-nginx.')
		);

		// 1. Runtime Summary & Actions Card
		s = m.section(form.TypedSection, '_status_panel');
		s.render = L.bind(function () {
			_statusBox = E('div', { 'id': 'cert_status_panel', 'class': 'cbi-section' });
			_statusBox.appendChild(styleEl);
			let inner = E('div', { 'id': 'cert_status_inner' });
			_statusBox.appendChild(inner);
			_renderStatusPanel(inner, _latestStatus, m);
			return _statusBox;
		}, this);

		// 2. Certificate Configurations (GridSection)
		s = m.section(form.GridSection, 'cert', _('Certificate Configurations'));
		s.anonymous = false;
		s.addremove = true;
		s.nodescriptions = true;
		let _origCertSectionRender = s.render;
		s.render = function () {
			return Promise.resolve(_origCertSectionRender.apply(this, arguments)).then(sectionEl => {
				if (sectionEl && !sectionEl.querySelector(':scope > .cert-panel-body')) {
					let body = E('div', { 'class': 'cert-panel-body' });
					for (let ch of Array.from(sectionEl.childNodes)) {
						if (ch.nodeType === 1 && (ch.tagName === 'H3' || ch.classList.contains('cbi-section-descr'))) {
							continue;
						}
						body.appendChild(ch);
					}
					sectionEl.appendChild(body);
				}
				return sectionEl;
			});
		};

		o = s.tab('general', _('General Settings'));
		o = s.tab('challenge_dns', _('DNS Challenge Validation'));
		o = s.tab('challenge_webroot', _('Webroot Challenge Validation'));
		o = s.tab('advanced', _('Advanced Settings'));

		// --- Tab 1: General Settings ---
		o = s.taboption('general', form.Flag, 'enabled', _('Enabled'));
		o.default = '1';
		o.rmempty = false;

		let portWarning = [];
		let webServerName = _latestStatus.nginx_running ? 'nginx' : 'uhttpd/webserver';
		if (_latestStatus.ports && _latestStatus.ports['80']) {
			portWarning.push(_('Port 80 is occupied by %s; Standalone on port 80 will fail.').format(webServerName));
		}
		if (_latestStatus.ports && _latestStatus.ports['443']) {
			portWarning.push(_('Port 443 is occupied by %s; TLS-ALPN on port 443 will fail.').format(webServerName));
		}

		o = s.taboption('general', form.ListValue, 'validation_method', _('Validation method'),
			_('DNS-01 is recommended when running luci-nginx (no port conflict, supports wildcards).') +
			(portWarning.length ? '<br /><span style="display:inline-block;margin-top:4px;font-size:12px;color:var(--text-color-medium);">' + portWarning.join(' ') + '</span>' : '')
		);
		o.value('dns', 'DNS-01 ' + _('DNS Challenge Validation'));
		o.value('webroot', 'HTTP-01 ' + _('Webroot Challenge Validation'));
		o.value('standalone', 'HTTP-01 ' + _('Standalone'));
		o.value('alpn', 'TLS-ALPN-01 ' + _('Validation via TLS ALPN'));
		o.default = hasDnsApi ? 'dns' : 'webroot';

		o = s.taboption('general', form.Value, 'listen_port', _('Listen port'),
			_('Port temporarily opened during HTTP-01 / TLS-ALPN-01 validation.'));
		o.optional = true;
		o.placeholder = '80';
		o.datatype = 'port';
		o.depends('validation_method', 'standalone');
		o.depends('validation_method', 'webroot');
		o.depends('validation_method', 'alpn');
		o.modalonly = true;

		o = s.taboption('general', form.DynamicList, 'domains', _('Domain names'),
			_('Primary domain first, followed by optional Subject Alternative Names (SANs).'));
		o.datatype = 'list(string)';
		o.placeholder = 'example.com';
		if (systemDomain) {
			o.default = [systemDomain];
		}
		o.validate = function (section_id, value) {
			if (!value) return true;
			let v = value.trim();
			if (!/^(\*\.)?[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(v) || v.indexOf('.') < 0) {
				return _('Invalid domain. Example: example.com or *.example.com');
			}
			if (v.startsWith('*.')) {
				let methodOpt = this.section.children.find(c => c.option == 'validation_method');
				let method = methodOpt ? methodOpt.formvalue(section_id) : '';
				if (method && method !== 'dns') {
					return _('Wildcard domains (*.example.com) require DNS-01 validation');
				}
			}
			return true;
		};

		// --- Tab 2: DNS Challenge Validation ---
		o = s.taboption('challenge_dns', form.ListValue, 'dns', _('DNS API'),
			_('Select the DNS provider plugin matching your domain host.'));
		o.depends('validation_method', 'dns');
		o.value('', _('-- Please select DNS provider --'));
		for (let info of apiInfos) {
			let title = info.Name;
			if (info.Domains) {
				title += ' (' + info.Domains + ')';
			}
			o.value(info.Id, title);
		}
		o.modalonly = true;
		o.renderWidget = function (section_id, option_index, cfgvalue) {
			let widgetEl = form.ListValue.prototype.renderWidget.call(this, section_id, option_index, cfgvalue);
			let selectEl = (widgetEl.tagName === 'SELECT') ? widgetEl : (widgetEl.querySelector ? widgetEl.querySelector('select') : null);
			if (!selectEl) return widgetEl;
			return _createDnsCombobox(widgetEl, selectEl, apiInfos);
		};
		o.onchange = function (event, section_id, newVal) {
			_handleCheckService(event, section_id, newVal);
			_renderActiveDnsFields(this.map, section_id, apiInfos);
		};

		o = s.taboption('challenge_dns', form.DummyValue, '_wiki_url', _('Documentation'));
		o.rawhtml = true;
		o.default = '<a id="wikiInstructionUrl" href="%s" target="_blank" rel="noreferrer">acme.sh DNS API Wiki</a>'
			.format(wikiInstructionUrl);
		o.depends('validation_method', 'dns');
		o.modalonly = true;

		o = s.taboption('challenge_dns', form.Flag, '_dns_options_alt', _('Alternative DNS API options'));
		o.depends('validation_method', 'dns');
		o.modalonly = true;
		o.cfgvalue = function (section_id) {
			let dnsId = uci.get('cert', section_id, 'dns');
			if (!dnsId) return '0';
			let info = apiInfos.find(a => a.Id === dnsId);
			if (!info || !info.OptsAlt || info.OptsAlt.length === 0) return '0';
			let creds = _parseKeyValueListToMap(uci.get('cert', section_id, 'credentials'));
			let hasAlt = info.OptsAlt.some(opt => creds.has(opt.Name));
			let hasMain = info.Opts.some(opt => creds.has(opt.Name));
			return (hasAlt && !hasMain) ? '1' : '0';
		};
		o.onchange = function (event, section_id) {
			_renderActiveDnsFields(this.map, section_id, apiInfos);
		};
		o.write = function () { };

		o = s.taboption('challenge_dns', form.DummyValue, '_dns_creds_builder', _('Provider Credentials'));
		o.depends('validation_method', 'dns');
		o.modalonly = true;
		o.renderWidget = function (section_id) {
			let container = E('div', { 'id': 'dns_creds_builder_' + section_id, 'class': 'cert-creds-wrap' });
			setTimeout(() => _renderActiveDnsFields(this.map, section_id, apiInfos), 0);
			return container;
		};
		o.write = function () { };

		o = s.taboption('challenge_dns', form.DynamicList, 'credentials', _('Raw credentials list'),
			_('Stored as KEY="VAL" entries (automatically synced with Provider Credentials above).'));
		o.datatype = 'list(string)';
		o.placeholder = 'CF_Token="your_api_token"';
		o.depends('validation_method', 'dns');
		o.modalonly = true;
		o.validate = _validateRawCredentialEntry;
		o.parse = function (section_id) {
			if (this.isActive(section_id)) {
				let builder = document.getElementById('dns_creds_builder_' + section_id);
				if (builder) {
					if (typeof builder._flushCredSync === 'function') {
						builder._flushCredSync();
					}
					if (builder.querySelector('.cert-cred-input.cbi-input-invalid')) {
						return Promise.reject(new TypeError(
							_('Please fix the credential format warning in Provider Credentials before saving.')
						));
					}
				}
			}
			return form.DynamicList.prototype.parse.call(this, section_id);
		};
		o.onchange = function (event, section_id) {
			if (this.map && this.map._syncingCreds) return;
			_renderActiveDnsFields(this.map, section_id, apiInfos);
		};

		o = s.taboption('challenge_dns', form.Value, 'dns_wait', _('Wait for DNS update'),
			_('Seconds to wait after adding TXT record (recommended 30-60s if public DoH propagation checks fail or hang).'));
		o.optional = true;
		o.placeholder = '30';
		o.datatype = 'uinteger';
		o.depends('validation_method', 'dns');
		o.modalonly = true;

		o = s.taboption('challenge_dns', form.Value, 'calias', _('Challenge Alias'));
		o.optional = true;
		o.placeholder = 'verify.example.com';
		o.depends('validation_method', 'dns');
		o.modalonly = true;

		o = s.taboption('challenge_dns', form.Value, 'dalias', _('Domain Alias'));
		o.optional = true;
		o.placeholder = 'alias.example.com';
		o.depends('validation_method', 'dns');
		o.modalonly = true;

		// --- Tab 3: Webroot Challenge Validation ---
		o = s.taboption('challenge_webroot', form.Value, 'webroot', _('Webroot directory'),
			_('Document root for HTTP-01 webroot validation. Default: /var/run/cert/challenge/'));
		o.optional = true;
		o.placeholder = '/var/run/cert/challenge/';
		o.depends('validation_method', 'webroot');
		o.modalonly = true;

		// --- Tab 4: Advanced Settings ---
		o = s.taboption('advanced', form.ListValue, 'key_type', _('Key type'),
			_('Algorithm and key length for the generated certificate.'));
		o.value('ec256', _('ECC 256 bits'));
		o.value('ec384', _('ECC 384 bits'));
		o.value('rsa2048', _('RSA 2048 bits'));
		o.value('rsa3072', _('RSA 3072 bits'));
		o.value('rsa4096', _('RSA 4096 bits'));
		o.default = 'ec256';
		o.rmempty = false;
		o.optional = false;
		o.modalonly = true;
		o.cfgvalue = function () {
			return this.super('cfgvalue', arguments) || 'ec256';
		};

		o = s.taboption('advanced', form.Value, 'acme_server', _('ACME server / CA'),
			_('Choose a built-in CA or enter a custom ACME directory URL (defaults to Let\'s Encrypt).'));
		o.value('', _('Let\'s Encrypt (Default)'));
		o.value('zerossl', 'ZeroSSL');
		o.value('google', 'Google Trust Services (requires EAB)');
		o.value('buypass', 'Buypass');
		o.value('sslcom', 'SSL.com (requires EAB)');
		o.placeholder = 'letsencrypt';
		o.optional = true;
		o.modalonly = true;

		o = s.taboption('advanced', form.Flag, 'staging', _('Use staging server'),
			_('Issue test certificate from Let\'s Encrypt staging server (untrusted by browsers).'));
		o.depends('acme_server', '');
		o.default = '0';
		o.optional = true;
		o.modalonly = true;

		o = s.taboption('advanced', form.Value, 'eab_kid', _('EAB Key ID'),
			_('External Account Binding KID (required by Google Trust Services, ZeroSSL API EAB, Sectigo, etc.).'));
		o.optional = true;
		o.placeholder = 'eab-kid-...';
		o.modalonly = true;

		o = s.taboption('advanced', form.Value, 'eab_hmac_key', _('EAB HMAC Key'),
			_('External Account Binding HMAC key.'));
		o.password = true;
		o.optional = true;
		o.placeholder = 'base64url HMAC key';
		o.modalonly = true;

		o = s.taboption('advanced', form.Value, 'days', _('Days until renewal'));
		o.optional = true;
		o.placeholder = '60';
		o.datatype = 'uinteger';
		o.modalonly = true;

		o = s.taboption('advanced', form.Value, 'cert_profile', _('Certificate Profile'),
			_('Optional ACME certificate profile (e.g. classic, tlsserver, shortlived).'));
		o.optional = true;
		o.placeholder = 'classic';
		o.modalonly = true;

		// 3. Certificate Tasks & Issued Certificates
		s = m.section(form.GridSection, '_certificates');
		s.render = L.bind(function () {
			_certsBox = E('div', { 'id': 'cert_certs_panel' });
			_renderCertsPanel(_certsBox, _latestStatus, m);
			return _certsBox;
		}, this);

		poll.add(() => _refreshStatus(m), 5);

		let _origRenderContents = m.renderContents;
		m.renderContents = function () {
			return Promise.resolve(_origRenderContents.apply(this, arguments)).then(node => {
				let h2 = node.querySelector(':scope > h2');
				if (h2 && !h2.querySelector('#cert_service_badge')) {
					h2.appendChild(E('span', { 'id': 'cert_service_badge', 'class': 'cert-dot' }));
				}
				_updateHeaderServiceBadge(_latestStatus, node);
				let certSec = node.querySelector('#cbi-cert-cert');
				let certsPanel = node.querySelector('#cert_certs_panel');
				if (certSec && certsPanel && !certSec.parentElement.classList.contains('cert-tables-box')) {
					let tablesBox = E('div', { 'class': 'cert-tables-box' });
					certSec.parentNode.insertBefore(tablesBox, certSec);
					tablesBox.appendChild(certSec);
					tablesBox.appendChild(certsPanel);
				}
				let addInput = node.querySelector('#cbi-cert-cert .cbi-section-create input[type="text"]');
				if (addInput && !addInput.placeholder) {
					addInput.placeholder = _('Section name (e.g. my_cert)');
				}
				return node;
			});
		};

		return m.render();
	}
});

function _parseStatusJson(raw) {
	try {
		if (!raw || typeof raw !== 'string') return {};
		return JSON.parse(raw);
	} catch (e) {
		return {};
	}
}

function _refreshStatus(mapObj) {
	return L.resolveDefault(callGetStatus(), {}).then(st => {
		_latestStatus = (st && typeof st === 'object') ? st : {};
		let statusInner = document.getElementById('cert_status_inner');
		if (statusInner) {
			_renderStatusPanel(statusInner, _latestStatus, mapObj);
		}
		if (_certsBox) {
			_renderCertsPanel(_certsBox, _latestStatus, mapObj);
		}
	});
}

function _runInitAction(action, sectionId, mapObj, saveFirst, btnEl, busyLabel) {
	let origText = btnEl ? btnEl.textContent : '';
	if (btnEl) {
		btnEl.disabled = true;
		if (busyLabel) btnEl.textContent = busyLabel;
	}
	let prep = (saveFirst && mapObj) ? mapObj.save() : Promise.resolve();
	return prep.then(() => {
		return callServiceAction(action, sectionId || '', '');
	}).then(res => {
		if (btnEl) {
			btnEl.disabled = false;
			btnEl.textContent = origText;
		}
		if (res.code !== 0) {
			ui.addNotification(null, E('p', _('Action "%s" failed (%d): %s').format(action, res.code, res.stderr || res.stdout || '')), 'error');
		} else {
			ui.addNotification(null, E('p', res.stdout || _('Action "%s" executed.').format(action)), 'info');
			if (action === 'update_client') {
				window.location.reload();
				return;
			}
		}
		setTimeout(() => _refreshStatus(mapObj), 600);
	}).catch(err => {
		if (btnEl) {
			btnEl.disabled = false;
			btnEl.textContent = origText;
		}
		ui.addNotification(null, E('p', _('Failed to run %s: %s').format(action, err.message || err)), 'error');
	});
}

function _setServiceState(enable, btnEl, mapObj) {
	let origText = btnEl ? btnEl.textContent : '';
	if (btnEl) {
		btnEl.disabled = true;
		btnEl.textContent = enable ? _('Enabling...') : _('Stopping...');
	}
	let first = enable ? 'enable' : 'stop';
	let second = enable ? 'start' : 'disable';
	return callServiceAction(first, '', '')
		.then(res1 => {
			if (res1 && res1.code !== 0) return res1;
			return callServiceAction(second, '', '');
		})
		.then(res => {
			if (btnEl) {
				btnEl.disabled = false;
				btnEl.textContent = origText;
			}
			if (res && res.code !== 0) {
				ui.addNotification(null, E('p',
					(enable ? _('Failed to start cert service: %s') : _('Failed to stop cert service: %s'))
						.format(res.stderr || res.stdout || '')), 'error');
			}
			return _refreshStatus(mapObj);
		}).catch(err => {
			if (btnEl) {
				btnEl.disabled = false;
				btnEl.textContent = origText;
			}
			ui.addNotification(null, E('p', err.message || String(err)), 'error');
		});
}

function _isServiceRunning(status) {
	return Boolean(status && status.service_enabled && status.cron_running && status.cron_entry);
}

function _updateHeaderServiceBadge(status, rootNode) {
	let badge = (rootNode ? rootNode.querySelector('#cert_service_badge') : null)
		|| document.getElementById('cert_service_badge');
	if (!badge) return;
	let isRunning = _isServiceRunning(status);
	badge.className = 'cert-dot ' + (isRunning ? 'cert-dot-ok' : 'cert-dot-err');
	badge.textContent = isRunning ? _('Running') : _('Stopped');
}

function _copyTextToClipboard(text, btnEl) {
	let orig = btnEl ? btnEl.textContent : '';
	let markCopied = () => {
		if (!btnEl) return;
		btnEl.textContent = _('Copied');
		setTimeout(() => { btnEl.textContent = orig; }, 1400);
	};
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(text).then(markCopied).catch(() => {});
		return;
	}
	let ta = E('textarea', { 'style': 'position:fixed;left:-9999px;top:0;' }, text);
	document.body.appendChild(ta);
	ta.select();
	try { document.execCommand('copy'); markCopied(); } catch (e) {}
	document.body.removeChild(ta);
}

function _downloadCertFile(filePath, filename, btnEl) {
	if (btnEl) btnEl.disabled = true;
	return fs.read_direct(filePath).then(content => {
		let blob = new Blob([content || ''], { type: 'application/x-pem-file' });
		let url = URL.createObjectURL(blob);
		let a = E('a', { 'href': url, 'download': filename });
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}).catch(err => {
		ui.addNotification(null, E('p', _('Failed to read %s: %s').format(filePath, err.message || err)), 'error');
	}).finally(() => {
		if (btnEl) btnEl.disabled = false;
	});
}

function _showDeployModal(domain, mapObj) {
	let bodyWrap = E('div', { 'class': 'cert-deploy-wrap' });
	let editingId = null;
	let showForm = false;
	let modalStatus = null;

	function setBanner(isErr, msg) {
		modalStatus = msg ? { isErr: !!isErr, msg: msg } : null;
	}

	function execCertCmd(args, btnEl, busyText) {
		let orig = btnEl ? btnEl.textContent : '';
		if (btnEl) {
			btnEl.disabled = true;
			if (busyText) btnEl.textContent = busyText;
		}
		return callServiceAction(args[0], args[1] || '', args[2] || '').then(res => {
			if (res.code !== 0) {
				setBanner(true, res.stderr || res.stdout || _('Command failed (%d)').format(res.code));
			} else {
				setBanner(false, res.stdout || _('Operation completed.'));
			}
			return _refreshStatus(mapObj);
		}).catch(err => {
			setBanner(true, err.message || String(err));
		}).finally(() => {
			if (btnEl) {
				btnEl.disabled = false;
				btnEl.textContent = orig;
			}
			renderBody();
		});
	}

	function renderTargetForm(targets) {
		let existing = editingId ? targets.find(t => t['.name'] === editingId) : null;
		let nameIn = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': existing ? (existing.name || '') : '', 'placeholder': _('e.g. uHTTPd / HAProxy / WebDAV') });
		let enabledCb = E('input', { 'type': 'checkbox', 'checked': (!existing || existing.enabled !== '0') ? 'checked' : null });
		let methodSel = E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'copy', 'selected': (!existing || existing.method !== 'symlink') ? 'selected' : null }, _('Copy file (Recommended)')),
			E('option', { 'value': 'symlink', 'selected': (existing && existing.method === 'symlink') ? 'selected' : null }, _('Symbolic link'))
		]);
		let fullchainIn = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': existing ? (existing.fullchain_path || '') : '', 'placeholder': '/etc/uhttpd.crt' });
		let keyIn = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': existing ? (existing.key_path || '') : '', 'placeholder': '/etc/uhttpd.key' });
		let certIn = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': existing ? (existing.cert_path || '') : '', 'placeholder': '/etc/myapp/cert.crt' });
		let combinedIn = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': existing ? (existing.combined_path || '') : '', 'placeholder': '/etc/haproxy/cert.pem' });
		let reloadIn = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': existing ? (existing.reload_cmd || '') : '', 'placeholder': '/etc/init.d/uhttpd reload' });

		let presetSel = E('select', {
			'class': 'cbi-input-select',
			'change': function () {
				if (this.value === 'uhttpd') {
					nameIn.value = 'uHTTPd';
					fullchainIn.value = '/etc/uhttpd.crt';
					keyIn.value = '/etc/uhttpd.key';
					certIn.value = '';
					combinedIn.value = '';
					reloadIn.value = '/etc/init.d/uhttpd reload';
				} else if (this.value === 'haproxy') {
					nameIn.value = 'HAProxy';
					fullchainIn.value = '';
					keyIn.value = '';
					certIn.value = '';
					combinedIn.value = '/etc/haproxy/cert.pem';
					reloadIn.value = '/etc/init.d/haproxy reload';
				}
			}
		}, [
			E('option', { 'value': '' }, _('-- Apply Preset (Optional) --')),
			E('option', { 'value': 'uhttpd' }, _('uHTTPd (/etc/uhttpd.crt + .key)')),
			E('option', { 'value': 'haproxy' }, _('HAProxy (/etc/haproxy/cert.pem)'))
		]);

		function validatePathField(p) {
			if (!p) return true;
			if (!p.startsWith('/') || p.indexOf('..') >= 0 || p.startsWith('/etc/ssl/cert/')) return false;
			return /^[A-Za-z0-9_./@-]+$/.test(p);
		}

		function saveTarget(deployNow, btnEl) {
			let fc = fullchainIn.value.trim();
			let kp = keyIn.value.trim();
			let cp = certIn.value.trim();
			let cmb = combinedIn.value.trim();
			let rcmd = reloadIn.value.trim();
			if (!fc && !kp && !cp && !cmb) {
				setBanner(true, _('Please enter at least one destination certificate or key path.'));
				renderBody();
				return;
			}
			for (let p of [fc, kp, cp, cmb]) {
				if (!validatePathField(p)) {
					setBanner(true, _('Invalid destination path "%s": must be an absolute path outside /etc/ssl/cert/.').format(p));
					renderBody();
					return;
				}
			}
			if (/[\r\n]/.test(rcmd)) {
				setBanner(true, _('Reload command must be a single line.'));
				renderBody();
				return;
			}
			if (btnEl) btnEl.disabled = true;
			let sid = existing ? existing['.name'] : uci.add('cert', 'deploy');
			uci.set('cert', sid, 'domain', domain);
			uci.set('cert', sid, 'name', nameIn.value.trim() || sid);
			uci.set('cert', sid, 'enabled', enabledCb.checked ? '1' : '0');
			uci.set('cert', sid, 'method', methodSel.value || 'copy');
			if (fc) uci.set('cert', sid, 'fullchain_path', fc); else uci.unset('cert', sid, 'fullchain_path');
			if (kp) uci.set('cert', sid, 'key_path', kp); else uci.unset('cert', sid, 'key_path');
			if (cp) uci.set('cert', sid, 'cert_path', cp); else uci.unset('cert', sid, 'cert_path');
			if (cmb) uci.set('cert', sid, 'combined_path', cmb); else uci.unset('cert', sid, 'combined_path');
			if (rcmd) uci.set('cert', sid, 'reload_cmd', rcmd); else uci.unset('cert', sid, 'reload_cmd');

			return uci.save().then(() => uci.apply()).then(() => uci.load('cert')).then(() => {
				showForm = false;
				editingId = null;
				if (deployNow) {
					return execCertCmd(['deploy', domain, sid], btnEl, _('Installing...'));
				}
				setBanner(false, _('Deploy target saved.'));
				return _refreshStatus(mapObj).then(() => renderBody());
			}).catch(err => {
				if (btnEl) btnEl.disabled = false;
				setBanner(true, err.message || String(err));
				renderBody();
			});
		}

		return E('div', { 'class': 'cert-deploy-form' }, [
			E('div', { 'style': 'font-weight:600;margin-bottom:8px;' },
				existing ? _('Edit Deploy Target') : _('Add Deploy Target')),
			E('div', { 'class': 'cert-deploy-grid' }, [
				!existing ? E('div', { 'class': 'cert-deploy-field full' }, [
					E('label', {}, _('Quick Preset')),
					presetSel
				]) : '',
				E('div', { 'class': 'cert-deploy-field' }, [
					E('label', {}, _('Target Name')),
					nameIn
				]),
				E('div', { 'class': 'cert-deploy-field' }, [
					E('label', {}, _('Install Method')),
					methodSel
				]),
				E('div', { 'class': 'cert-deploy-field' }, [
					E('label', {}, _('Fullchain Path')),
					fullchainIn
				]),
				E('div', { 'class': 'cert-deploy-field' }, [
					E('label', {}, _('Private Key Path')),
					keyIn
				]),
				E('div', { 'class': 'cert-deploy-field' }, [
					E('label', {}, _('Cert Path (Leaf only, optional)')),
					certIn
				]),
				E('div', { 'class': 'cert-deploy-field' }, [
					E('label', {}, _('Combined PEM Path (optional)')),
					combinedIn
				]),
				E('div', { 'class': 'cert-deploy-field full' }, [
					E('label', {}, _('Reload Command (optional)')),
					reloadIn
				]),
				E('div', { 'class': 'cert-deploy-field full' }, [
					E('label', { 'class': 'cert-deploy-check' }, [
						enabledCb,
						E('span', {}, _('Enable automatic deployment on certificate issuance and renewal'))
					])
				])
			]),
			E('div', { 'class': 'cert-deploy-btns', 'style': 'margin-top:10px;justify-content:flex-end;width:100%;' }, [
				E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-neutral', 'click': () => { showForm = false; editingId = null; renderBody(); } }, _('Cancel')),
				E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-action', 'click': function () { saveTarget(false, this); } }, _('Save')),
				E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-positive important', 'click': function () { saveTarget(true, this); } }, _('Save & Install Now'))
			])
		]);
	}

	function renderBody() {
		while (bodyWrap.firstChild) bodyWrap.removeChild(bodyWrap.firstChild);

		if (modalStatus) {
			bodyWrap.appendChild(E('div', {
				'class': 'cert-note ' + (modalStatus.isErr ? 'cert-note-err' : ''),
				'style': 'margin-top:0;' + (!modalStatus.isErr ? 'border-left-color:var(--success-color-high);' : '')
			}, modalStatus.msg));
		}

		// 1. LuCI Web / luci-nginx Binding
		let servers = Array.isArray(_latestStatus.nginx_servers) ? _latestStatus.nginx_servers : [];
		if (servers.length > 0) {
			let selectedSrvName = servers.some(s => s.name === '_lan') ? '_lan' : servers[0].name;
			let srvStatusSpan = E('span', {});
			let srvBindBtn = E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-action important' });
			let srvRestoreBtn = E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-neutral' });

			function updateSrvControls() {
				let cur = servers.find(s => s.name === selectedSrvName) || servers[0];
				let isThisBound = cur && cur.bound_domain === domain;
				let isLan = (selectedSrvName === '_lan');
				while (srvStatusSpan.firstChild) srvStatusSpan.removeChild(srvStatusSpan.firstChild);
				if (isThisBound) {
					srvStatusSpan.appendChild(E('span', { 'class': 'cert-dot cert-dot-ok' }, _('Bound to this certificate')));
				} else if (cur && cur.bound_domain) {
					srvStatusSpan.appendChild(E('span', { 'class': 'cert-dot cert-dot-info' }, _('Bound: %s').format(cur.bound_domain)));
				} else if (cur && cur.manager === 'self-signed') {
					srvStatusSpan.appendChild(E('span', { 'class': 'cert-dot cert-dot-warn' }, _('Default Self-Signed')));
				} else {
					srvStatusSpan.appendChild(E('span', { 'class': 'cert-tag cert-tag-muted' }, (cur && cur.manager) || _('Custom')));
				}
				srvBindBtn.textContent = isLan ? _('Install to LuCI Web') : _('Bind to %s').format(selectedSrvName);
				srvRestoreBtn.textContent = isLan ? _('Restore Self-Signed') : _('Remove ACME Binding');
				srvBindBtn.style.display = isThisBound ? 'none' : '';
				srvRestoreBtn.style.display = (cur && cur.manager === 'acme') ? '' : 'none';
			}

			let srvSelect = (servers.length > 1) ? E('select', {
				'class': 'cbi-input-select',
				'style': 'width:auto;min-width:130px;',
				'change': function () {
					selectedSrvName = this.value;
					updateSrvControls();
				}
			}, servers.map(s => E('option', {
				'value': s.name,
				'selected': (s.name === selectedSrvName) ? 'selected' : null
			}, s.name === '_lan' ? _('LuCI Web (_lan)') : s.name))) : '';

			srvBindBtn.addEventListener('click', function () {
				execCertCmd(['nginx_bind', selectedSrvName, domain], this, _('Installing...'));
			});
			srvRestoreBtn.addEventListener('click', function () {
				execCertCmd(['nginx_bind', selectedSrvName, '--self-signed'], this, _('Restoring...'));
			});
			updateSrvControls();

			bodyWrap.appendChild(E('div', { 'class': 'cert-deploy-card' }, [
				E('div', { 'class': 'cert-deploy-card-head' }, [
					E('div', { 'class': 'cert-deploy-card-title' }, [
						E('span', {}, _('LuCI Web / Nginx Binding')),
						srvStatusSpan
					])
				]),
				E('div', { 'class': 'cert-deploy-row' }, [
					E('div', { 'class': 'cert-deploy-btns' }, [srvSelect, srvBindBtn, srvRestoreBtn])
				]),
				E('div', { 'class': 'cbi-value-description', 'style': 'margin-top:4px;' },
					_('luci-app-cert emits acme.renew on both initial issuance and renewal, so nginx reloads automatically.'))
			]));
		}

		// 2. OpenWrt Standard Paths & Download
		let stdFiles = [
			{ label: _('Fullchain Cert'), path: `/etc/ssl/cert/${domain}.fullchain.crt`, dl: `${domain}.fullchain.crt` },
			{ label: _('Private Key'), path: `/etc/ssl/cert/${domain}.key`, dl: `${domain}.key` },
			{ label: _('Combined PEM'), path: `/etc/ssl/cert/${domain}.combined.crt`, dl: `${domain}.combined.crt` }
		];
		bodyWrap.appendChild(E('div', { 'class': 'cert-deploy-card' }, [
			E('div', { 'class': 'cert-deploy-card-head' }, [
				E('div', { 'class': 'cert-deploy-card-title' }, _('OpenWrt Standard Paths (/etc/ssl/cert/)'))
			]),
			...stdFiles.map(item => E('div', { 'class': 'cert-deploy-row' }, [
				E('div', { 'class': 'cert-deploy-path' }, [
					E('span', { 'style': 'font-weight:600;margin-right:6px;' }, item.label + ':'),
					E('code', {}, item.path)
				]),
				E('div', { 'class': 'cert-deploy-btns' }, [
					E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-neutral', 'click': function () { _copyTextToClipboard(item.path, this); } }, _('Copy Path')),
					E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-neutral', 'click': function () { _downloadCertFile(item.path, item.dl, this); } }, _('Download'))
				])
			]))
		]));

		// 3. Multi-Target Custom Auto-Deploy
		let targets = uci.sections('cert', 'deploy').filter(t => t.domain === domain);
		let dStatuses = _latestStatus.deploy_statuses || {};

		let targetNodes = targets.length === 0
			? [E('div', { 'style': 'font-size:12.5px;color:var(--text-color-medium);padding:4px 0;' },
				_('No custom install targets configured. Other OpenWrt services can reference /etc/ssl/cert/ paths directly or add extra targets here for automatic copy and reload.'))]
			: targets.map(t => {
				let sid = t['.name'];
				let enabled = t.enabled !== '0';
				let dst = dStatuses[sid];
				let paths = [];
				if (t.fullchain_path) paths.push('Fullchain: ' + t.fullchain_path);
				if (t.key_path) paths.push('Key: ' + t.key_path);
				if (t.cert_path) paths.push('Cert: ' + t.cert_path);
				if (t.combined_path) paths.push('Combined: ' + t.combined_path);
				if (t.reload_cmd) paths.push('Reload: ' + t.reload_cmd);

				let isSynced = Boolean(dst && dst.state === 'success');
				let stBadge = '';
				if (!enabled) {
					stBadge = E('span', { 'class': 'cert-tag cert-tag-muted' }, _('Disabled'));
				} else if (dst) {
					let cls = isSynced ? 'cert-tag-ok' : 'cert-tag-err';
					let msg = dst.message || dst.state;
					if (isSynced) {
						let m = /^Installed (\d+) file\(s\)$/.exec(msg || '');
						msg = m ? _('Synced (%d file(s))').format(parseInt(m[1], 10)) : (dst.message || _('Synced'));
					}
					stBadge = E('span', { 'class': 'cert-tag ' + cls, 'title': dst.time || '' },
						msg + (dst.time ? ' · ' + dst.time : ''));
				}

				return E('div', { 'class': 'cert-deploy-target' }, [
					E('div', { 'class': 'cert-deploy-card-head', 'style': 'margin-bottom:4px;' }, [
						E('div', { 'class': 'cert-deploy-card-title' }, [
							E('span', {}, t.name || sid),
							E('span', { 'class': 'cert-tag cert-tag-info' }, t.method === 'symlink' ? _('Symlink') : _('Copy')),
							stBadge
						]),
						E('div', { 'class': 'cert-deploy-btns' }, [
							E('button', {
								'type': 'button',
								'class': isSynced ? 'cbi-button cbi-button-neutral' : 'cbi-button cbi-button-action',
								'click': function () { execCertCmd(['deploy', domain, sid], this, _('Installing...')); }
							}, isSynced ? _('Reinstall') : _('Install Now')),
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-neutral',
								'click': () => { editingId = sid; showForm = true; renderBody(); }
							}, _('Edit')),
							E('button', {
								'type': 'button',
								'class': 'cbi-button cbi-button-negative',
								'click': function () {
									this.disabled = true;
									uci.remove('cert', sid);
									uci.save().then(() => uci.apply()).then(() => uci.load('cert')).then(() => {
										setBanner(false, _('Deploy target deleted.'));
										return _refreshStatus(mapObj).then(() => renderBody());
									}).catch(err => {
										setBanner(true, err.message || String(err));
										renderBody();
									});
								}
							}, _('Delete'))
						])
					]),
					E('div', { 'style': 'font-size:12px;color:var(--text-color-medium);word-break:break-all;line-height:1.5;' },
						paths.map(p => E('div', {}, E('code', {}, p))))
				]);
			});

		bodyWrap.appendChild(E('div', { 'class': 'cert-deploy-card' }, [
			E('div', { 'class': 'cert-deploy-card-head' }, [
				E('div', { 'class': 'cert-deploy-card-title' }, [
					E('span', {}, _('Other Service Install Targets')),
					E('span', { 'class': 'cert-count-pill' }, String(targets.length))
				]),
				E('div', { 'class': 'cert-deploy-btns' }, [
					targets.length > 0 ? E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-action',
						'click': function () { execCertCmd(['deploy', domain], this, _('Installing...')); }
					}, _('Install All Targets')) : '',
					E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-positive',
						'click': () => { editingId = null; showForm = !showForm; renderBody(); }
					}, _('+ Add Target'))
				])
			]),
			...targetNodes,
			showForm ? renderTargetForm(targets) : ''
		]));
	}

	renderBody();
	ui.showModal(_('Install & Deploy Certificate') + ' - ' + domain, [
		bodyWrap,
		E('div', { 'class': 'button-row' }, [
			E('button', { 'type': 'button', 'class': 'btn cbi-button-neutral', 'click': ui.hideModal }, _('Close'))
		])
	], 'cbi-modal');
}

function _renderStatusPanel(container, status, mapObj) {
	let serviceOk = Boolean(status.service_enabled);
	let cronOk = Boolean(status.cron_running && status.cron_entry);
	let acmeshOk = status.acmesh_present !== false;
	let externalCerts = Array.isArray(status.external_certs) ? status.external_certs : [];
	let statuses = status.statuses || {};
	let certs = Array.isArray(status.certs) ? status.certs : [];
	let sections = uci.sections('cert', 'cert');
	let accountEmail = uci.get('cert', 'global', 'account_email') || '';
	let emailMissing = !accountEmail || accountEmail === 'email@example.org';
	let isAnyRunning = Object.values(statuses).some(s => s && s.state === 'running');

	let hasCron = Boolean(status.cron_entry);
	let autoOk = serviceOk && cronOk;
	let isFullyStopped = !serviceOk && !hasCron && !isAnyRunning;
	_updateHeaderServiceBadge(status);
	let cronPretty = _formatCronPretty(status.cron_entry);
	let enabledSections = sections.filter(s => s.enabled !== '0');
	let listeningSet = {};
	if (status.ports) {
		if (status.ports['80']) listeningSet[80] = true;
		if (status.ports['443']) listeningSet[443] = true;
		if (Array.isArray(status.ports.all)) {
			for (let p of status.ports.all) listeningSet[p] = true;
		}
	}

	let needPorts = [];
	let conflictPorts = [];
	let hasWebroot = false;
	let hasDns = false;
	for (let sec of enabledSections) {
		let m = sec.validation_method || (sec.dns ? 'dns' : 'webroot');
		if (m === 'dns') {
			hasDns = true;
		} else if (m === 'webroot') {
			hasWebroot = true;
		} else if (m === 'standalone' || m === 'alpn') {
			let p = parseInt(sec.listen_port || (m === 'alpn' ? '443' : '80'), 10);
			if (p > 0 && needPorts.indexOf(p) < 0) {
				needPorts.push(p);
				if (listeningSet[p]) conflictPorts.push(p);
			}
		}
	}

	let webPorts = Array.isArray(status.web_ports) ? status.web_ports : [];
	let webListenLine = webPorts.length > 0 ? _('Listening %s').format(webPorts.join(' / ')) : '';
	let portModeHint = '';
	if (enabledSections.length === 0) {
		portModeHint = _('No enabled tasks');
	} else if (conflictPorts.length > 0) {
		portModeHint = _('Port %s in use (conflict)').format(conflictPorts.join(' / '));
	} else if (needPorts.length > 0) {
		portModeHint = _('Challenge port %s free').format(needPorts.join(' / '));
	} else if (hasWebroot) {
		portModeHint = hasDns ? _('DNS-01 + Webroot (HTTP)') : _('Webroot (uses HTTP server)');
	} else {
		portModeHint = _('No local port needed (DNS-01)');
	}

	let notices = [];
	if (!acmeshOk) {
		notices.push(E('div', { 'class': 'cert-note cert-note-err' },
			_('Missing /usr/lib/cert/client/acme.sh. Click "Update acme.sh & DNS APIs" or reinstall luci-app-cert.')));
	}
	if (serviceOk && !cronOk) {
		notices.push(E('div', { 'class': 'cert-note' },
			_('OpenWrt cert service is stopped/inactive. Click "Enable Service" above to enable autostart and scheduled renewal.')));
	}
	if (statuses._global && statuses._global.state === 'failed') {
		notices.push(E('div', { 'class': 'cert-note cert-note-err' },
			_('Global config error: %s').format(statuses._global.message || '')));
	}
	if (externalCerts.length > 0) {
		notices.push(E('div', { 'class': 'cert-note' },
			_('Detected external/legacy certificates (%s). luci-app-cert stores state in /etc/cert/acme and symlinks in /etc/ssl/cert.')
				.format(externalCerts.join(', '))));
	}

	let summaryCards = E('div', { 'class': 'cert-summary-grid' }, [
		E('div', { 'class': 'cert-card ' + (autoOk ? 'cert-card-ok' : 'cert-card-warn') }, [
			E('div', { 'class': 'cert-card-head' }, [
				E('span', { 'class': 'cert-card-title' }, _('Auto-Renewal')),
				E('span', { 'class': 'cert-dot ' + (autoOk ? 'cert-dot-ok' : 'cert-dot-warn') },
					autoOk ? _('Active') : (serviceOk ? _('Cron Inactive') : _('Stopped')))
			]),
			E('div', { 'class': 'cert-card-body' }, [
				E('div', { 'class': 'cert-card-main' }, autoOk ? _('Every 12h') : (isFullyStopped ? _('Service Stopped') : _('Manual only'))),
				E('div', { 'class': 'cert-card-sub', 'title': status.cron_entry || '' }, [
					E('span', {}, cronPretty || _('Autostart & cron disabled'))
				])
			])
		]),
		E('div', { 'class': 'cert-card ' + (acmeshOk ? 'cert-card-info' : 'cert-card-err') }, [
			E('div', { 'class': 'cert-card-head' }, [
				E('span', { 'class': 'cert-card-title' }, _('ACME Core')),
				E('span', { 'class': 'cert-dot ' + (acmeshOk ? 'cert-dot-info' : 'cert-dot-err') },
					acmeshOk ? _('Ready') : _('Missing'))
			]),
			E('div', { 'class': 'cert-card-body' }, [
				E('div', { 'class': 'cert-card-main' }, status.acmesh_version ? ('acme.sh v' + status.acmesh_version) : (acmeshOk ? 'acme.sh' : '—')),
				E('div', { 'class': 'cert-card-sub' }, [
					E('span', {}, _('%d DNS providers loaded').format(status.dnsapi_count || 0))
				])
			])
		]),
		E('div', { 'class': 'cert-card ' + (conflictPorts.length > 0 ? 'cert-card-warn' : 'cert-card-info') }, [
			E('div', { 'class': 'cert-card-head' }, [
				E('span', { 'class': 'cert-card-title' }, _('Web Server')),
				E('span', { 'class': 'cert-dot ' + (conflictPorts.length > 0 ? 'cert-dot-warn' : 'cert-dot-info') },
					conflictPorts.length > 0 ? _('Port Conflict') : (status.nginx_running ? _('Reload Hooked') : _('Active')))
			]),
			E('div', { 'class': 'cert-card-body' }, [
				E('div', { 'class': 'cert-card-main' }, status.nginx_running ? 'luci-nginx' : (status.uhttpd_running ? 'uhttpd' : _('Web Server'))),
				E('div', { 'class': 'cert-card-sub', 'style': 'flex-direction:column;align-items:flex-start;gap:2px;' }, [
					webListenLine ? E('div', {}, webListenLine) : '',
					E('div', { 'style': 'font-weight:600;color:' + (conflictPorts.length > 0 ? 'var(--error-color-high)' : 'var(--text-color-high)') + ';' }, portModeHint)
				])
			])
		]),
		E('div', { 'class': 'cert-card ' + (emailMissing ? 'cert-card-warn' : 'cert-card-ok') }, [
			E('div', { 'class': 'cert-card-head' }, [
				E('span', { 'class': 'cert-card-title' }, _('Account & Certs')),
				E('span', { 'class': 'cert-dot ' + (emailMissing ? 'cert-dot-warn' : 'cert-dot-ok') },
					emailMissing ? _('Setup Needed') : _('Configured'))
			]),
			E('div', { 'class': 'cert-card-body' }, [
				E('div', { 'class': 'cert-card-main' }, _('%d / %d').format(certs.length, sections.length)),
				E('div', { 'class': 'cert-card-sub' }, [
					emailMissing
						? E('span', {}, [
							_('Account email unset') + ' · ',
							E('a', { 'href': L.url('admin/services/cert/settings'), 'style': 'font-weight:600;' }, _('Configure →'))
						])
						: E('span', { 'title': accountEmail }, accountEmail)
				])
			])
		])
	]);

	let validIds = enabledSections.map(s => s['.name']);
	if (validIds.length === 0) {
		_selectedTarget = '';
	} else if (_selectedTarget !== '__all__' && validIds.indexOf(_selectedTarget) < 0) {
		_selectedTarget = validIds[0];
	}

	let issueBtn = null;
	let forceBtn = null;
	let updateBtnLabels = () => {
		let isAll = (_selectedTarget === '__all__');
		if (issueBtn) issueBtn.textContent = isAll ? _('Issue / Renew All') : _('Issue / Renew');
		if (forceBtn) forceBtn.textContent = isAll ? _('Force Renew All') : _('Force Renew');
	};

	let targetSelect = '';
	if (sections.length > 0) {
		let opts = enabledSections.map(sec => {
			let id = sec['.name'];
			let primary = Array.isArray(sec.domains) ? sec.domains[0] : (sec.domains || '');
			let label = primary ? (id + ' (' + primary + ')') : id;
			return E('option', { 'value': id, 'selected': (_selectedTarget === id) ? 'selected' : null }, label);
		});
		if (enabledSections.length > 1) {
			opts.push(E('option', {
				'value': '__all__',
				'selected': (_selectedTarget === '__all__') ? 'selected' : null
			}, _('All enabled (%d)').format(enabledSections.length)));
		} else if (enabledSections.length === 0) {
			opts.push(E('option', { 'value': '' }, _('No enabled certificates')));
		}
		targetSelect = E('select', {
			'class': 'cbi-input-select',
			'title': _('Select target certificate'),
			'disabled': enabledSections.length === 0 ? 'disabled' : null,
			'change': function () {
				_selectedTarget = this.value;
				updateBtnLabels();
			}
		}, opts);
	}

	if (sections.length > 0) {
		let actionDisabled = (!autoOk || emailMissing || enabledSections.length === 0) ? 'disabled' : null;
		let disabledHint = !autoOk ? _('Enable the service first to issue or renew certificates') : null;
		issueBtn = E('button', {
			'type': 'button',
			'class': 'cbi-button cbi-button-action important',
			'disabled': actionDisabled,
			'title': disabledHint,
			'click': function () {
				let arg = (_selectedTarget && _selectedTarget !== '__all__') ? _selectedTarget : null;
				_runInitAction('renew', arg, mapObj, true, this, _('Starting...'));
			}
		}, _selectedTarget === '__all__' ? _('Issue / Renew All') : _('Issue / Renew'));
		forceBtn = E('button', {
			'type': 'button',
			'class': 'cbi-button cbi-button-neutral',
			'disabled': actionDisabled,
			'title': disabledHint,
			'click': function () {
				let arg = (_selectedTarget && _selectedTarget !== '__all__') ? _selectedTarget : null;
				_runInitAction('force_renew', arg, mapObj, true, this, _('Starting...'));
			}
		}, _selectedTarget === '__all__' ? _('Force Renew All') : _('Force Renew'));
	}

	let toolbar = E('div', { 'class': 'cert-toolbar' }, [
		(!autoOk) ? E('button', {
			'type': 'button',
			'class': 'cbi-button cbi-button-positive important cert-svc-btn',
			'click': function () { _setServiceState(true, this, mapObj); }
		}, _('Enable Service')) : '',
		(!isFullyStopped) ? E('button', {
			'type': 'button',
			'class': 'cbi-button cbi-button-negative cert-svc-btn',
			'click': function () { _setServiceState(false, this, mapObj); }
		}, _('Stop Service')) : '',
		targetSelect,
		issueBtn || '',
		forceBtn || '',
		isAnyRunning ? E('button', {
			'type': 'button',
			'class': 'cbi-button cbi-button-negative important cert-abort-btn',
			'click': function () { _runInitAction('abort', null, mapObj, false, this, _('Aborting...')); }
		}, _('Abort')) : ''
	]);

	while (container.firstChild) {
		container.removeChild(container.firstChild);
	}
	container.appendChild(E('div', { 'class': 'cert-header-bar' }, [
		E('h3', {}, _('Runtime Status')),
		toolbar
	]));
	container.appendChild(summaryCards);
	for (let n of notices) container.appendChild(n);
}

function _formatCronPretty(entry) {
	if (!entry) return '';
	let parts = entry.trim().split(/\s+/);
	if (parts.length < 2) return entry;
	let m = parts[0].padStart(2, '0');
	let hours = parts[1].split(',').map(h => h.padStart(2, '0') + ':' + m);
	return _('Runs at %s').format(hours.join(' & '));
}

function _localizeTaskState(state) {
	switch (state) {
		case 'valid': return _('Valid');
		case 'success': return _('Success');
		case 'running': return _('Running');
		case 'failed': return _('Failed');
		case 'disabled': return _('Disabled');
		case 'ok': return _('OK');
		default: return state || '';
	}
}

function _localizeTaskMessage(msg) {
	if (!msg) return '';
	switch (msg) {
		case 'Certificate is valid (renewal not due yet)':
			return _('Certificate is valid (renewal not due yet)');
		case 'Queued for issuance/renewal':
			return _('Queued for issuance/renewal');
		case 'Certificate is disabled':
			return _('Certificate is disabled');
		case 'No domains configured':
			return _('No domains configured');
		case 'Invalid primary domain':
			return _('Invalid primary domain');
		case 'DNS validation selected without DNS API':
			return _('DNS validation selected without DNS API');
		case 'Failed to create webroot directory':
			return _('Failed to create webroot directory');
		case 'Failed to create challenge directory':
			return _('Failed to create challenge directory');
		case 'Failed to create state directory':
			return _('Failed to create state directory');
	}
	let m;
	if ((m = /^Processing (.+) \(([^)]+)\)$/.exec(msg)))
		return _('Processing %s (%s)').format(m[1], m[2]);
	if ((m = /^Certificate renewed for (.+)$/.exec(msg)))
		return _('Certificate renewed for %s').format(m[1]);
	if ((m = /^Certificate issued for (.+)$/.exec(msg)))
		return _('Certificate issued for %s').format(m[1]);
	if ((m = /^Renewal failed for (.+) \(exit (\d+)\); check Certificate Log$/.exec(msg)))
		return _('Renewal failed for %s (exit %d); check Certificate Log').format(m[1], parseInt(m[2], 10));
	if ((m = /^Issuance failed for (.+) \(exit (\d+)\); check Certificate Log$/.exec(msg)))
		return _('Issuance failed for %s (exit %d); check Certificate Log').format(m[1], parseInt(m[2], 10));
	if ((m = /^Renewal aborted for (.+)$/.exec(msg)))
		return _('Renewal aborted for %s').format(m[1]);
	if ((m = /^Issuance aborted for (.+)$/.exec(msg)))
		return _('Issuance aborted for %s').format(m[1]);
	if ((m = /^Firewall rule setup failed for (.+)$/.exec(msg)))
		return _('Firewall rule setup failed for %s').format(m[1]);
	return msg;
}

function _renderCertsPanel(container, status, mapObj) {
	let statuses = status.statuses || {};
	let certs = Array.isArray(status.certs) ? status.certs : [];
	let sections = uci.sections('cert', 'cert');
	let accountEmail = uci.get('cert', 'global', 'account_email') || '';
	let emailMissing = !accountEmail || accountEmail === 'email@example.org';
	let serviceRunning = _isServiceRunning(status);
	let rowDisabledHint = !serviceRunning ? _('Enable the service first to issue or renew certificates') : null;

	let taskTable = E('table', { 'class': 'table cbi-section-table', 'id': 'cert_tasks_table' }, [
		E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('Config Section')),
			E('th', { 'class': 'th' }, _('Domains')),
			E('th', { 'class': 'th' }, _('Method')),
			E('th', { 'class': 'th' }, _('Last Run Status')),
			E('th', { 'class': 'th cbi-section-actions' }, _('Actions')),
		])
	]);

	let taskRows = sections.map(sec => {
		let name = sec['.name'];
		let enabled = sec.enabled !== '0';
		let domains = Array.isArray(sec.domains) ? sec.domains.join(', ') : (sec.domains || '—');
		let method = (sec.validation_method || 'dns') + (sec.validation_method === 'dns' && sec.dns ? ' (' + sec.dns + ')' : '');
		let st = statuses[name];
		let stNode;
		if (!enabled) {
			stNode = E('span', { 'class': 'cert-tag cert-tag-muted' }, _('Disabled'));
		} else if (!st) {
			stNode = E('span', { 'style': 'opacity:0.65;' }, _('Not triggered in this boot'));
		} else {
			let tagCls = 'cert-tag-muted';
			if (st.state === 'success' || st.state === 'valid') tagCls = 'cert-tag-ok';
			else if (st.state === 'running') tagCls = 'cert-tag-info';
			else if (st.state === 'failed') tagCls = 'cert-tag-err';
			stNode = E('div', {}, [
				E('span', { 'class': 'cert-tag ' + tagCls, 'style': 'margin-right:6px;' }, _localizeTaskState(st.state)),
				E('span', {}, _localizeTaskMessage(st.message)),
				st.time ? E('span', { 'style': 'opacity:0.65;font-size:12px;margin-left:6px;' }, st.time) : ''
			]);
		}

		let btnGroup = E('div', { 'style': 'display:inline-flex;gap:6px;flex-wrap:nowrap;justify-content:flex-end;align-items:center;' }, [
			E('button', {
				'type': 'button',
				'class': 'cbi-button cbi-button-action',
				'disabled': (!serviceRunning || !enabled || emailMissing) ? 'disabled' : null,
				'title': rowDisabledHint,
				'click': function () { _runInitAction('renew', name, mapObj, true, this); }
			}, _('Issue / Renew')),
			E('button', {
				'type': 'button',
				'class': 'cbi-button cbi-button-neutral',
				'disabled': (!serviceRunning || !enabled || emailMissing) ? 'disabled' : null,
				'title': rowDisabledHint,
				'click': function () { _runInitAction('force_renew', name, mapObj, true, this); }
			}, _('Force'))
		]);

		return [name, domains, method, stNode, btnGroup];
	});

	cbi_update_table(taskTable, taskRows, E('em', _('No certificate tasks yet. Add a configuration above.')));
	_applyTableCellTitles(taskTable);

	let certTable = E('table', { 'class': 'table cbi-section-table', 'id': 'certificates_table' }, [
		E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('Main Domain')),
			E('th', { 'class': 'th' }, _('Issuer')),
			E('th', { 'class': 'th' }, _('Expires On')),
			E('th', { 'class': 'th' }, _('Certificate Files')),
			E('th', { 'class': 'th cbi-section-actions' }, _('Install / Deploy')),
		])
	]);

	let nginxServers = Array.isArray(status.nginx_servers) ? status.nginx_servers : [];
	let allDeployTargets = uci.sections('cert', 'deploy');

	let certRows = certs.map(cert => {
		let [expiryStr, daysLeft] = _formatDateAndLeft(cert.not_after);
		let expiryNode;
		if (daysLeft === '') {
			expiryNode = expiryStr;
		} else {
			let tagCls = daysLeft <= 0 ? 'cert-tag-err' : (daysLeft <= 15 ? 'cert-tag-warn' : 'cert-tag-ok');
			let expLabel = daysLeft <= 0 ? _('Expired') : _('%d days left').format(daysLeft);
			expiryNode = E('div', { 'class': 'cert-inline-line' }, [
				E('span', {}, expiryStr),
				E('span', { 'class': 'cert-tag ' + tagCls }, expLabel)
			]);
		}

		let issuerNode = cert.is_staging
			? E('div', { 'class': 'cert-inline-line', 'title': cert.issuer || '' }, [
				E('span', { 'class': 'cert-tag cert-tag-warn' }, _('Staging')),
				E('span', { 'class': 'cert-issuer-text' }, cert.issuer || '')
			])
			: E('span', { 'class': 'cert-issuer-text', 'title': cert.issuer || '' }, cert.issuer || '—');

		let filesNode = E('div', { 'class': 'cert-files-line' }, [
			E('div', {}, E('code', {}, cert.cert_path)),
			E('div', { 'style': 'margin-top:2px;' }, E('code', {}, cert.key_path))
		]);

		let boundSrvs = nginxServers.filter(s => s.bound_domain === cert.domain);
		let domainTargets = allDeployTargets.filter(t => t.domain === cert.domain);
		let domainNode = E('div', { 'class': 'cert-inline-line', 'style': 'flex-wrap:wrap;' }, [
			E('span', { 'style': 'font-weight:600;white-space:nowrap;' }, cert.domain),
			...boundSrvs.map(s => E('span', { 'class': 'cert-tag cert-tag-ok' }, 'LuCI (' + s.name + ')')),
			domainTargets.length > 0
				? E('span', { 'class': 'cert-tag cert-tag-info' }, _('%d target(s)').format(domainTargets.length))
				: ''
		]);

		let deployBtn = E('button', {
			'type': 'button',
			'class': 'cbi-button cbi-button-action',
			'click': () => _showDeployModal(cert.domain, mapObj)
		}, _('Install Certificate'));

		return [domainNode, issuerNode, expiryNode, filesNode, deployBtn];
	});

	cbi_update_table(certTable, certRows, E('em', _('No issued certificates in /etc/ssl/cert yet.')));
	_applyTableCellTitles(certTable);

	while (container.firstChild) {
		container.removeChild(container.firstChild);
	}
	container.appendChild(E('div', { 'class': 'cbi-section cbi-tblsection cert-panel' }, [
		E('div', { 'class': 'cert-panel-head' }, [
			E('h3', {}, _('Certificate Tasks')),
			E('span', { 'class': 'cert-count-pill' }, String(sections.length))
		]),
		E('div', { 'class': 'cert-panel-body' }, [ taskTable ])
	]));
	container.appendChild(E('div', { 'class': 'cbi-section cbi-tblsection cert-panel' }, [
		E('div', { 'class': 'cert-panel-head' }, [
			E('h3', {}, _('Issued Certificates')),
			E('span', { 'class': 'cert-count-pill' }, String(certs.length))
		]),
		E('div', { 'class': 'cert-panel-body' }, [ certTable ])
	]));
}

function _formatDateAndLeft(notAfterStr) {
	if (!notAfterStr) return ['—', ''];
	let ts = Date.parse(notAfterStr);
	if (isNaN(ts)) return [notAfterStr, ''];
	let d = new Date(ts);
	let daysLeft = Math.floor((ts - Date.now()) / 86400000);
	return [d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), daysLeft];
}

function _isFqdn(domain) {
	let i = domain.lastIndexOf('.');
	if (i < 0) return false;
	let tld = domain.substr(i + 1);
	if (tld.length < 2) return false;
	return /^[a-z0-9]+$/i.test(tld);
}

function _guessDomain(hostname) {
	return _isFqdn(hostname) ? hostname : (_isFqdn(window.location.hostname) ? window.location.hostname : '');
}

function _createDnsCombobox(widgetEl, selectEl, apiInfos) {
	let items = Array.from(selectEl.options).map(opt => {
		let info = apiInfos.find(a => a.Id === opt.value);
		return {
			value: opt.value,
			text: opt.text,
			search: (opt.value + ' ' + opt.text + ' ' + (info ? (info.Domains + ' ' + info.Site) : '')).toLowerCase()
		};
	});

	widgetEl.style.display = 'none';

	let isOpen = false;
	let isFiltering = false;
	let activeIdx = -1;
	let visibleItems = [];

	function getSelectedItem() {
		return items.find(it => it.value === selectEl.value) || items[0] || { value: '', text: '' };
	}

	let inputEl = E('input', {
		'type': 'text',
		'class': 'cbi-input-text cert-combo-input',
		'autocomplete': 'off',
		'placeholder': _('Search provider (e.g. cloudflare, ali, dnspod, aws)...')
	});

	let clearBtn = E('button', {
		'type': 'button',
		'class': 'cert-combo-btn',
		'title': _('Clear')
	}, '×');

	let toggleBtn = E('button', {
		'type': 'button',
		'class': 'cert-combo-btn',
		'tabindex': '-1'
	}, '▾');

	let metaEl = E('div', { 'class': 'cert-combo-meta' });
	let listEl = E('div', { 'class': 'cert-combo-list' });
	let menuEl = E('div', { 'class': 'cert-combo-menu' }, [metaEl, listEl]);

	function syncDisplayFromSelect() {
		let sel = getSelectedItem();
		inputEl.value = sel.value ? sel.text : '';
		clearBtn.style.display = (sel.value || inputEl.value) ? '' : 'none';
	}

	function selectValue(val) {
		let changed = (selectEl.value !== val);
		selectEl.value = val;
		isFiltering = false;
		syncDisplayFromSelect();
		closeMenu();
		if (changed) {
			selectEl.dispatchEvent(new Event('change', { bubbles: true }));
		}
	}

	function updateActiveClass() {
		let children = listEl.children;
		for (let i = 0; i < children.length; i++) {
			children[i].classList.toggle('active', i === activeIdx);
		}
		if (activeIdx >= 0 && children[activeIdx] && children[activeIdx].scrollIntoView) {
			children[activeIdx].scrollIntoView({ block: 'nearest' });
		}
	}

	function renderList() {
		let q = isFiltering ? (inputEl.value || '').trim().toLowerCase() : '';
		let matched = 0;
		visibleItems = [];

		while (listEl.firstChild) {
			listEl.removeChild(listEl.firstChild);
		}

		for (let it of items) {
			if (!it.value) {
				if (!q) visibleItems.push(it);
				continue;
			}
			if (!q || it.search.indexOf(q) >= 0) {
				visibleItems.push(it);
				matched++;
			}
		}

		metaEl.textContent = q
			? _('%d / %d matched').format(matched, apiInfos.length)
			: _('%d providers available').format(apiInfos.length);

		if (visibleItems.length === 0) {
			listEl.appendChild(E('div', { 'class': 'cert-combo-empty' }, _('No matching providers')));
			activeIdx = -1;
			return;
		}

		let curVal = selectEl.value;
		if (activeIdx >= visibleItems.length) {
			activeIdx = visibleItems.length - 1;
		}
		if (activeIdx < 0 && q) {
			let firstProviderIdx = visibleItems.findIndex(it => !!it.value);
			activeIdx = firstProviderIdx >= 0 ? firstProviderIdx : 0;
		}

		visibleItems.forEach((it, idx) => {
			let cls = 'cert-combo-item';
			if (it.value === curVal && curVal !== '') cls += ' selected';
			if (idx === activeIdx) cls += ' active';

			let row = E('div', {
				'class': cls,
				'mousedown': function (ev) {
					ev.preventDefault();
					selectValue(it.value);
				},
				'mouseenter': function () {
					activeIdx = idx;
					updateActiveClass();
				}
			}, [
				E('span', {}, it.text),
				it.value ? E('span', { 'class': 'cert-combo-id' }, it.value) : ''
			]);
			listEl.appendChild(row);
		});
	}

	function openMenu(resetFilter) {
		if (resetFilter) isFiltering = false;
		isOpen = true;
		renderList();
		if (selectEl.value) {
			let selIdx = visibleItems.findIndex(it => it.value === selectEl.value);
			if (selIdx >= 0) {
				activeIdx = selIdx;
				updateActiveClass();
			}
		}
		menuEl.classList.add('open');
	}

	function closeMenu() {
		isOpen = false;
		isFiltering = false;
		activeIdx = -1;
		menuEl.classList.remove('open');
	}

	inputEl.addEventListener('focus', function () {
		isFiltering = false;
		openMenu(true);
		if (inputEl.value && inputEl.select) {
			setTimeout(() => {
				if (document.activeElement === inputEl) inputEl.select();
			}, 0);
		}
	});

	inputEl.addEventListener('click', function () {
		if (!isOpen) openMenu(true);
	});

	inputEl.addEventListener('input', function () {
		isFiltering = true;
		clearBtn.style.display = this.value ? '' : 'none';
		if (!isOpen) isOpen = true;
		activeIdx = -1;
		renderList();
		menuEl.classList.add('open');
	});

	inputEl.addEventListener('keydown', function (ev) {
		if (ev.key === 'ArrowDown') {
			ev.preventDefault();
			if (!isOpen) {
				openMenu(false);
			} else if (visibleItems.length > 0) {
				activeIdx = (activeIdx + 1) % visibleItems.length;
				updateActiveClass();
			}
		} else if (ev.key === 'ArrowUp') {
			ev.preventDefault();
			if (!isOpen) {
				openMenu(false);
			} else if (visibleItems.length > 0) {
				activeIdx = (activeIdx <= 0 ? visibleItems.length - 1 : activeIdx - 1);
				updateActiveClass();
			}
		} else if (ev.key === 'Enter') {
			if (isOpen && activeIdx >= 0 && visibleItems[activeIdx]) {
				ev.preventDefault();
				selectValue(visibleItems[activeIdx].value);
			}
		} else if (ev.key === 'Escape') {
			if (isOpen) {
				ev.preventDefault();
				closeMenu();
				syncDisplayFromSelect();
			}
		}
	});

	inputEl.addEventListener('blur', function () {
		closeMenu();
		syncDisplayFromSelect();
	});

	clearBtn.addEventListener('mousedown', function (ev) {
		ev.preventDefault();
		if (inputEl.value && !selectEl.value) {
			inputEl.value = '';
			isFiltering = false;
			openMenu(true);
		} else {
			selectValue('');
			inputEl.focus();
		}
	});

	toggleBtn.addEventListener('mousedown', function (ev) {
		ev.preventDefault();
		if (isOpen) {
			closeMenu();
			syncDisplayFromSelect();
		} else {
			inputEl.focus();
			openMenu(true);
		}
	});

	syncDisplayFromSelect();

	return E('div', { 'class': 'cert-combo' }, [
		E('div', { 'class': 'cert-combo-box' }, [
			inputEl,
			E('div', { 'class': 'cert-combo-actions' }, [clearBtn, toggleBtn])
		]),
		menuEl,
		widgetEl
	]);
}

function _renderActiveDnsFields(mapObj, section_id, apiInfos) {
	let container = document.getElementById('dns_creds_builder_' + section_id);
	if (!container) return;

	let dnsFound = mapObj.lookupOption('dns', section_id);
	let altFound = mapObj.lookupOption('_dns_options_alt', section_id);
	let credFound = mapObj.lookupOption('credentials', section_id);

	let dnsOpt = dnsFound ? dnsFound[0] : null;
	let altOpt = altFound ? altFound[0] : null;
	let credOpt = credFound ? credFound[0] : null;

	let dnsId = dnsOpt ? dnsOpt.formvalue(section_id) : uci.get('cert', section_id, 'dns');
	if (dnsId === undefined || dnsId === null) {
		dnsId = uci.get('cert', section_id, 'dns') || '';
	}
	let useAlt = altOpt ? (altOpt.formvalue(section_id) === '1') : false;

	let rawCreds = [];
	if (credOpt && credOpt.getUIElement(section_id)) {
		rawCreds = credOpt.getUIElement(section_id).getValue() || [];
	} else {
		rawCreds = uci.get('cert', section_id, 'credentials') || [];
	}
	let credsMap = _parseKeyValueListToMap(rawCreds);

	while (container.firstChild) {
		container.removeChild(container.firstChild);
	}

	if (!dnsId) {
		_setRawCredsVisible(mapObj, section_id, false);
		container.appendChild(E('em', { 'style': 'opacity:0.75;' }, _('Select a DNS API provider above to configure credentials.')));
		return;
	}

	let info = apiInfos.find(a => a.Id === dnsId);
	if (!info) {
		_setRawCredsVisible(mapObj, section_id, true);
		container.appendChild(E('em', { 'style': 'color:#c9302c;' }, _('Metadata for "%s" not found; add KEY=VAL entries below.').format(dnsId)));
		return;
	}

	let fields = useAlt ? info.OptsAlt : info.Opts;
	let title = useAlt ? info.OptsAltTitle : info.OptsTitle;

	if (info.Site || info.Docs) {
		let metaParts = [];
		if (info.Site) metaParts.push(E('span', {}, [_('Site'), ': ', E('code', {}, info.Site)]));
		if (info.Docs) metaParts.push(E('span', {}, [_('Docs'), ': ', E('code', {}, info.Docs)]));
		container.appendChild(E('div', { 'class': 'cert-dns-meta' }, metaParts));
	}

	if (title) {
		container.appendChild(E('div', { 'style': 'font-weight:600;margin-bottom:8px;' }, title));
	}

	if (!fields || fields.length === 0) {
		_setRawCredsVisible(mapObj, section_id, true);
		container.appendChild(E('em', { 'style': 'opacity:0.75;' },
			useAlt ? _('No alternative options defined for this provider.') : _('No preset options parsed; add KEY=VAL entries below.')));
		return;
	}

	let knownKeys = new Set(fields.map(f => f.Name));
	let hasMalformed = (rawCreds || []).some(e => e && e.indexOf('=') <= 0);
	let hasExtraKeys = Array.from(credsMap.keys()).some(k => !knownKeys.has(k));
	let mustShowRaw = hasMalformed || hasExtraKeys;
	_setRawCredsVisible(mapObj, section_id, mustShowRaw || !!container._forceShowRaw);

	if (container._syncTimer) {
		clearTimeout(container._syncTimer);
		container._syncTimer = null;
	}
	container._flushCredSync = function () {
		if (container._syncTimer) {
			clearTimeout(container._syncTimer);
			container._syncTimer = null;
		}
		_syncBuilderInputsToDynList(mapObj, section_id, container);
	};

	container.appendChild(E('div', { 'class': 'cert-cred-hint' },
		_('Enter values only (without KEY= prefix or quotes).')));

	for (let opt of fields) {
		let curVal = credsMap.get(opt.Name) || '';
		let isSecret = /key|secret|token|pass|pwd|auth/i.test(opt.Name);
		let placeholder = opt.Default
			? _('Default: %s').format(opt.Default)
			: _('Enter value for %s (without KEY= or quotes)').format(opt.Name);

		let warnEl = E('div', { 'class': 'cert-cred-warn', 'style': 'display:none;' });
		let inputEl = E('input', {
			'type': isSecret ? 'password' : 'text',
			'class': isSecret ? 'cbi-input-text cert-cred-input has-toggle' : 'cbi-input-text cert-cred-input',
			'data-cred-key': opt.Name,
			'value': curVal,
			'placeholder': placeholder
		});

		let lastIssueSig = null;
		function refreshIssue(val) {
			let issue = _detectCredValueIssue(opt.Name, val);
			let sig = issue ? (issue.message + '|' + (issue.fixable ? '1' : '0')) : '';
			if (sig === lastIssueSig) return;
			lastIssueSig = sig;
			while (warnEl.firstChild) warnEl.removeChild(warnEl.firstChild);
			if (!issue) {
				inputEl.classList.remove('cbi-input-invalid');
				warnEl.style.display = 'none';
				return;
			}
			inputEl.classList.add('cbi-input-invalid');
			warnEl.style.display = '';
			warnEl.appendChild(E('span', {}, issue.message));
			if (issue.fixable) {
				warnEl.appendChild(E('button', {
					'type': 'button',
					'class': 'cert-cred-fix',
					'click': function () {
						let cleaned = _autoFixCredValue(opt.Name, inputEl.value);
						inputEl.value = cleaned;
						refreshIssue(cleaned);
						container._flushCredSync();
					}
				}, _('Auto-fix')));
			}
		}

		inputEl.addEventListener('input', function () {
			refreshIssue(this.value);
			if (container._syncTimer) clearTimeout(container._syncTimer);
			container._syncTimer = setTimeout(() => {
				container._syncTimer = null;
				_syncBuilderInputsToDynList(mapObj, section_id, container);
			}, 220);
		});
		inputEl.addEventListener('change', function () {
			refreshIssue(this.value);
			container._flushCredSync();
		});
		inputEl.addEventListener('blur', function () {
			refreshIssue(this.value);
			container._flushCredSync();
		});

		let boxChildren = [inputEl];
		if (isSecret) {
			boxChildren.push(E('button', {
				'type': 'button',
				'class': 'cert-cred-toggle',
				'tabindex': '-1',
				'click': function () {
					inputEl.type = (inputEl.type === 'password') ? 'text' : 'password';
					this.textContent = (inputEl.type === 'password') ? _('Show') : _('Hide');
				}
			}, _('Show')));
		}

		let row = E('div', { 'class': 'cert-cred-row' }, [
			E('div', { 'class': 'cert-cred-label' }, [
				E('span', {}, opt.Title),
				E('code', { 'style': 'font-size:11px;' }, opt.Name)
			]),
			E('div', { 'class': 'cert-cred-box' }, boxChildren),
			warnEl,
			(opt.Description || opt.Default) ? E('div', { 'class': 'cbi-value-description', 'style': 'margin-top:3px;' },
				opt.Description + (opt.Default ? ' (' + _('Default') + ': ' + opt.Default + ')' : '')
			) : ''
		]);
		refreshIssue(curVal);
		container.appendChild(row);
	}

	if (!mustShowRaw) {
		let rawToggleBtn = E('button', {
			'type': 'button',
			'class': 'cert-cred-raw-link',
			'click': function () {
				container._forceShowRaw = !container._forceShowRaw;
				_setRawCredsVisible(mapObj, section_id, container._forceShowRaw);
				this.textContent = container._forceShowRaw
					? _('▾ Hide raw KEY=VAL list')
					: _('▸ Edit raw KEY=VAL list (fallback only)');
			}
		}, container._forceShowRaw
			? _('▾ Hide raw KEY=VAL list')
			: _('▸ Edit raw KEY=VAL list (fallback only)'));
		container.appendChild(rawToggleBtn);
	}
}

function _setRawCredsVisible(mapObj, section_id, visible) {
	let builderEl = document.getElementById('dns_creds_builder_' + section_id);
	let builderRow = builderEl && builderEl.closest ? builderEl.closest('.cbi-value') : null;
	if (builderRow) {
		builderRow.classList.toggle('cert-row-join-bottom', !!visible);
	}
	let credFound = mapObj.lookupOption('credentials', section_id);
	if (!credFound || !credFound[0]) return;
	let fieldEl = mapObj.findElement('data-field', credFound[0].cbid(section_id));
	if (!fieldEl) return;
	fieldEl.classList.toggle('cert-row-collapsed', !visible);
	fieldEl.classList.toggle('cert-row-joined', !!visible);
}

function _detectCredValueIssue(optName, val) {
	if (!val) return null;
	if (/[\r\n]/.test(val)) {
		return { message: _('Credential value must be a single line.'), fixable: false };
	}
	if (/^\s*export\s+[A-Za-z_][A-Za-z0-9_]*\s*=/i.test(val)) {
		return { message: _('Do not include "export" or KEY= — enter only the raw value.'), fixable: true };
	}
	let escaped = optName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	if (new RegExp('^\\s*' + escaped + '\\s*=').test(val)) {
		return { message: _('Do not include "%s=" — enter only the raw value.').format(optName), fixable: true };
	}
	let trimmed = val.trim();
	if (trimmed.length >= 2 &&
		((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		 (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
		return { message: _('Do not wrap the value in quotes — quotes are handled automatically.'), fixable: true };
	}
	if (trimmed.indexOf('"') >= 0 && trimmed.indexOf("'") >= 0) {
		return { message: _('Avoid mixing both single and double quotes in the same value.'), fixable: false };
	}
	if (val !== trimmed) {
		return { message: _('Leading or trailing whitespace detected.'), fixable: true };
	}
	return null;
}

function _autoFixCredValue(optName, val) {
	let v = (val || '').trim();
	v = v.replace(/^export\s+/i, '');
	let escaped = optName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	v = v.replace(new RegExp('^' + escaped + '\\s*=\\s*'), '');
	if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
		v = v.slice(1, -1);
	}
	return v.trim();
}

const RESERVED_CRED_ENVS = new Set([
	'PATH', 'IFS', 'HOME', 'SHELL', 'USER', 'LOGNAME', 'ENV', 'BASH_ENV', 'CDPATH', 'TMPDIR',
	'CHALLENGE_DIR', 'CERT_DIR', 'STATE_DIR', 'RUNNER', 'NOTIFY', 'ACME', 'LOG_TAG',
	'TARGET_SECTION', 'FORCE_RENEW', 'section', 'validation_method', 'domains', 'main_domain',
	'account_email', 'dns', 'debug', 'listen_port'
]);

function _validateRawCredentialEntry(section_id, value) {
	let items = Array.isArray(value) ? value : [value];
	for (let entry of items) {
		let v = (entry || '').trim();
		if (!v) continue;
		if (/^export\s+/i.test(v)) {
			return _('Do not include "export"; use KEY="VALUE" format.');
		}
		let eq = v.indexOf('=');
		if (eq <= 0) {
			return _('Invalid format: must be KEY="VALUE" (missing "=").');
		}
		let key = v.slice(0, eq).trim();
		let rawVal = v.slice(eq + 1).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
			return _('Invalid variable name "%s": use letters, digits, and "_" only.').format(key);
		}
		if (RESERVED_CRED_ENVS.has(key) || key.startsWith('LD_')) {
			return _('Reserved or unsafe environment variable "%s" is not allowed.').format(key);
		}
		if (!rawVal || rawVal === '""' || rawVal === "''") {
			return _('Value after "=" must not be empty.');
		}
		if ((rawVal.startsWith('"') && (!rawVal.endsWith('"') || rawVal.length < 2)) ||
			(rawVal.startsWith("'") && (!rawVal.endsWith("'") || rawVal.length < 2))) {
			return _('Unclosed quote in credential value.');
		}
	}
	return true;
}

function _syncBuilderInputsToDynList(mapObj, section_id, container) {
	if (!container) return;
	let credFound = mapObj.lookupOption('credentials', section_id);
	if (!credFound || !credFound[0]) return;
	let credentialsDynList = credFound[0].getUIElement(section_id);
	if (!credentialsDynList) return;

	let creds = credentialsDynList.getValue() || [];
	let credsMap = _parseKeyValueListToMap(creds);
	let inputs = container.querySelectorAll('.cert-cred-input[data-cred-key]');
	for (let i = 0; i < inputs.length; i++) {
		let key = inputs[i].getAttribute('data-cred-key');
		let val = inputs[i].value;
		if (!key) continue;
		if (val) {
			credsMap.set(key, val);
		} else {
			credsMap.delete(key);
		}
	}

	let newCreds = [];
	for (let [key, val] of credsMap) {
		if (val.indexOf('"') >= 0 && val.indexOf("'") < 0) {
			newCreds.push(key + "='" + val + "'");
		} else {
			newCreds.push(key + '="' + val.replace(/"/g, '') + '"');
		}
	}

	if (newCreds.length === creds.length && newCreds.every((v, idx) => v === creds[idx])) {
		return;
	}

	mapObj._syncingCreds = true;
	try {
		credentialsDynList.setValue(newCreds);
	} finally {
		mapObj._syncingCreds = false;
	}
}

function _applyTableCellTitles(tableEl) {
	if (!tableEl) return;
	let titles = Array.from(tableEl.querySelectorAll('.tr.table-titles > .th')).map(th => (th.textContent || '').trim());
	let rows = tableEl.querySelectorAll('.tr:not(.table-titles):not(.placeholder)');
	for (let row of rows) {
		let cells = row.querySelectorAll(':scope > .td');
		for (let i = 0; i < cells.length; i++) {
			if (titles[i] && !cells[i].hasAttribute('data-title')) {
				cells[i].setAttribute('data-title', titles[i]);
			}
		}
	}
}

function _parseKeyValueListToMap(paramsKeyVals) {
	let map = new Map();
	if (!paramsKeyVals) return map;
	for (let paramKeyVal of paramsKeyVals) {
		let pos = paramKeyVal.indexOf('=');
		if (pos <= 0) continue;
		let name = paramKeyVal.slice(0, pos).trim();
		let val = paramKeyVal.slice(pos + 1).trim();
		if (val.length >= 2 &&
			((val.startsWith('"') && val.endsWith('"')) ||
			 (val.startsWith("'") && val.endsWith("'")))) {
			val = val.slice(1, -1);
		}
		map.set(name, val);
	}
	return map;
}

function _handleCheckService(event, section_id, newVal) {
	let link = document.getElementById('wikiInstructionUrl');
	if (link) {
		let safeId = /^[A-Za-z0-9_]+$/.test(newVal || '') ? newVal : '';
		link.href = 'https://github.com/acmesh-official/acme.sh/wiki/dnsapi#' + encodeURIComponent(safeId);
	}
}
