#! /usr/local/bin/node
/*jslint node:true */
// provisionKvmAndCache.js
// ------------------------------------------------------------------
// provision the KVMs and cache for the example API proxy that logs to
// stackdriver.
//
// last saved: <2017-February-13 22:02:54>

var fs = require('fs'),
    common = require('./lib/utility.js'),
    sprintf = require('sprintf-js').sprintf,
    async = require('async'),
    apigeeEdge = require('./lib/edge.js'),
    NodeRSA = require('node-rsa'),
    uuidV4 = require('uuid/v4'),
    Getopt = require('node-getopt'),
    version = '20170213-1758',
    defaults = { secretsmap : 'secrets1', settingsmap: 'settings1', cache: 'cache1' },
    getopt = new Getopt(common.commonOptions.concat([
      ['e' , 'env=ARG', 'the Edge environment for which to store the KVM data'],
      ['K' , 'secretsmap=ARG', 'optional. name of the KVM in Edge for keys. Will be created if nec. Default: ' + defaults.secretsmap],
      ['C' , 'cache=ARG', 'optional. name of the Cache in Edge. Will be created if nec. Default: ' + defaults.cache],
      ['S' , 'settingsmap=ARG', 'optional. name of the KVM in Edge for other non-secret settings. Will be created if nec. Default: ' + defaults.settingsmap],
      ['P' , 'projectid=ARG', 'required. stackdriver profile id for logging.'],
      ['L' , 'logid=ARG', 'required. stackdriver log id for logging.'],
      ['I' , 'issuer=ARG', 'required. issuer for the JWT for stackdriver.'],
      ['k' , 'privkeypem=ARG', 'required. file containing private key (PEM format)']
    ])).bindHelp();

// ========================================================

console.log(
  'Apigee Edge provisioning tool for KVM + Cache for Stackdriver demo, version: ' + version + '\n' +
    'Node.js ' + process.version + '\n');

common.logWrite('start');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

if ( !opt.options.env ) {
  console.log('You must specify an environment');
  getopt.showHelp();
  process.exit(1);
}
if ( !opt.options.projectid ) {
  console.log('You must specify a projectid (-P)');
  getopt.showHelp();
  process.exit(1);
}
if ( !opt.options.logid ) {
  console.log('You must specify a logid (-L)');
  getopt.showHelp();
  process.exit(1);
}
if ( !opt.options.issuer ) {
  console.log('You must specify an issuer (-I)');
  getopt.showHelp();
  process.exit(1);
}
if ( !opt.options.privkeypem ) {
  console.log('You must specify a file containing the private key (-k)');
  getopt.showHelp();
  process.exit(1);
}

if ( !opt.options.secretsmap ) {
  common.logWrite(sprintf('defaulting to %s for secrets map', defaults.secretsmap));
  opt.options.secretsmap = defaults.secretsmap;
}
if ( !opt.options.settingsmap ) {
  common.logWrite(sprintf('defaulting to %s for settings map', defaults.settingsmap));
  opt.options.settingsmap = defaults.settingsmap;
}
if ( !opt.options.cache ) {
  common.logWrite(sprintf('defaulting to %s for cache', defaults.cache));
  opt.options.cache = defaults.cache;
}

common.verifyCommonRequiredParameters(opt.options, getopt);

function loadDataIntoMaps(cb) {
  var re = new RegExp('(?:\r\n|\r|\n)', 'g');
  var pemString = fs.readFileSync(opt.options.privkeypem, 'utf8').replace(re,'\\n');
  var options = {
        env: opt.options.env,
        kvm: opt.options.secretsmap,
        key: 'stackdriver.privKeyPem',
        value: pemString
      };
  common.logWrite(sprintf('loading PEM %s into %s', opt.options.privkeypem, opt.options.secretsmap));
  apigeeEdge.putKvm(options, function(e, result){
    if (e) return cb(e, result);
    options.kvm = opt.options.settingsmap;
    options.key = 'stackdriver.projectid';
    options.value = opt.options.projectid;
    apigeeEdge.putKvm(options, function(e, result){
      if (e) return cb(e, result);
      options.key = 'stackdriver.logid';
      options.value = opt.options.logid;
      apigeeEdge.putKvm(options, function(e, result){
        if (e) return cb(e, result);
        options.key = 'stackdriver.jwt_issuer';
        options.value = opt.options.issuer;
        apigeeEdge.putKvm(options, function(e, result){
          if (e) return cb(e, result);
          cb(null, result);
        });
      });
    });
  });
}

function kvmsLoadedCb(e, result){
  if (e) {
    console.log(e);
    console.log(e.stack);
    process.exit(1);
  }
  common.logWrite('ok. the KVMs were loaded successfully.');
  return checkAndCreateCache(function(e, result){
    if (e) {
      console.log(e);
      console.log(e.stack);
      process.exit(1);
    }
    common.logWrite('ok. the cache exists.');
  });
}


function checkAndCreateCache(cb) {
  apigeeEdge.getCaches({ env: opt.options.env }, function(e, result){
    if (e) {
      console.log(e);
      console.log(e.stack);
      process.exit(1);
    }
    if (result.indexOf(opt.options.cache) == -1) {
      apigeeEdge.createCache({ env: opt.options.env, name: opt.options.cache},
                             function(e, result){
                               if (e) return cb(e);
                               cb(null, opt.options.cache);
                             });
    }
    else {
      return cb(null, opt.options.cache);
    }
  });
}

function createOneKvm(mapname, cb) {
  // create KVM.  Use encrypted if it is for secrets.
  apigeeEdge.createKvm({ env: opt.options.env, name: mapname, encrypted:(mapname == opt.options.secretsmap)},
                       function(e, result){
                         if (e) return cb(e);
                         cb(null, mapname);
                       });
}

function dedupe(e, i, c) { // extra step to remove duplicates
  return c.indexOf(e) === i;
}

apigeeEdge.setEdgeConnection(opt.options.mgmtserver, opt.options.org, {
  headers : { accept: 'application/json' },
  auth : {
    user: opt.options.username,
    pass: opt.options.password,
    sendImmediately : true
  }});


apigeeEdge.getKvms({ env: opt.options.env }, function(e, result){
  if (e) {
    console.log(e);
    console.log(e.stack);
    process.exit(1);
  }

  var missingMaps = [opt.options.settingsmap, opt.options.secretsmap]
    .filter(function(value) { return result.indexOf(value) == -1; })
    .filter(dedupe);

  if (missingMaps && missingMaps.length > 0){
    common.logWrite('Need to create one or more maps');
    async.mapSeries(missingMaps, createOneKvm, function(e, results) {
      if (e) {
        console.log(e);
        console.log(e.stack);
        process.exit(1);
      }
      //console.log(JSON.stringify(results, null, 2) + '\n');
      loadDataIntoMaps(kvmsLoadedCb);
    });
  }
  else {
    common.logWrite('ok. the required maps exist');
    loadDataIntoMaps(kvmsLoadedCb);
  }
});
