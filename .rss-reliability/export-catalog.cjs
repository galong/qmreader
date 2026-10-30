'use strict';
const path = require('node:path');
const fetcher = require(path.join(process.env.RSS_APP_DIR || path.resolve(__dirname, '..'), 'lib/fetcher.js'));
fetcher.loadDisk({ upsert: false });
const { remoteSource } = require('./bounded-fetch.cjs');
const sources = fetcher.getSourcesMeta().filter(s => s.enabled && (!s.optIn || s.lastAttemptAt))
  .map(s => fetcher.getSourceById(s.id)).filter(s => s && !s.manual).map(remoteSource);
process.stdout.write(JSON.stringify(sources));
