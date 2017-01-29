'use strict';

const mysql = require('mysql');
const err = require('./err.js');
const KeepTime = require('keeptime');

var TrPromisedMySQL = function(config) {
	if (! (config && (typeof(config) === 'object'))) {
        throw err('Bad database configuration object');
	}
	this.logging = config.logging ? true : false;
	this.pool = mysql.createPool(config);
	this.pool.config.connectionConfig.queryFormat = queryFormat;
	this.reservedConns = new Set();
};

//
// This render function handles ?, ??, :key, and ::key substitutions and
// is aware of string literals within the query
// - ? and ?? require values object to be an array
// - Array length must be exactly the number of ? and ?? total in the query
// - ? is substituted as a value
// - ?? is substituted as an identifier
// - :key and ::key require values object to be an object having values
//   for all substitute keys defined
// - :key is substituted with values[key] as a value
// - ::key is substituted with values[key] as an identifier
// - It is supported, however unadvisable to mix question mark and colon
//   notation in a single query
//
var queryFormat = function(query, values) {
	var kt = (this.logging ? new KeepTime(true) : undefined);
    var c = query.split('');
    var o = '', ol = [], e = undefined, el = [],  q = undefined, escaped = false, pq = undefined;
    if (! values) {
        values = [];
    }
	if (typeof(values) !== 'object') {
        throw err('Bad query substitution object');
	}
    c.forEach(function(c) {
        if (pq !== undefined) {
			// This is a first char after the character
			// constant. MySQL quotes can also be escaped by doubling
			// the quote (i.e. '''' is a string constant of a single
			// '). We handle it here so that the constant gets
			// terminated if we see a matching unescaped closing
			// quote, but if immediately after the closing quote there
			// is another identical quote, we go back inside the
			// quoted content.
            if ((o === '') && (e === undefined) && (q === undefined))  {
                if (c === pq) {
                    o = undefined;
                    e = el.pop();
                    q = pq;
                    escaped = true;
                }
            } else {
                throw err('Internal error');
            }
            pq = undefined;
        }
        if ((o !== undefined) && (e === undefined) && (q === undefined))  {
			// We are outside of the quoted content. The only thing
			// that interests us here, is whether we see a quote
			// character that would make us go inside quoted content.
            if (['"', '`', "'"].indexOf(c) < 0) {
                o += c;
            } else {
                ol.push(o);
                q = c;
                o = undefined;
                e = c;
            }
        } else if ((o === undefined) && (e !== undefined) && (q !== undefined))  {
			// We are inside quoted content. Escaped character is
			// copied as is, backslash is an escape we detect here,
			// other characters that happen not to be matching closing
			// quote are just copied, and matching closing quote
			// terminates the quoted content and puts us back to
			// non-quoted state. This may get reversed if the next
			// character happens to be the terminating quote again.
            if (escaped) {
                e += c;
                escaped = false;
            } else if (c === "\\") {
                e += c;
                escaped = true;
            } else if (c !== q) {
                e += c;
            } else {
                pq = q;
                e += c;
                el.push(e);
                q = undefined;
                e = undefined;
                o = '';
            }
        } else {
            throw err('Internal error');
        }
    });
	// If we are inside quoted content (or in escaped mode, which
	// should not happen if we aren't inside quoted content) we have
	// garbage in statement, because there is an unterminated
	// statement.
    if (escaped || (e !== undefined)) {
        throw err('Unterminated statement');
    }
	// Push the last non-quoted content to the array and also an empty
	// string to quoted content array so that both arrays have the
	// same number of items so they can be later conveniently
	// concatenated.
    ol.push(o);
    o = undefined;
    el.push('');
	// Make substitutions but only to non-quoted content.
	// Remember to bind pool object all the way down.
	var qmIdx = 0;
    ol = ol.map(function(o) {
		o = o.replace(/(:(:?)(\w+))|(\?(.?))/g, function (txt,
														  colonNotation,
														  idMark,
														  key,
														  qmNotation,
														  qmTail) {
			var rv;
			if (colonNotation !== undefined) {
				var id = (idMark === ':');
				if (! values.hasOwnProperty(key)) {
					throw err('Unknown ' + (id ? 'identifier' : 'value') + ' substitution "' + key + '"');
				}
				rv = (id ? this.escapeId(values[key]) : this.escape(values[key]));
				// console.log('Made ' + (id ? 'identifier' : 'value') + ' substitution "' + key + '" -> ' + rv);
			} else if (qmNotation !== undefined) {
				if (! Array.isArray(values)) {
					throw err('Bad query substitution array');
				}
				if (values.length <= qmIdx) {
					throw err('Query substitution array too small');
				}
				if (qmTail === '?') {
					rv = this.escapeId(values[qmIdx]);
				} else {
					rv = this.escape(values[qmIdx]) + qmTail;
				}
				qmIdx++;
			} else {
				throw err('Internal error');
			}
			return rv;
		}.bind(this));
        return o;
    }.bind(this));
	if (Array.isArray(values) && (values.length != qmIdx)) {
		throw err('Query substitution array too big');
	}
	// And rebuild the query with substituted contents.
	query = '';
	while (ol.length > 0) {	
 		query += ol.shift() + el.shift();
	}
	if (kt) {
		console.log('Query substitution time was ' + kt.get().toFixed(9) + ' seconds.');
	}
	console.log(query);
	return query;
};

var counter = (function(d) {
	d = {};
	return function(n) {
		n = (n === undefined) ? '' : n.toString();
		if (d[n] === undefined) {
			d[n] = 0;
		}
		return (++(d[n]));
	}
})();

var executeQuery = function (pool, query, params) {
	var kt = (this.logging ? new KeepTime(true) : undefined);
	var qid = counter('query-id');
	return new Promise(function (resolve, reject) {
		pool.query(query, params || {}, function (e, rows) {
			if (kt) {
				kt.stop();
				if (this.logging) {
					console.log('Query #' + qid + ' execution time was ' + kt.get().toFixed(9) + ' seconds.');
				}
			}
			if (e) {
				return reject({error: e, query: query});
			}
			return resolve(rows);
		}.bind(this));
	}.bind(this));
};

TrPromisedMySQL.prototype.exec = function (query, params, conn) {
	var c;
	var execute = executeQuery.bind(this);
	if (conn) {
		if (! this.reservedConns.has(conn)) {
			return Promise.reject(err('Non-reserved connection'));
		}
		c = conn;
	} else {
		c = this.pool;
	}
	return (execute(c, query, params)
			.catch(function(e) { throw e; }));
};

TrPromisedMySQL.prototype.insert = function (query, params, conn) {
	return (this.exec(query, params, conn)
			.then(function(res) { return res.insertId; })
			.catch(function(e) { throw e; }));
};

TrPromisedMySQL.prototype.getConnection = function () {
	return new Promise(function (resolve, reject) {
		this.pool.getConnection(function (e, conn) {
			if (e) {
				return reject(e);
			}
			this.reservedConns.add(conn);
			return resolve(conn);
		}.bind(this));
	}.bind(this));
};

TrPromisedMySQL.prototype.releaseConnection = function (conn, destroy) {
	return new Promise(function (resolve, reject) {
		if (this.reservedConns.delete(conn)) {
			if (destroy) {
				conn.destroy();
				return resolve(true);
			} else {
				conn.changeUser({}, function(e) {
					if (e) {
						conn.destroy();
					} else {
						conn.release();
					}
					return resolve(true);
				}.bind(this));
			}
		} else {
			return reject(err('Non-reserved connection'));
		}
	}.bind(this));
};

module.exports = TrPromisedMySQL;
