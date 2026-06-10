#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_OUTPUT="/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/$(TZ=Asia/Shanghai date +%F)"
OUTPUT_DIR="$DEFAULT_OUTPUT"
STYLE="nanny"

if [[ -x "/Users/gd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  NODE_BIN="${NODE_BIN:-/Users/gd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
else
  NODE_BIN="${NODE_BIN:-$(command -v node)}"
fi

export CODEX_NODE_MODULES_DIR="${CODEX_NODE_MODULES_DIR:-/Users/gd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --style)
      STYLE="$2"
      case "$STYLE" in
        nanny) ;;
        *)
          echo "build_storyboard_video.sh currently supports --style nanny only" >&2
          exit 2
          ;;
      esac
      shift 2
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$OUTPUT_DIR/videos"

"$NODE_BIN" "$ROOT_DIR/scripts/generate_scripts.mjs" --output "$OUTPUT_DIR"
"$NODE_BIN" "$ROOT_DIR/scripts/export_shooting_board.mjs" --output "$OUTPUT_DIR"
"$NODE_BIN" "$ROOT_DIR/scripts/apply_storyboard_review.mjs" --output "$OUTPUT_DIR" --style "$STYLE"
"$NODE_BIN" "$ROOT_DIR/scripts/export_storyboard_layout.mjs" --output "$OUTPUT_DIR"
"$NODE_BIN" "$ROOT_DIR/scripts/render_storyboard_frames.mjs" --output "$OUTPUT_DIR" --style "$STYLE"
"$ROOT_DIR/voiceover.sh" --output "$OUTPUT_DIR"
"$NODE_BIN" "$ROOT_DIR/scripts/sync_audio_durations.mjs" --output "$OUTPUT_DIR"

manifest="$OUTPUT_DIR/manifests/$STYLE-horizontal-storyboard.json"
video="$OUTPUT_DIR/videos/$STYLE-horizontal-storyboard.mp4"
swift "$ROOT_DIR/compose_video.swift" "$manifest" "$video"

"$NODE_BIN" "$ROOT_DIR/scripts/generate_report.mjs" --output "$OUTPUT_DIR"
printf 'storyboard-video=%s\n' "$video"
