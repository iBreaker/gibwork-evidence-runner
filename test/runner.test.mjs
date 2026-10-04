import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, 'bin/gibwork-evidence.mjs');

test('captures a command and verifies its digest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gibwork-evidence-'));
  const run = spawnSync(process.execPath, [cli, 'run', '--task', '1052f22d-3f87-4b1d-b0d7-71a60679e7fa', '--label', 'test', '--', process.execPath, '-e', 'console.log("ok")'], { cwd: dir, encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  const verify = spawnSync(process.execPath, [cli, 'verify', result.manifest], { cwd: dir, encoding: 'utf8' });
  assert.equal(verify.status, 0, verify.stderr);
  assert.equal(JSON.parse(verify.stdout).ok, true);
  rmSync(dir, { recursive: true, force: true });
});

test('detects tampering in an artifact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gibwork-evidence-'));
  const run = spawnSync(process.execPath, [cli, 'run', '--task', '1052f22d-3f87-4b1d-b0d7-71a60679e7fa', '--label', 'tamper', '--', process.execPath, '-e', 'console.log("ok")'], { cwd: dir, encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  const manifest = JSON.parse(readFileSync(result.manifest, 'utf8'));
  writeFileSync(join(result.directory, manifest.artifacts[0].path), 'changed\n');
  const verify = spawnSync(process.execPath, [cli, 'verify', result.manifest], { cwd: dir, encoding: 'utf8' });
  assert.equal(verify.status, 1);
  assert.equal(JSON.parse(verify.stdout).ok, false);
  rmSync(dir, { recursive: true, force: true });
});
