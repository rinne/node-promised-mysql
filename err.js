module.exports = function(name, msg) {
	var av = Array.from(arguments);
	if (av.length > 1) {
		name = av.shift().toString();
	} else {
		name = 'GenericError';
	}
	if (av.length > 0) {
		msg = av.map(function(s) { return s.toString().trim(); }).filter(function(s) { return (s!==''); }).join(' ');
	} else {
		msg = 'Unknown error';
	}
	var e = new Error(msg);
	e.name = name;
	var sp = e.stack.split("\n");
	if (sp.length > 2) {
		//e.stack = sp.slice(0,1).concat(sp.slice(2)).join("\n");
		e.stack = sp.join("\n");
	}
	return e;
}
