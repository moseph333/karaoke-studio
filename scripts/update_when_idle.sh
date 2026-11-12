#!/usr/bin/env bash
# Updates a Docker Compose install of Karaoke Studio without cutting off other people's jobs.
#
#   scripts/update_when_idle.sh            # update if origin/main has a new commit
#   scripts/update_when_idle.sh --force    # rebuild and restart even without one
#
# 1. Fetches origin/main and stops if there is nothing new (unless --force).
# 2. Resets the checkout and builds the new image while the old container keeps serving.
# 3. Writes <data dir>/.update_draining: the running server stops accepting new songs,
#    uploads, renders and re-made stems (503), while editing and playback keep working.
# 4. Waits until the server's <data dir>/.jobs_active says no job runs, the file goes stale
#    (the server is not answering), or UPDATE_DRAIN_MAX_SEC (default 2700 s) passes.
# 5. Recreates the container. The new server removes the marker when it starts; this script
#    also removes it on exit, so a failed build never leaves new jobs paused.
#
# Settings come from the environment, then the repo's .env: KARAOKE_DATA_DIR (the host path
# compose mounts, default ./workspace_data), UPDATE_DRAIN_MAX_SEC. For tests and other hosts:
# UPDATE_BRANCH (main), UPDATE_DRAIN_POLL_SEC (10), UPDATE_DRAIN_STALE_SEC (60) and
# COMPOSE_CMD ("docker compose").
set -euo pipefail

# Everything runs from one function, parsed before the first line runs: the git reset below
# may rewrite this very file
main() {
  REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$REPO_DIR"

  FORCE=0
  case "${1:-}" in
    --force) FORCE=1 ;;
    "") ;;
    *)
      echo "usage: $0 [--force]" >&2
      exit 2
      ;;
  esac

  log() { echo "[update_when_idle] $(date '+%Y-%m-%dT%H:%M:%S%z') $*"; }

  # A setting from the environment, else the last NAME=value line of .env, else the default
  setting() {
    local name="$1" default="$2" value=""
    if [[ -n "${!name:-}" ]]; then
      printf '%s' "${!name}"
      return
    fi
    if [[ -f .env ]]; then
      value="$(sed -n "s/^[[:space:]]*${name}[[:space:]]*=[[:space:]]*//p" .env | tail -n 1)"
      value="${value%\"}"
      value="${value#\"}"
      value="${value%\'}"
      value="${value#\'}"
    fi
    printf '%s' "${value:-$default}"
  }

  DATA_DIR="$(setting KARAOKE_DATA_DIR ./workspace_data)"
  [[ "$DATA_DIR" = /* ]] || DATA_DIR="$REPO_DIR/${DATA_DIR#./}"
  MAX_WAIT="$(setting UPDATE_DRAIN_MAX_SEC 2700)"
  [[ "$MAX_WAIT" =~ ^[0-9]+$ ]] || MAX_WAIT=2700
  POLL="${UPDATE_DRAIN_POLL_SEC:-10}"
  STALE="${UPDATE_DRAIN_STALE_SEC:-60}"
  BRANCH="${UPDATE_BRANCH:-main}"
  read -r -a COMPOSE <<<"${COMPOSE_CMD:-docker compose}"

  DRAIN_FILE="$DATA_DIR/.update_draining"
  JOBS_FILE="$DATA_DIR/.jobs_active"

  git fetch --quiet origin "$BRANCH"
  LOCAL="$(git rev-parse HEAD)"
  REMOTE="$(git rev-parse "origin/$BRANCH")"
  if [[ "$LOCAL" == "$REMOTE" && "$FORCE" -eq 0 ]]; then
    log "Already at ${LOCAL:0:7}; nothing to update"
    exit 0
  fi
  log "Updating ${LOCAL:0:7} -> ${REMOTE:0:7}"
  git reset --hard --quiet "origin/$BRANCH"

  trap 'rm -f "$DRAIN_FILE"' EXIT

  log "Building the new image; the running container keeps serving"
  "${COMPOSE[@]}" build

  mkdir -p "$DATA_DIR"
  STARTED="$(date +%s)"
  printf '{"requested_at": %s, "deadline": %s}\n' "$STARTED" "$((STARTED + MAX_WAIT))" \
    >"$DRAIN_FILE.tmp"
  mv "$DRAIN_FILE.tmp" "$DRAIN_FILE"
  log "New jobs paused; waiting up to ${MAX_WAIT}s for running jobs to finish"

  # A count only counts once the server rewrote the file after the pause began, so a job
  # that passed the check just before the marker appeared is not missed
  REASON=""
  LAST_LOG=0
  while :; do
    NOW="$(date +%s)"
    ELAPSED=$((NOW - STARTED))
    if [[ ! -f "$JOBS_FILE" ]]; then
      REASON="the server does not report its jobs (older version?)"
      break
    fi
    WRITTEN="$(stat -c %Y "$JOBS_FILE" 2>/dev/null || echo 0)"
    if ((NOW - WRITTEN > STALE)); then
      REASON="the server has not reported its jobs for $((NOW - WRITTEN))s"
      break
    fi
    COUNT="$(sed -n 's/.*"count":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$JOBS_FILE")"
    if ((WRITTEN > STARTED)) && [[ "$COUNT" == "0" ]]; then
      REASON="no jobs are running"
      break
    fi
    if ((ELAPSED >= MAX_WAIT)); then
      REASON="waited ${ELAPSED}s, the limit; ${COUNT:-some} job(s) will be interrupted"
      break
    fi
    if ((NOW - LAST_LOG >= 60)); then
      log "Still waiting: ${COUNT:-?} job(s) running after ${ELAPSED}s"
      LAST_LOG="$NOW"
    fi
    sleep "$POLL"
  done

  log "Restarting: $REASON"
  "${COMPOSE[@]}" up -d
  log "Update to ${REMOTE:0:7} done"
}

main "$@"
exit
