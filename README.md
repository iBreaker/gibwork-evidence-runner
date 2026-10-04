# Gibwork Evidence Runner

A terminal-first evidence packager for Gibwork submissions. It solves a common review problem: a screenshot of a successful command does not prove which input was used, what actually ran, or whether the output was changed afterward.

`gibwork-evidence` runs a developer or operations command, snapshots the selected Gibwork task through the official `@gibwork/cli` (with a read-only public API fallback), stores stdout/stderr, and writes a manifest containing exit status, timing, task metadata, and SHA-256 digests. A reviewer can verify the bundle offline.

This is a non-web-app workflow: it runs entirely in a terminal or CI job and produces portable Markdown/JSON artifacts.

## Install

Requirements: Node.js 22+.

```sh
npm install
npm test
```

The project depends on the official Gibwork CLI (`@gibwork/cli`). No private key is committed or loaded from `.env`.

## Quick start

Capture a reproducible command for the hackathon task:

```sh
node bin/gibwork-evidence.mjs run \
  --task 1052f22d-3f87-4b1d-b0d7-71a60679e7fa \
  --label smoke-test \
  -- node -e 'console.log(JSON.stringify({ok:true, value:42}))'
```

The command creates `evidence/<run>/stdout.txt`, `stderr.txt`, `manifest.json`, and `manifest.sha256`. The task snapshot uses `gibwork task get` when `GIBWORK_KEYPAIR_PATH` is set; otherwise it uses Gibwork's public read-only task endpoint.

Verify integrity without network access:

```sh
node bin/gibwork-evidence.mjs verify evidence/<run>/manifest.json
node bin/gibwork-evidence.mjs bundle evidence/<run>/manifest.json
```

The `bundle` command creates a reviewer-friendly Markdown summary. Changing stdout, stderr, or any manifest artifact makes verification fail.

## Demo

- [Terminal demo video](examples/demo.mp4)
- [Terminal screenshot](examples/terminal-demo.png)

## Why this is a Gibwork use case

- **SDK/CLI integration:** the official `@gibwork/cli` is invoked for task retrieval and its JSON result is embedded in the evidence manifest.
- **Practical outcome:** agents and CI systems can submit work with a tamper-evident reproduction record instead of a screenshot-only claim.
- **Non-web:** no browser or dashboard is required; the output is a portable evidence directory.
- **Safe by default:** credentials stay in the caller's environment or owner-only keypair file and are never written into the bundle.

## Sample output

```json
{
  "ok": true,
  "directory": ".../evidence/20261004123456-smoke-test",
  "manifestSha256": "<64 hex characters>",
  "exitCode": 0,
  "taskSource": "gibwork-public-api"
}
```

## Design notes

The manifest is intentionally explicit: command arguments, timestamps, exit code, timeout state, task snapshot source, and artifact digests. This makes it suitable for terminal agents, scheduled CI runs, and audit handoffs where a reviewer needs to reproduce the result rather than trust a mutable screenshot.
