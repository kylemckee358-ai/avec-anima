// Manual one-off manifest rebuild — run after adding/editing/removing an event folder by hand:
//   node build-events.js
//
// Not needed if you're using the admin page + `node server.js` — the server rebuilds
// the manifest automatically after every change.

const { writeManifest, EVENTS_ROOT } = require('./lib/events-data');
const path = require('path');

const manifest = writeManifest();
console.log(
  `Wrote ${path.join(EVENTS_ROOT, 'manifest.json')} — ${manifest.upcoming.length} upcoming, ${manifest.previous.length} previous`
);
