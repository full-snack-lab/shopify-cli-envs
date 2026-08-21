#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/fixture"

out=$(shopify app dev 2>&1)
code=$?
if [ "$code" -eq 0 ]; then
  echo "guard: expected non-zero exit, got 0" >&2
  exit 1
fi
if ! grep -q 'refusing to run app dev against the "staging" environment' <<<"$out"; then
  echo "guard: abort message missing. Output was:" >&2
  echo "$out" >&2
  exit 1
fi
echo "guard aborts on protected config: ok"

out=$(SHOPIFY_ENVS_UNGUARD=1 timeout 60 shopify app dev 2>&1)
if grep -q 'refusing to run app dev' <<<"$out"; then
  echo "guard: override did not disable the guard" >&2
  exit 1
fi
echo "guard override respected: ok"

out=$(shopify envs doctor 2>&1)
code=$?
if [ "$code" -ne 0 ]; then
  echo "doctor: expected fixture to pass, got $code:" >&2
  echo "$out" >&2
  exit 1
fi
echo "doctor passes on fixture: ok"
