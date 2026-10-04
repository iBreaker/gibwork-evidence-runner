#!/usr/bin/env sh
set -eu
node bin/gibwork-evidence.mjs run \
  --task 1052f22d-3f87-4b1d-b0d7-71a60679e7fa \
  --label demo \
  -- node -e 'console.log(JSON.stringify({workflow:"evidence", passed:true}))'
