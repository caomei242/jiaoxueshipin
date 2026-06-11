#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ -x "/Users/gd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  NODE_BIN="${NODE_BIN:-/Users/gd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
else
  NODE_BIN="${NODE_BIN:-$(command -v node)}"
fi

DEFAULT_OUTPUT="$(cd "$ROOT_DIR" && "$NODE_BIN" --input-type=module -e "import { PLAYBOOK_DEFAULT_OUTPUT_DIR } from './lib/playbook/paths.mjs'; console.log(PLAYBOOK_DEFAULT_OUTPUT_DIR);" 2>/dev/null)"
OUTPUT_DIR="${PLAYBOOK_OUTPUT_DIR:-$DEFAULT_OUTPUT}"
VOICE="${VOICE:-Tingting}"
RATE="${SAY_RATE:-225}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "--output requires a path value" >&2
        exit 2
      fi
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --voice)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "--voice requires a value" >&2
        exit 2
      fi
      VOICE="$2"
      shift 2
      ;;
    --rate)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "--rate requires a value" >&2
        exit 2
      fi
      RATE="$2"
      shift 2
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$(dirname "$OUTPUT_DIR")"
OUTPUT_DIR="$(cd "$(dirname "$OUTPUT_DIR")" && pwd)/$(basename "$OUTPUT_DIR")"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "required command not found: $1" >&2
    exit 127
  fi
}

require_command "$NODE_BIN"
require_command say
require_command afconvert
require_command swift

if ! say -v '?' | awk '{print $1}' | grep -qx "$VOICE"; then
  echo "voice '$VOICE' not found, falling back to system default" >&2
  VOICE=""
fi

"$NODE_BIN" "$ROOT_DIR/scripts/create_playbook_workspace.mjs" --output "$OUTPUT_DIR" >/dev/null
"$NODE_BIN" "$ROOT_DIR/scripts/generate_playbook_recipe.mjs" --output "$OUTPUT_DIR" >/dev/null
"$NODE_BIN" "$ROOT_DIR/scripts/export_playbook_board.mjs" --output "$OUTPUT_DIR" >/dev/null
render_output="$("$NODE_BIN" "$ROOT_DIR/scripts/render_playbook_frames.mjs" --output "$OUTPUT_DIR")"

manifest_path="$("$NODE_BIN" --input-type=module - "$render_output" <<'NODE'
const renderOutput = process.argv[2] || '{}';
const data = JSON.parse(renderOutput);
console.log(data.manifestPath);
NODE
)"

video_path="$OUTPUT_DIR/videos/ai-image-to-video-playbook-horizontal.mp4"
audio_dir="$OUTPUT_DIR/audio/playbook"
rm -rf "$audio_dir"
mkdir -p "$audio_dir"

"$NODE_BIN" "$ROOT_DIR/scripts/list_playbook_voiceover_jobs.mjs" --output "$OUTPUT_DIR" |
while IFS=$'\t' read -r style scene_index audio_path text; do
  [[ -n "${audio_path:-}" ]] || continue
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

swift "$ROOT_DIR/compose_video.swift" "$manifest_path" "$video_path"

report_path="$OUTPUT_DIR/reports/playbook-build-report.md"
scene_count="$("$NODE_BIN" --input-type=module - "$manifest_path" <<'NODE'
import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(manifest.scenes?.length ?? 0);
NODE
)"
total_duration="$("$NODE_BIN" --input-type=module - "$manifest_path" <<'NODE'
import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(manifest.totalDuration ?? 0);
NODE
)"

mkdir -p "$(dirname "$report_path")"
cat >"$report_path" <<REPORT
# Playbook Build Report

- Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
- Output dir: $OUTPUT_DIR
- Manifest path: $manifest_path
- Video path: $video_path
- Scene count: $scene_count
- Total duration: $total_duration seconds
- Voice: ${VOICE:-system default}
- Rate: $RATE
- Safety note: old nanny pipeline files were untouched; this build only uses the playbook workspace and playbook audio directory.
REPORT

printf 'playbook-video=%s\n' "$video_path"
