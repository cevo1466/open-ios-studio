#!/usr/bin/env bash
# Decides whether a commit on main is a release that should be tagged.
#
# Usage: scripts/release-tag-check.sh <commit-subject> <repo-root> [--tag-exists 0|1]
#        scripts/release-tag-check.sh --self-test
#
# Prints exactly one line:
#   SKIP: <reason>      exit 0   (not a release commit, or the tag already exists)
#   TAG v<version>      exit 0   (tag this commit and start the Release workflow)
#   ERROR: <reason>     exit 1   (a release commit whose files disagree; nothing was tagged)
#
# Rules (docs/superpowers/specs/2026-11-03-launch-readiness-2-design.md, "4. Maintenance"):
#   - only commit subjects starting with "chore(release): " are releases;
#   - package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml must carry the same version;
#   - CHANGELOG.md must have a "## [<version>]" section before any tag is created.
set -u

VERSION_RE='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'

# ---------------------------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------------------------

version_in_json() { # file key
  sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n 1
}

version_in_cargo() { # file
  sed -n 's/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n 1
}

check() { # subject root tag_exists
  local subject="$1" root="$2" tag_exists="$3"
  case "$subject" in
    "chore(release): "*) ;;
    *) echo "SKIP: not a release commit"; return 0 ;;
  esac
  local conf pkg cargo
  conf="$(version_in_json "$root/src-tauri/tauri.conf.json")"
  pkg="$(version_in_json "$root/package.json")"
  cargo="$(version_in_cargo "$root/src-tauri/Cargo.toml")"
  if ! printf '%s' "$conf" | grep -Eq "$VERSION_RE"; then
    echo "ERROR: invalid version '$conf' in tauri.conf.json"; return 1
  fi
  if [ "$pkg" != "$conf" ] || [ "$cargo" != "$conf" ]; then
    echo "ERROR: version mismatch: package.json $pkg, tauri.conf.json $conf, Cargo.toml $cargo"; return 1
  fi
  if ! grep -Fq "## [$conf]" "$root/CHANGELOG.md" 2>/dev/null; then
    echo "ERROR: CHANGELOG.md has no section ## [$conf]"; return 1
  fi
  if [ "$tag_exists" = "1" ]; then
    echo "SKIP: tag v$conf already exists"; return 0
  fi
  echo "TAG v$conf"
}

# ---------------------------------------------------------------------------------------------
# Self-test: builds a temporary repo root per case and compares the printed line and exit code.
# ---------------------------------------------------------------------------------------------

self_test() {
  local tmp failed=0
  tmp="$(mktemp -d)"

  make_root() { # dir pkg_version conf_version cargo_version changelog_version
    local d="$1"
    mkdir -p "$d/src-tauri"
    printf '{\n  "name": "x",\n  "version": "%s"\n}\n' "$2" > "$d/package.json"
    printf '{\n  "productName": "x",\n  "version": "%s"\n}\n' "$3" > "$d/src-tauri/tauri.conf.json"
    printf '[package]\nname = "x"\nversion = "%s"\n' "$4" > "$d/src-tauri/Cargo.toml"
    printf '# Changelog\n\n## [Unreleased]\n\n## [%s] - 2026-11-04\n\n### Fixed\n- x\n' "$5" > "$d/CHANGELOG.md"
  }

  expect() { # name expected_line expected_exit subject root [tag_exists]
    local name="$1" want_line="$2" want_exit="$3" subject="$4" root="$5" tag_exists="${6:-0}"
    local got_line got_exit
    got_line="$(check "$subject" "$root" "$tag_exists")"; got_exit=$?
    if [ "$got_line" = "$want_line" ] && [ "$got_exit" = "$want_exit" ]; then
      printf 'ok   %s\n' "$name"
    else
      printf 'FAIL %s: expected [%s] exit %s, got [%s] exit %s\n' "$name" "$want_line" "$want_exit" "$got_line" "$got_exit"
      failed=1
    fi
  }

  make_root "$tmp/ok" 0.1.12 0.1.12 0.1.12 0.1.12
  expect release-ok "TAG v0.1.12" 0 "chore(release): 0.1.12 (#60)" "$tmp/ok"
  expect not-release "SKIP: not a release commit" 0 "fix(update): x" "$tmp/ok"
  expect merge-subject "SKIP: not a release commit" 0 "Merge pull request #1 from x/chore(release): 0.2.0" "$tmp/ok"
  expect tag-exists "SKIP: tag v0.1.12 already exists" 0 "chore(release): 0.1.12 (#60)" "$tmp/ok" 1

  make_root "$tmp/mismatch" 0.1.12 0.1.12 0.1.11 0.1.12
  expect version-mismatch "ERROR: version mismatch: package.json 0.1.12, tauri.conf.json 0.1.12, Cargo.toml 0.1.11" 1 "chore(release): 0.1.12 (#61)" "$tmp/mismatch"

  make_root "$tmp/nochangelog" 0.1.12 0.1.12 0.1.12 0.1.11
  expect changelog-missing "ERROR: CHANGELOG.md has no section ## [0.1.12]" 1 "chore(release): 0.1.12 (#62)" "$tmp/nochangelog"

  make_root "$tmp/pre" 0.2.0-beta.1 0.2.0-beta.1 0.2.0-beta.1 0.2.0-beta.1
  expect prerelease-suffix "TAG v0.2.0-beta.1" 0 "chore(release): 0.2.0-beta.1 (#63)" "$tmp/pre"

  make_root "$tmp/badver" "1.2" "1.2" "1.2" "1.2"
  expect invalid-version "ERROR: invalid version '1.2' in tauri.conf.json" 1 "chore(release): 1.2 (#64)" "$tmp/badver"

  rm -rf "$tmp"
  if [ "$failed" -eq 0 ]; then echo "self-test: all passed"; return 0; fi
  echo "self-test: FAILED"; return 2
}

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  -h|--help|"") sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

subject="$1"; root="${2:-.}"; tag_exists=0
if [ "${3:-}" = "--tag-exists" ]; then tag_exists="${4:-0}"; fi
check "$subject" "$root" "$tag_exists"
