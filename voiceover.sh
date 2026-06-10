#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_OUTPUT="/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/2026-05-28"
OUTPUT_DIR="$DEFAULT_OUTPUT"
VOICE="${VOICE:-Tingting}"
RATE="${SAY_RATE:-225}"

if [[ -x "/Users/gd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  NODE_BIN="${NODE_BIN:-/Users/gd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
else
  NODE_BIN="${NODE_BIN:-$(command -v node)}"
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --voice)
      VOICE="$2"
      shift 2
      ;;
    --rate)
      RATE="$2"
      shift 2
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if ! say -v '?' | awk '{print $1}' | grep -qx "$VOICE"; then
  echo "voice '$VOICE' not found, falling back to system default" >&2
  VOICE=""
fi

CLEARED_STYLES=" "

"$NODE_BIN" "$ROOT_DIR/scripts/list_voiceover_jobs.mjs" --output "$OUTPUT_DIR" |
while IFS=$'\t' read -r style scene_index audio_path text; do
  [[ -n "${audio_path:-}" ]] || continue
  if [[ "$CLEARED_STYLES" != *" $style "* ]]; then
    rm -rf "$OUTPUT_DIR/audio/$style"
    CLEARED_STYLES="$CLEARED_STYLES$style "
  fi
  mkdir -p "$(dirname "$audio_path")"
  aiff_path="${audio_path%.m4a}.aiff"
  if [[ -n "$VOICE" ]]; then
    say -v "$VOICE" -r "$RATE" -o "$aiff_path" "$text"
  else
    say -r "$RATE" -o "$aiff_path" "$text"
  fi
  afconvert -f m4af -d aac "$aiff_path" "$audio_path"
  rm -f "$aiff_path"
  printf 'voiceover style=%s scene=%s audio=%s\n' "$style" "$scene_index" "$audio_path"
done
