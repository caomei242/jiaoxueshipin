#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_OUTPUT="/Users/gd/Desktop/主业/客户教程视频/稿定商品-AI优化商品图/$(TZ=Asia/Shanghai date +%F)"
OUTPUT_DIR="$DEFAULT_OUTPUT"
DRY_RUN=0
SKIP_CAPTURE=0
SKIP_VOICE=0
SKIP_COMPOSE=0
ASPECT="horizontal"
STYLE="all"

if [[ -x "/Users/gd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  NODE_BIN="${NODE_BIN:-/Users/gd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
else
  NODE_BIN="${NODE_BIN:-$(command -v node)}"
fi

export CODEX_NODE_MODULES_DIR="${CODEX_NODE_MODULES_DIR:-/Users/gd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --skip-capture)
      SKIP_CAPTURE=1
      shift
      ;;
    --skip-voice)
      SKIP_VOICE=1
      shift
      ;;
    --skip-compose)
      SKIP_COMPOSE=1
      shift
      ;;
    --aspect)
      ASPECT="$2"
      case "$ASPECT" in
        all|horizontal|vertical) ;;
        *)
          echo "invalid --aspect: $ASPECT" >&2
          exit 2
          ;;
      esac
      shift 2
      ;;
    --style)
      STYLE="$2"
      case "$STYLE" in
        all|nanny|shortform) ;;
        *)
          echo "invalid --style: $STYLE" >&2
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

mkdir -p "$OUTPUT_DIR"

if [[ "$SKIP_CAPTURE" -eq 0 && -f "/Users/gd/.codex/skills/web-access/scripts/check-deps.mjs" ]]; then
  "$NODE_BIN" "/Users/gd/.codex/skills/web-access/scripts/check-deps.mjs"
fi

if [[ "$SKIP_CAPTURE" -eq 0 ]]; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    "$NODE_BIN" "$ROOT_DIR/scripts/capture_flow.mjs" --dry-run --output "$OUTPUT_DIR"
  else
    "$NODE_BIN" "$ROOT_DIR/scripts/capture_flow.mjs" --output "$OUTPUT_DIR"
  fi
fi

"$NODE_BIN" "$ROOT_DIR/scripts/generate_scripts.mjs" --output "$OUTPUT_DIR"

if [[ -f "$OUTPUT_DIR/scripts/editable-script.md" ]]; then
  "$NODE_BIN" "$ROOT_DIR/scripts/apply_editable_script.mjs" --output "$OUTPUT_DIR"
else
  "$NODE_BIN" "$ROOT_DIR/scripts/export_editable_script.mjs" --output "$OUTPUT_DIR"
fi
"$NODE_BIN" "$ROOT_DIR/scripts/export_shooting_board.mjs" --output "$OUTPUT_DIR"
"$NODE_BIN" "$ROOT_DIR/scripts/apply_storyboard_review.mjs" --output "$OUTPUT_DIR" --style "$STYLE"

if [[ "$DRY_RUN" -eq 1 ]]; then
  "$NODE_BIN" "$ROOT_DIR/scripts/generate_report.mjs" --dry-run --output "$OUTPUT_DIR"
  printf 'dry-run complete output=%s\n' "$OUTPUT_DIR"
  exit 0
fi

"$NODE_BIN" "$ROOT_DIR/scripts/render_frames.mjs" --output "$OUTPUT_DIR" --aspect "$ASPECT"

if [[ "$SKIP_VOICE" -eq 0 ]]; then
  "$ROOT_DIR/voiceover.sh" --output "$OUTPUT_DIR"
fi

"$NODE_BIN" "$ROOT_DIR/scripts/sync_audio_durations.mjs" --output "$OUTPUT_DIR"

if [[ "$SKIP_COMPOSE" -eq 0 ]]; then
  mkdir -p "$OUTPUT_DIR/videos"
  if [[ "$ASPECT" == "all" ]]; then
    if [[ "$STYLE" == "all" ]]; then
      manifests=("$OUTPUT_DIR"/manifests/*.json)
    else
      manifests=("$OUTPUT_DIR"/manifests/"$STYLE"-*.json)
    fi
  else
    if [[ "$STYLE" == "all" ]]; then
      manifests=("$OUTPUT_DIR"/manifests/*-"$ASPECT".json)
    else
      manifests=("$OUTPUT_DIR"/manifests/"$STYLE"-"$ASPECT".json)
    fi
  fi
  for manifest in "${manifests[@]}"; do
    [[ -e "$manifest" ]] || continue
    name="$(basename "$manifest" .json)"
    output="$OUTPUT_DIR/videos/$name.mp4"
    swift "$ROOT_DIR/compose_video.swift" "$manifest" "$output"
    printf 'video=%s\n' "$output"
  done
fi

"$NODE_BIN" "$ROOT_DIR/scripts/generate_report.mjs" --output "$OUTPUT_DIR"
printf 'build complete output=%s\n' "$OUTPUT_DIR"
