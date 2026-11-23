'use strict';
'require poll';
'require rpc';
'require view';

const callGetLogs = rpc.declare({
	object: 'luci.cert',
	method: 'get_logs',
	expect: { lines: [] }
});

function _extractLogSeverity(line) {
	if (!line) return '';
	let m = /^\[[^\]]+\]\s+\[([a-z]+)\]/i.exec(line);
	if (m) return m[1].toLowerCase();
	m = /\b(?:daemon|user|kern|syslog|local\d)\.([a-z]+)\b/i.exec(line);
	return m ? m[1].toLowerCase() : '';
}

function _matchesLevel(line, level) {
	if (!level || level === 'all') return true;
	let sev = _extractLogSeverity(line);
	if (!sev) return true;
	if (level === 'err') {
		return sev === 'emerg' || sev === 'alert' || sev === 'crit' || sev === 'err';
	}
	if (level === 'warn+') {
		return sev === 'emerg' || sev === 'alert' || sev === 'crit' || sev === 'err' || sev === 'warn';
	}
	if (level === 'info') {
		return sev === 'info' || sev === 'notice';
	}
	if (level === 'debug') {
		return sev === 'debug';
	}
	return true;
}

return view.extend({
	_keyword: '',
	_level: 'all',
	_lines: [],

	load() {
		return this._fetchLogLines();
	},

	_fetchLogLines() {
		return L.resolveDefault(callGetLogs(), []).then(lines => {
			return Array.isArray(lines) ? lines : [];
		});
	},

	_applyFilter(textarea, countBadge) {
		let kw = (this._keyword || '').trim().toLowerCase();
		let lvl = this._level || 'all';
		let filtered = this._lines.filter(l => {
			if (!_matchesLevel(l, lvl)) return false;
			if (kw && l.toLowerCase().indexOf(kw) < 0) return false;
			return true;
		});

		if (countBadge) {
			countBadge.textContent = _('%d lines').format(filtered.length);
		}
		if (textarea) {
			let wasAtBottom = (textarea.scrollHeight - textarea.scrollTop - textarea.clientHeight) < 24;
			if (filtered.length > 0) {
				textarea.value = filtered.join('\n');
			} else if (this._lines.length > 0) {
				textarea.value = _('No matching logs for the selected level or keyword.');
			} else {
				textarea.value = _('No ACME or certificate logs recorded yet.');
			}
			if (wasAtBottom) {
				textarea.scrollTop = textarea.scrollHeight;
			}
		}
	},

	render(initialLines) {
		this._lines = Array.isArray(initialLines) ? initialLines : [];

		let styleEl = E('style', {}, `
			#maincontent ul.tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; margin: 0 0 16px 0; border-radius: 8px; background: var(--background-color-medium); background: color-mix(in srgb, var(--background-color-low) 60%, var(--background-color-high)); border: 1px solid var(--border-color-low); background-image: none; background-size: auto; }
			#maincontent ul.tabs > li { height: auto !important; max-width: none; margin: 0 !important; border-radius: 6px; border: 1px solid transparent; background: transparent; background-image: none; color: var(--text-color-medium); transition: background 0.15s ease, color 0.15s ease; }
			#maincontent ul.tabs > li > a { padding: 6px 14px; line-height: 1.4; font-size: 13.5px; font-weight: 500; border-radius: 6px; background: transparent; }
			#maincontent ul.tabs > li:not(.active):hover { background: var(--background-color-high); background-image: none; color: var(--primary-color-high); }
			#maincontent ul.tabs > li.active { background: var(--background-color-high); background-image: none; border-color: var(--border-color-low); color: var(--primary-color-high); font-weight: 600; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08); }
			#cbi-cert { background: var(--background-color-medium); background: color-mix(in srgb, var(--background-color-low) 60%, var(--background-color-high)); border: 1px solid var(--border-color-low); border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; }
			#cbi-cert > h2 { margin-top: 0 !important; }
			#cbi-cert > .cbi-map-descr { margin-bottom: 14px; }
			.cert-panel { margin: 0; padding: 0; border-radius: 8px; border: 1px solid var(--border-color-low); background: var(--background-color-high); overflow: hidden; box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05); }
			.cert-panel-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 16px; background: var(--background-color-high); border-bottom: 1px solid var(--border-color-low); }
			.cert-panel-title-wrap { display: flex; align-items: center; gap: 8px; }
			.cert-panel-title-wrap h3 { margin: 0 !important; font-size: 14px; font-weight: 600; color: var(--text-color-high); }
			.cert-count-pill { display: inline-flex; align-items: center; padding: 1px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; color: var(--primary-color-low); background: color-mix(in srgb, var(--primary-color-high) 10%, var(--background-color-high)); }
			:root[data-darkmode="true"] .cert-count-pill { color: var(--primary-color-high); }
			.cert-log-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
			.cert-log-tools select { width: auto; min-width: 140px; height: 28px; padding: 2px 8px; font-size: 12.5px; border-radius: 4px; }
			.cert-log-tools input[type="text"] { width: 190px; max-width: 100%; height: 28px; padding: 3px 9px; font-size: 12.5px; border-radius: 4px; }
			.cert-log-body { padding: 12px 16px 14px 16px; background: var(--background-color-high); }
			.cert-log-textarea { width: 100%; height: 500px; min-height: 280px; resize: vertical; font-family: var(--font-mono, monospace); font-size: 12px; line-height: 1.55; padding: 12px 14px; border-radius: 6px; border: 1px solid var(--border-color-low); background: color-mix(in srgb, var(--background-color-medium) 55%, var(--background-color-high)); color: var(--text-color-high); white-space: pre; overflow: auto; box-sizing: border-box; }
			@media screen and (max-width: 768px), screen and (max-device-width: 600px) {
				#maincontent ul.tabs { margin: 0 0 12px 0; padding: 4px; background: color-mix(in srgb, var(--background-color-low) 60%, var(--background-color-high)); background-image: none; }
				#maincontent ul.tabs > li { flex: 1 1 auto; justify-content: center; height: auto !important; }
				#maincontent ul.tabs > li > a { width: 100%; text-align: center; padding: 6px 10px; line-height: 1.35; font-size: 13px; }
				#cbi-cert { padding: 14px 12px; border-radius: 8px; }
				.cert-panel-head { padding: 10px 12px; flex-direction: column; align-items: stretch; }
				.cert-log-tools { width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
				.cert-log-tools select, .cert-log-tools input[type="text"] { grid-column: 1 / -1; width: 100%; height: 36px; font-size: 16px; box-sizing: border-box; }
				.cert-log-tools .cbi-button { width: 100%; min-height: 34px; margin: 0; text-align: center; }
				.cert-log-body { padding: 10px 12px 12px 12px; }
				.cert-log-textarea { height: 55vh; min-height: 240px; padding: 10px; font-size: 11.5px; line-height: 1.5; }
			}
		`);

		let countBadge = E('span', { 'class': 'cert-count-pill' }, '');
		let textarea = E('textarea', {
			'class': 'cert-log-textarea',
			'readonly': 'readonly',
			'wrap': 'off',
			'spellcheck': 'false'
		});

		let levelSelect = E('select', {
			'aria-label': _('Log level filter'),
			'change': ev => {
				this._level = ev.target.value || 'all';
				this._applyFilter(textarea, countBadge);
			}
		}, [
			E('option', { 'value': 'all' }, _('All Levels')),
			E('option', { 'value': 'err' }, _('Errors Only (err)')),
			E('option', { 'value': 'warn+' }, _('Warnings & Errors (warn+)')),
			E('option', { 'value': 'info' }, _('Info (info / notice)')),
			E('option', { 'value': 'debug' }, _('Debug (debug)'))
		]);

		let searchInput = E('input', {
			'type': 'text',
			'placeholder': _('Filter keyword...'),
			'input': ev => {
				this._keyword = ev.target.value || '';
				this._applyFilter(textarea, countBadge);
			}
		});

		let refreshBtn = E('button', {
			'type': 'button',
			'class': 'cbi-button cbi-button-action',
			'click': () => {
				refreshBtn.disabled = true;
				this._fetchLogLines().then(lines => {
					this._lines = lines;
					this._applyFilter(textarea, countBadge);
				}).finally(() => {
					refreshBtn.disabled = false;
				});
			}
		}, _('Refresh'));

		let bottomBtn = E('button', {
			'type': 'button',
			'class': 'cbi-button cbi-button-neutral',
			'click': () => { textarea.scrollTop = textarea.scrollHeight; }
		}, _('Scroll to Bottom'));

		let topBtn = E('button', {
			'type': 'button',
			'class': 'cbi-button cbi-button-neutral',
			'click': () => { textarea.scrollTop = 0; }
		}, _('Scroll to Top'));

		this._applyFilter(textarea, countBadge);
		requestAnimationFrame(() => { textarea.scrollTop = textarea.scrollHeight; });

		poll.add(() => {
			return this._fetchLogLines().then(lines => {
				this._lines = lines;
				this._applyFilter(textarea, countBadge);
			});
		}, 5);

		return E('div', { 'id': 'cbi-cert', 'class': 'cbi-map' }, [
			styleEl,
			E('h2', {}, _('Certificate Log')),
			E('div', { 'class': 'cbi-map-descr' },
				_('Showing all ACME certificate management, issuance, deployment, and update logs (cert).')),
			E('div', { 'class': 'cert-panel' }, [
				E('div', { 'class': 'cert-panel-head' }, [
					E('div', { 'class': 'cert-panel-title-wrap' }, [
						E('h3', {}, _('Log Output')),
						countBadge
					]),
					E('div', { 'class': 'cert-log-tools' }, [
						levelSelect,
						searchInput,
						refreshBtn,
						bottomBtn,
						topBtn
					])
				]),
				E('div', { 'class': 'cert-log-body' }, [
					textarea
				])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
