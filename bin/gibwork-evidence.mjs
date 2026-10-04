#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '..');
const packageInfo = JSON.parse(readFileSync(resolve(project, 'package.json'), 'utf8'));

function usage() {
  console.error(`gibwork-evidence

Commands:
  run --task <id> --label <name> -- <command> [args...]
  verify <manifest.json>
  bundle <manifest.json> [output.md]
  task <id> [--keypair path]

Environment:
  EVIDENCE_DIR       output directory (default: ./evidence)
  GIBWORK_KEYPAIR_PATH  owner-only keypair for the official Gibwork CLI
`);
}

function die(message, code = 2) { console.error(`error: ${message}`); process.exit(code); }
function argValue(args, flag, required = true) {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) { if (required) die(`missing ${flag}`); return undefined; }
  return args[i + 1];
}
function sha256(data) { return createHash('sha256').update(data).digest('hex'); }
function sha256File(path) { return sha256(readFileSync(path)); }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function isoRunId(date = new Date()) { return date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14); }
function runCommand(argv, timeoutMs = 120000) {
  const started = new Date();
  const result = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  const finished = new Date();
  return {
    command: argv,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished - started,
    exitCode: result.status,
    signal: result.signal ?? null,
    timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
    spawnError: result.error ? String(result.error.message) : null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}
function artifactEntry(path, root) {
  const rel = path.replace(`${root}/`, '');
  return { path: rel, bytes: statSync(path).size, sha256: sha256File(path) };
}

async function publicTask(taskId) {
  const url = `https://gib.work/api/tasks/${encodeURIComponent(taskId)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`public task API returned HTTP ${response.status}`);
  return { source: 'gibwork-public-api', url, task: await response.json() };
}
function cliTask(taskId, keypair) {
  const cli = resolve(project, 'node_modules/.bin/gibwork');
  const args = [cli, '--json'];
  if (keypair) args.push('--keypair', keypair);
  args.push('task', 'get', taskId);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'Gibwork CLI failed').trim());
  return { source: 'gibwork-cli', task: JSON.parse(r.stdout) };
}
async function loadTask(taskId, keypair) {
  if (keypair) {
    try { return cliTask(taskId, keypair); } catch (e) { console.error(`warning: CLI task lookup failed (${e.message}); using public read-only endpoint`); }
  }
  return publicTask(taskId);
}

async function runCapture(args) {
  const taskId = argValue(args, '--task');
  const label = argValue(args, '--label');
  const separator = args.indexOf('--');
  if (!taskId || !label || separator < 0 || separator === args.length - 1) die('run needs --task, --label, and a command after --');
  const command = args.slice(separator + 1);
  const outRoot = resolve(process.cwd(), process.env.EVIDENCE_DIR || 'evidence');
  const runId = `${isoRunId()}-${label.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'run'}`;
  const dir = resolve(outRoot, runId);
  mkdirSync(dir, { recursive: true });
  const result = runCommand(command);
  writeFileSync(resolve(dir, 'stdout.txt'), result.stdout);
  writeFileSync(resolve(dir, 'stderr.txt'), result.stderr);
  const keypair = process.env.GIBWORK_KEYPAIR_PATH;
  const task = await loadTask(taskId, keypair);
  const manifest = {
    schema: 'gibwork-evidence/v1',
    runId,
    taskId,
    label,
    createdAt: new Date().toISOString(),
    runner: { name: packageInfo.name, version: packageInfo.version, gibworkCli: packageInfo.dependencies['@gibwork/cli'] },
    execution: { command: result.command, startedAt: result.startedAt, finishedAt: result.finishedAt, durationMs: result.durationMs, exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, spawnError: result.spawnError },
    taskSnapshot: task,
    artifacts: []
  };
  manifest.artifacts = [artifactEntry(resolve(dir, 'stdout.txt'), dir), artifactEntry(resolve(dir, 'stderr.txt'), dir)];
  writeJson(resolve(dir, 'manifest.json'), manifest);
  const manifestHash = sha256File(resolve(dir, 'manifest.json'));
  writeFileSync(resolve(dir, 'manifest.sha256'), `${manifestHash}  manifest.json\n`);
  console.log(JSON.stringify({ ok: result.exitCode === 0 && !result.timedOut, directory: dir, manifest: resolve(dir, 'manifest.json'), manifestSha256: manifestHash, exitCode: result.exitCode, taskSource: task.source }, null, 2));
  process.exitCode = result.exitCode === 0 && !result.timedOut ? 0 : 1;
}

function verify(manifestPath) {
  const path = resolve(process.cwd(), manifestPath);
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const root = dirname(path);
  const checks = manifest.artifacts.map((a) => {
    const full = resolve(root, a.path);
    const exists = existsSync(full);
    const actual = exists ? sha256File(full) : null;
    return { path: a.path, exists, expected: a.sha256, actual, ok: exists && actual === a.sha256 };
  });
  const manifestHash = sha256File(path);
  const digestPath = resolve(root, 'manifest.sha256');
  const recorded = existsSync(digestPath) ? readFileSync(digestPath, 'utf8').trim().split(/\s+/)[0] : null;
  const result = { ok: checks.every((c) => c.ok) && (!recorded || recorded === manifestHash), manifestSha256: manifestHash, recordedManifestSha256: recorded, artifacts: checks };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

function bundle(manifestPath, output) {
  const path = resolve(process.cwd(), manifestPath);
  const m = JSON.parse(readFileSync(path, 'utf8'));
  const out = resolve(process.cwd(), output || `${path.replace(/\.json$/, '')}.md`);
  const lines = [
    `# Gibwork Evidence Bundle: ${m.label}`,
    '', `- Task: \`${m.taskId}\``, `- Run: \`${m.runId}\``, `- Schema: \`${m.schema}\``,
    `- Command: \`${m.execution.command.map((x) => x.replaceAll('`', '\`')).join(' ')}\``,
    `- Exit code: \`${m.execution.exitCode}\``, `- Duration: ${m.execution.durationMs} ms`,
    '', '## Integrity', '', ...m.artifacts.map((a) => `- \`${a.path}\` — ${a.bytes} bytes — SHA-256 \`${a.sha256}\``),
    '', '## Reproduction', '', '```sh', `node bin/gibwork-evidence.mjs verify ${manifestPath}`, '```',
    '', 'This bundle was produced by a terminal workflow and can be checked without trusting the original terminal session.'
  ];
  writeFileSync(out, `${lines.join('\n')}\n`);
  console.log(JSON.stringify({ ok: true, output: out }, null, 2));
}

const [, , command, ...args] = process.argv;
if (!command || command === '--help' || command === '-h') { usage(); process.exit(command ? 0 : 2); }
if (command === 'run') await runCapture(args);
else if (command === 'verify') { const p = args[0]; if (!p) die('verify needs a manifest path'); verify(p); }
else if (command === 'bundle') { const p = args[0]; if (!p) die('bundle needs a manifest path'); bundle(p, args[1]); }
else if (command === 'task') { const id = args[0]; if (!id) die('task needs a task id'); const keypair = argValue(args, '--keypair', false) || process.env.GIBWORK_KEYPAIR_PATH; console.log(JSON.stringify(await loadTask(id, keypair), null, 2)); }
else die(`unknown command: ${command}`);
