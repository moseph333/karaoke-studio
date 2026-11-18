#!/usr/bin/env bash
# Updates a Docker Compose install of Karaoke Studio without cutting off other people's jobs.
#
#   scripts/update_when_idle.sh            # update if origin/main has a new commit
#   scripts/update_when_idle.sh --force    # rebuild and restart even without one
#
# 1. Fetches origin/main and stops if there is nothing new (unless --force).
# 2. Moves to a new commit only once its CI run on GitHub has passed. A failed run leaves
#    the install where it is; a run still going is waited for (UPDATE_CI_WAIT_SEC, default
#    900 s), then left for the next call. Where there is no result to read (origin is not on
#    GitHub, the API cannot be reached, the commit has no CI run) the update goes ahead and
#    says so, unless an earlier call saw that commit's run failed or still going (kept in
#    <data dir>/.update_ci_hold): then it stays until a result can be read again.
#    --force does not skip this; UPDATE_REQUIRE_CI=0 does.
# 3. Resets the checkout and builds the new image while the old container keeps serving.
# 4. Writes <data dir>/.update_draining: the running server stops accepting new songs,
#    uploads, renders and re-made stems (503), while editing and playback keep working.
# 5. Waits until the server's <data dir>/.jobs_active says no job runs, the file goes stale
#    (the server is not answering), or UPDATE_DRAIN_MAX_SEC (default 2700 s) passes.
# 6. Recreates the container. The new server removes the marker when it starts; this script
#    also removes it on exit, so a failed build never leaves new jobs paused.
#
# Settings come from the environment, then the repo's .env: KARAOKE_DATA_DIR (the host path
# compose mounts, default ./workspace_data), UPDATE_DRAIN_MAX_SEC, UPDATE_REQUIRE_CI (1),
# UPDATE_CI_WAIT_SEC, UPDATE_CI_TOKEN (a GitHub token that can read the repository's
# Actions runs; only a private repository needs one) and UPDATE_CI_REPO (owner/name, read
# from the origin URL by default). For tests and other hosts: UPDATE_BRANCH (main),
# UPDATE_DRAIN_POLL_SEC (10), UPDATE_DRAIN_STALE_SEC (60), UPDATE_CI_POLL_SEC (30),
# UPDATE_CI_WORKFLOW (ci.yml), UPDATE_CI_API_URL (https://api.github.com) and COMPOSE_CMD
# ("docker compose").
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

  REQUIRE_CI="$(setting UPDATE_REQUIRE_CI 1)"
  CI_WAIT="$(setting UPDATE_CI_WAIT_SEC 900)"
  [[ "$CI_WAIT" =~ ^[0-9]+$ ]] || CI_WAIT=900
  CI_TOKEN="$(setting UPDATE_CI_TOKEN "")"
  CI_REPO="$(setting UPDATE_CI_REPO "")"
  CI_POLL="${UPDATE_CI_POLL_SEC:-30}"
  CI_WORKFLOW="${UPDATE_CI_WORKFLOW:-ci.yml}"
  CI_API="${UPDATE_CI_API_URL:-https://api.github.com}"
  # A commit's CI run exists within seconds of the push; none after this long means none
  # is coming (CI skipped for the commit, or Actions is off)
  CI_NO_RUN_GRACE=120
  # The commit whose CI run was last seen failed or still going. Calls are minutes apart and
  # share nothing else, so without it a later call that cannot read the result would deploy
  # a commit an earlier call had refused
  CI_HOLD_FILE="$DATA_DIR/.update_ci_hold"

  ci_hold() {
    { mkdir -p "$DATA_DIR" && printf '%s\n' "$1" >"$CI_HOLD_FILE.tmp" &&
      mv "$CI_HOLD_FILE.tmp" "$CI_HOLD_FILE"; } 2>/dev/null ||
      log "Could not write $CI_HOLD_FILE; a later call may not know CI held ${1:0:7} back"
  }

  ci_held() {
    [[ -f "$CI_HOLD_FILE" && "$(head -n 1 "$CI_HOLD_FILE" 2>/dev/null)" == "$1" ]]
  }

  # Prints what the CI workflow's newest run says about a commit: "passed",
  # "failed:<conclusion>", "running", "none" (no run for it) or "unknown:<why>"
  ci_verdict() {
    local sha="$1" body code status conclusion
    local -a auth=()
    [[ -n "$CI_TOKEN" ]] && auth=(-H "Authorization: Bearer $CI_TOKEN")
    body="$(mktemp)"
    code="$(curl --silent --max-time 20 --output "$body" --write-out '%{http_code}' \
      -H 'Accept: application/vnd.github+json' ${auth[@]+"${auth[@]}"} \
      "$CI_API/repos/$CI_REPO/actions/workflows/$CI_WORKFLOW/runs?head_sha=$sha&per_page=1")" ||
      code="000"
    if [[ "$code" != "200" ]]; then
      rm -f "$body"
      if [[ "$code" == "000" ]]; then
        echo "unknown:GitHub's API did not answer"
      else
        echo "unknown:GitHub's API answered HTTP $code"
      fi
      return
    fi
    # The first "status" and "conclusion" in the reply are the run's own (it asks for one run)
    status="$(grep -o '"status"[[:space:]]*:[[:space:]]*"[a-z_]*"' "$body" | head -n 1 |
      sed 's/.*"\([a-z_]*\)"$/\1/')"
    conclusion="$(grep -o '"conclusion"[[:space:]]*:[[:space:]]*"[a-z_]*"' "$body" | head -n 1 |
      sed 's/.*"\([a-z_]*\)"$/\1/')"
    rm -f "$body"
    if [[ -z "$status" ]]; then
      echo "none"
    elif [[ "$status" != "completed" ]]; then
      echo "running"
    elif [[ "$conclusion" == "success" ]]; then
      echo "passed"
    else
      echo "failed:${conclusion:-no conclusion}"
    fi
  }

  # Returns 0 when the update may move to the commit, 1 when it must stay where it is
  ci_allows() {
    local sha="$1" short="${1:0:7}" started verdict elapsed readable=0 held=0
    if [[ -z "$CI_REPO" ]]; then
      CI_REPO="$(git config --get remote.origin.url 2>/dev/null | sed 's#/*$##' |
        sed -n 's#^.*github\.com[:/]\([^/]*/[^/]*\)$#\1#p')"
      CI_REPO="${CI_REPO%.git}"
    fi
    if [[ -z "$CI_REPO" ]]; then
      log "origin is not a GitHub repository; updating without a CI result"
      return 0
    fi
    if ! command -v curl >/dev/null 2>&1; then
      log "curl is not installed, so CI cannot be checked; updating without a CI result"
      return 0
    fi
    ci_held "$sha" && held=1
    started="$(date +%s)"
    while :; do
      verdict="$(ci_verdict "$sha")"
      elapsed=$(($(date +%s) - started))
      case "$verdict" in
        passed)
          rm -f "$CI_HOLD_FILE"
          log "CI passed for $short"
          return 0
          ;;
        failed:*)
          ci_hold "$sha"
          log "CI did not pass for $short (${verdict#failed:}); staying on ${LOCAL:0:7}." \
            "Push a fix, or set UPDATE_REQUIRE_CI=0 to update anyway"
          return 1
          ;;
        running)
          ((readable == 1)) || ci_hold "$sha"
          readable=1
          ;;
        none)
          if ((held == 1)); then
            log "No CI run is listed for $short now, but an earlier call saw one failed or" \
              "still running; staying on ${LOCAL:0:7}." \
              "Push a fix, or set UPDATE_REQUIRE_CI=0 to update anyway"
            return 1
          fi
          if ((elapsed >= CI_NO_RUN_GRACE || elapsed >= CI_WAIT)); then
            log "No CI run exists for $short; updating without a CI result"
            return 0
          fi
          ;;
        *)
          # Never read a result at all, in this call or an earlier one: behave as before
          # the check existed. Lost after a run was seen going: keep waiting for it rather
          # than update around it. Seen failed or going by an earlier call: stay.
          if ((held == 1 && readable == 0)); then
            log "Could not read the CI result for $short (${verdict#unknown:}), and an" \
              "earlier call saw its run failed or still running; staying on ${LOCAL:0:7}"
            return 1
          fi
          if ((readable == 0)); then
            log "Could not read the CI result for $short (${verdict#unknown:});" \
              "updating without it"
            return 0
          fi
          ;;
      esac
      if ((elapsed >= CI_WAIT)); then
        log "CI is still running for $short after ${elapsed}s; staying on ${LOCAL:0:7}" \
          "until the next call"
        return 1
      fi
      sleep "$CI_POLL"
    done
  }

  # --tags: a release tag on the new commit must be here for the server's `git describe`
  git fetch --quiet --tags origin "$BRANCH"
  LOCAL="$(git rev-parse HEAD)"
  REMOTE="$(git rev-parse "origin/$BRANCH")"
  if [[ "$LOCAL" == "$REMOTE" && "$FORCE" -eq 0 ]]; then
    log "Already at ${LOCAL:0:7}; nothing to update"
    exit 0
  fi
  # Only a move to another commit is checked: a forced rebuild of the running one is not
  if [[ "$LOCAL" != "$REMOTE" && "$REQUIRE_CI" != "0" ]]; then
    ci_allows "$REMOTE" || exit 0
    # A release tag created while CI ran (best effort: the commit is already here)
    git fetch --quiet --tags origin "$BRANCH" || true
  fi
  log "Updating ${LOCAL:0:7} -> ${REMOTE:0:7}"
  # The commit that was checked, even if the branch moved on meanwhile
  git reset --hard --quiet "$REMOTE"

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
