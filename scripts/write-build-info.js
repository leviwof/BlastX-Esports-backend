#!/usr/bin/env node
// Stamps dist/build-info.json with the source revision so the running app can
// report exactly which commit it was built from (Railway sets the RAILWAY_GIT_*
// variables during the build; git is the local fallback).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const sha = process.env.RAILWAY_GIT_COMMIT_SHA || git('rev-parse HEAD');
const info = {
  commit: sha ? sha.slice(0, 7) : 'unknown',
  branch: process.env.RAILWAY_GIT_BRANCH || git('rev-parse --abbrev-ref HEAD') || undefined,
  builtAt: new Date().toISOString(),
};

const dist = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(dist)) {
  console.error('write-build-info: dist/ not found — run the build first');
  process.exit(1);
}
fs.writeFileSync(path.join(dist, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(`build-info: commit=${info.commit} branch=${info.branch ?? 'n/a'} at ${info.builtAt}`);
