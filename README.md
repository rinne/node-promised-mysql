promised-mysql
==============

A Javascript wrapper on top of mysql library enabling promise based
access to mysql connection pool with enhanced query substitution.

Examples
--------

```
const TrPromisedMySQL = require('tr-promised-mysql');

// Config struct is identical to one that can be passed to mysql
// package pool creation.
var m = new TrPromisedMySQL(
  {
     database: 'dbname',
     host: '127.0.0.1',
     user: 'dbuser',
     password: 'verysecret',
     logging: true
  }
};

// Simple query
(m.exec("SELECT a,b,c FROM ::table WHERE d=:val", { table: 'table_name', val: 42 })
 .then(function(res) {
   console.log(res);
 })
 .catch(function(e) {
   throw e;
 }));
```

And somewhat more elaborate use case.

```
const TrPromisedMySQL = require('tr-promised-mysql');
var m = new TrPromisedMySQL(require('./my-db-config.js'));

var conn = undefined;
(m.getConnection()
 .then(function(res) {
   conn = res;
   return m.exec("BEGIN", {}, conn);
 })
 .then(function() {
   // Do something within the transaction ...
 })
 .then(function() {
   // Do something else within the transaction ...
 })
 .then(function() {
   return m.exec("COMMIT", {}, conn);
 })
 .then(function() {
      m.releaseConnection(conn);
      conn = undefined;
 })
 .catch(function(e) {
   if (conn !== undefined) {
      m.releaseConnection(conn, true);
      conn = undefined;
   }
   throw e;
 }));
```

License
-------

MIT
