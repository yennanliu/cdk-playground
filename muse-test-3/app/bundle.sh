#!/usr/bin/env bash
#
# Build the one code bundle every piece runs from -- the AgentCore Runtime and
# all three Lambdas: Linux arm64 wheels for the locked dependencies, plus the app.
#
#   ./bundle.sh <out-dir>        # CDK calls this during synth (locally, or in Docker without uv)
#
set -euo pipefail
src="$(cd "$(dirname "$0")" && pwd)"
out="$1"

requirements="$(mktemp)"
trap 'rm -f "$requirements"' EXIT
uv export --project "$src" --frozen --no-dev --no-emit-project --no-hashes -q -o "$requirements"
uv pip install -q --target "$out" --python-platform aarch64-manylinux_2_28 --python-version 3.13 \
  --only-binary :all: -r "$requirements"

cp "$src/main.py" "$out/"
cp -R "$src/muse" "$out/"
find "$out/muse" -name __pycache__ -prune -exec rm -rf {} +
