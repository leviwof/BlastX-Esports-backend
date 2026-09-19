import { readFileSync } from 'fs';
import { join } from 'path';

export interface BuildInfo {
  commit: string;
  branch?: string;
  builtAt?: string;
}

let cached: BuildInfo | null = null;

/**
 * Build metadata stamped by scripts/write-build-info.js during `npm run build`.
 * Lets boot logs and /health prove which revision is actually deployed, so a
 * stale Railway deployment cannot masquerade as a failed fix.
 */
export function getBuildInfo(): BuildInfo {
  if (cached) return cached;
  try {
    cached = JSON.parse(readFileSync(join(__dirname, '..', 'build-info.json'), 'utf8')) as BuildInfo;
  } catch {
    cached = {
      commit: (process.env.RAILWAY_GIT_COMMIT_SHA ?? 'local').slice(0, 7),
      branch: process.env.RAILWAY_GIT_BRANCH,
    };
  }
  return cached;
}
