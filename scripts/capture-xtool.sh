#!/bin/sh
# Capture observable xtool CLI behaviour (stdout, stderr, exit code) as fixtures.
# Usage: scripts/capture-xtool.sh <path-to-xtool> <output-dir>
# Runs only read-only/no-credential commands, with stdin closed and a 60 s timeout each.
set -u
XTOOL="$1"
OUT="$2"
mkdir -p "$OUT"
export APPIMAGE_EXTRACT_AND_RUN=1

cap() {
  name="$1"; shift
  timeout 60 "$XTOOL" "$@" </dev/null >"$OUT/$name.stdout" 2>"$OUT/$name.stderr"
  echo $? >"$OUT/$name.exit"
  printf '%s\n' "$*" >"$OUT/$name.args"
}

cap version --version
cap help --help
for c in setup auth sdk new dev ds devices install uninstall launch; do
  cap "help-$c" "$c" --help
done
cap help-auth-login auth login --help
cap help-auth-status auth status --help
cap help-sdk-status sdk status --help
cap help-dev-build dev build --help
cap help-dev-xcode dev generate-xcode-project --help
cap help-ds-teams ds teams --help

# Behaviour probes without credentials, device or SDK.
cap devices-no-wait devices --no-wait
cap sdk-status sdk status
cap auth-status auth status

WORK="$(mktemp -d)"
( cd "$WORK" && cap_in() { :; } ; timeout 60 "$XTOOL" new --skip-setup Demo-App </dev/null >"$OUT/new-ok.stdout" 2>"$OUT/new-ok.stderr"; echo $? >"$OUT/new-ok.exit"
  timeout 60 "$XTOOL" new --skip-setup 2bad </dev/null >"$OUT/new-badname.stdout" 2>"$OUT/new-badname.stderr"; echo $? >"$OUT/new-badname.exit"
  timeout 60 "$XTOOL" new --skip-setup Demo-App </dev/null >"$OUT/new-exists.stdout" 2>"$OUT/new-exists.stderr"; echo $? >"$OUT/new-exists.exit"
  mkdir empty && cd empty && timeout 60 "$XTOOL" dev build </dev/null >"$OUT/build-no-package.stdout" 2>"$OUT/build-no-package.stderr"; echo $? >"$OUT/build-no-package.exit"
)
( cd "$WORK" && find Demo-App -type f | sort >"$OUT/new-ok.files" && cat Demo-App/Package.swift Demo-App/xtool.yml >"$OUT/new-ok.manifest" 2>/dev/null )
echo "captured $(ls "$OUT" | wc -l) files"
