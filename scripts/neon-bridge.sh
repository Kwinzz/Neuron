#!/usr/bin/env bash
# neon-bridge.sh — transmet un prompt + un dossier de travail à Antigravity (agy) en mode non interactif.
#
# Usage:
#   scripts/neon-bridge.sh [-d workdir] [-m model] [-e effort] [-f prompt-file] [--dry-run] [prompt...]
#   echo "prompt" | scripts/neon-bridge.sh -d .
#
# Env:
#   AGY_BIN     binaire Antigravity (défaut: agy)
#   NEON_MODE   skip (défaut, --dangerously-skip-permissions) | accept-edits | auto | plan
#   NEON_LOG_DIR dossier des logs (défaut: <workdir>/logs/neon)
#   NEON_MODEL  modèle Antigravity (défaut: gemini-4-neon-high ; -m l'emporte)
set -euo pipefail

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

WORKDIR="$(pwd)"
MODEL="${NEON_MODEL:-gemini-4-neon-high}"
EFFORT=""
PROMPT_FILE=""
DRY_RUN=0
PROMPT_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--dir)     WORKDIR="${2:?missing value for $1}"; shift 2 ;;
    -m|--model)   MODEL="${2:?missing value for $1}"; shift 2 ;;
    -e|--effort)  EFFORT="${2:?missing value for $1}"; shift 2 ;;
    -f|--file)    PROMPT_FILE="${2:?missing value for $1}"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    usage 0 ;;
    --)           shift; PROMPT_ARGS+=("$@"); break ;;
    -*)           echo "neon-bridge: unknown option $1" >&2; usage 2 ;;
    *)            PROMPT_ARGS+=("$1"); shift ;;
  esac
done

if [[ ! -d "$WORKDIR" ]]; then
  echo "neon-bridge: workdir not found: $WORKDIR" >&2
  exit 2
fi
WORKDIR="$(cd "$WORKDIR" && pwd)"
# agy is a native Windows binary under Git Bash: hand it a Windows-style path.
NATIVE_WORKDIR="$WORKDIR"
if command -v cygpath >/dev/null 2>&1; then
  NATIVE_WORKDIR="$(cygpath -w "$WORKDIR")"
fi

# Résolution du prompt : fichier > arguments > stdin.
if [[ -n "$PROMPT_FILE" ]]; then
  [[ -f "$PROMPT_FILE" ]] || { echo "neon-bridge: prompt file not found: $PROMPT_FILE" >&2; exit 2; }
  USER_PROMPT="$(cat "$PROMPT_FILE")"
elif [[ ${#PROMPT_ARGS[@]} -gt 0 ]]; then
  USER_PROMPT="${PROMPT_ARGS[*]}"
elif [[ ! -t 0 ]]; then
  USER_PROMPT="$(cat)"
else
  echo "neon-bridge: no prompt given" >&2
  usage 2
fi

if [[ -z "${USER_PROMPT//[[:space:]]/}" ]]; then
  echo "neon-bridge: empty prompt" >&2
  exit 2
fi

read -r -d '' PREAMBLE <<'EOF' || true
You are "neon", the UI/UX specialist of the Neuron project (Tauri v2 + React 19 + TypeScript strict + Tailwind CSS v4).
Hard rules:
- Read CLAUDE.md at the repository root first and follow its conventions exactly.
- Only create or modify files under src/. Never touch src-tauri/, src/bindings/ or src/lib/ipc.ts.
- Use only the design tokens defined in src/styles/index.css (no hard-coded hex colors).
- Numbers that change live (tokens, timers, counters) use font-mono tabular-nums.
- Transitions: 150ms, transform/opacity/colors only. No gratuitous spinners.
- TypeScript strict: no `any`. Keep components small, one per file, PascalCase.tsx.
- Do not run git commands. When done, list every file you created or changed with a one-line summary.

Task:
EOF

FULL_PROMPT="${PREAMBLE}
${USER_PROMPT}"

AGY="${AGY_BIN:-agy}"
CMD=("$AGY" -p "$FULL_PROMPT" --add-dir "$NATIVE_WORKDIR" --output-format text)

case "${NEON_MODE:-skip}" in
  skip)                     CMD+=(--dangerously-skip-permissions) ;;
  accept-edits|auto|plan)   CMD+=(--mode "$NEON_MODE") ;;
  *) echo "neon-bridge: invalid NEON_MODE=${NEON_MODE}" >&2; exit 2 ;;
esac
[[ -n "$MODEL" ]]  && CMD+=(--model "$MODEL")
[[ -n "$EFFORT" ]] && CMD+=(--effort "$EFFORT")

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "workdir: $WORKDIR"
  printf 'command:'
  for arg in "${CMD[@]}"; do
    if [[ "$arg" == "$FULL_PROMPT" ]]; then printf ' %q' "<prompt: ${#FULL_PROMPT} chars>"; else printf ' %q' "$arg"; fi
  done
  printf '\n'
  exit 0
fi

command -v "$AGY" >/dev/null 2>&1 || { echo "neon-bridge: '$AGY' not found in PATH (set AGY_BIN)" >&2; exit 127; }

LOG_DIR="${NEON_LOG_DIR:-$WORKDIR/logs/neon}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(date +%Y%m%d-%H%M%S).log"
{
  echo "# neon-bridge $(date -Iseconds)"
  echo "# workdir: $WORKDIR"
  echo "# --- prompt ---"
  echo "$USER_PROMPT"
  echo "# --- output ---"
} >"$LOG_FILE"

cd "$WORKDIR"
set +e
"${CMD[@]}" 2>&1 | tee -a "$LOG_FILE"
STATUS=${PIPESTATUS[0]}
set -e

echo "# exit: $STATUS" >>"$LOG_FILE"
echo "[neon-bridge] log: $LOG_FILE (exit $STATUS)" >&2
exit "$STATUS"
