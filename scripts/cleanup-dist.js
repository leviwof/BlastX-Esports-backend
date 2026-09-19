#!/usr/bin/env node
// Post-build cleanup for the SWC builder.
// swc does not honor tsconfig "exclude", so spec files emitted from src
// (e.g. app.controller.spec.js, tournaments.e2e-spec.js) are removed here
// to keep dist deploy-clean.
const fs = require('fs');
const path = require('path');

function walk(dir) {
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += walk(full);
      if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    } else if (/(\.spec|\.e2e-spec)\.js(\.map|\.d\.ts)?$/.test(entry.name)) {
      fs.rmSync(full);
      removed++;
    }
  }
  return removed;
}

const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  const n = walk(dist);
  if (n > 0) console.log(`cleanup-dist: removed ${n} spec file(s) from dist`);
}
