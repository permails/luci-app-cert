// See https://github.com/acmesh-official/acme.sh/wiki/DNS-API-Structural-Info-description
class DnsApiInfo {
	Id = '';
	Name = '';
	Site = '';
	Docs = '';
	Domains = '';
	OptsTitle = '';
	Opts = [];
	OptsAltTitle = '';
	OptsAlt = [];
}

class DnsApiInfoOpt {
	Name = '';
	Title = '';
	Description = '';
	Default = '';
}

const KNOWN_FIELDS = [
	'Site:', 'Docs:', 'Help:', 'Options:', 'OptionsAlt:',
	'Domains:', 'Issues:', 'Author:', 'Wiki:', 'Note:'
];

function parseFile(infoFileText) {
	if (!infoFileText) {
		return [];
	}
	let infoFileLines = infoFileText.split('\n');
	let infos = [];
	let startIdx = 0;
	for (let i = 0; i <= infoFileLines.length; i++) {
		if (i === infoFileLines.length || infoFileLines[i] === '') {
			if (i - startIdx > 2) {
				let infoLines = infoFileLines.slice(startIdx, i);
				let info = parseDnsApiInfoLines(infoLines);
				if (info.Id) {
					infos.push(info);
				}
			}
			startIdx = i + 1;
		}
	}
	return infos;
}

function parseDnsApiInfoLines(lines) {
	let info = new DnsApiInfo();
	info.Id = lines.shift();
	info.Name = lines.shift();
	info.Site = getFieldVal(lines, 'Site:');
	info.Docs = getFieldVal(lines, 'Docs:');
	let optsField = getFieldVal(lines, 'Options:');
	let [optsTitle, opts] = parseOpts(optsField);
	info.OptsTitle = optsTitle;
	info.Opts = opts;
	let optsAltField = getFieldVal(lines, 'OptionsAlt:');
	let [optsAltTitle, optsAlt] = parseOpts(optsAltField);
	info.OptsAltTitle = optsAltTitle;
	info.OptsAlt = optsAlt;
	info.Domains = getFieldVal(lines, 'Domains:');
	return info;
}

function parseOpts(options) {
	let opts = [];
	if (!options) {
		return ['', opts];
	}
	let optLines = options.split('\n');
	let optsTitle = optLines.shift();
	for (let rawLine of optLines) {
		let optLine = rawLine.trim();
		if (!optLine) {
			continue;
		}
		let opt = new DnsApiInfoOpt();
		let posName = optLine.indexOf(' ');
		if (posName <= 0) {
			opt.Name = optLine;
			opt.Title = optLine;
			opts.push(opt);
			continue;
		}
		opt.Name = optLine.substring(0, posName);
		let rest = optLine.substring(posName + 1).trim();
		let posTitle = rest.indexOf('. ');
		if (posTitle < 0 && rest.endsWith('.')) {
			posTitle = rest.length - 1;
		}
		if (posTitle <= 0) {
			opt.Title = rest || opt.Name;
		} else {
			opt.Title = rest.substring(0, posTitle);
			opt.Description = rest.substring(posTitle);
			let defaultPos = opt.Description.indexOf(' Default: "');
			if (defaultPos >= 0) {
				let defaultPosEnd = opt.Description.indexOf('".', defaultPos + 1);
				if (defaultPosEnd < 0) {
					defaultPosEnd = opt.Description.indexOf('"', defaultPos + ' Default: "'.length);
				}
				if (defaultPosEnd >= 0) {
					opt.Default = opt.Description.substring(defaultPos + ' Default: "'.length, defaultPosEnd);
					opt.Description = opt.Description.substring(0, defaultPos);
				}
			}
			if (opt.Description.startsWith('. ')) {
				opt.Description = opt.Description.substring(2);
			} else if (opt.Description === '.') {
				opt.Description = '';
			}
		}
		opts.push(opt);
	}
	return [optsTitle, opts];
}

function getFieldVal(lines, fieldName) {
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].startsWith(fieldName)) {
			let firstVal = lines[i].substring(fieldName.length).trim();
			let nextLines = lines.slice(i + 1);
			return fieldMultiLines(nextLines, firstVal);
		}
	}
	return '';
}

function fieldMultiLines(lines, fieldVal) {
	while (lines.length > 0) {
		let line = lines[0];
		if (!line.trim()) {
			break;
		}
		if (KNOWN_FIELDS.some(f => line.startsWith(f))) {
			break;
		}
		lines.shift();
		fieldVal += '\n' + line.trim();
	}
	return fieldVal;
}

return L.Class.extend({
	parseFile: parseFile,
});
