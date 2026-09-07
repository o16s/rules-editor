#!/bin/sh
# Build the rule engine for the browser and put it beside the package.
#
# The Simulator page runs the engine itself rather than a second reading of
# it, so what an operator sees before deploying a file is what the gateway
# does with it. This script needs Go; a contributor who only touches
# TypeScript does not run it, because dist/ is committed.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out="$root/dist"
mkdir -p "$out"

echo ">> building rules-engine for js/wasm"
cd "$root/rules-engine"
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o "$out/rules-engine.wasm" ./cmd/wasm

glue="$(go env GOROOT)/lib/wasm/wasm_exec.js"
if [ ! -f "$glue" ]; then
  glue="$(go env GOROOT)/misc/wasm/wasm_exec.js"
fi
if [ ! -f "$glue" ]; then
  echo "!! wasm_exec.js not found under $(go env GOROOT)" >&2
  exit 1
fi
cp "$glue" "$out/wasm_exec.js"

size=$(wc -c < "$out/rules-engine.wasm")
echo ">> dist/rules-engine.wasm  $((size / 1024)) KB"
echo ">> dist/wasm_exec.js       from $(go env GOVERSION)"
