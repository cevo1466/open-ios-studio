#!/usr/bin/env bash
# Open iOS Studio environment check ("doctor").
#
# Checks, on the developer's Linux machine, everything the README lists as a prerequisite for
# building an iOS app with xtool, and prints one line per check with a status and a fix hint.
# It only runs read-only commands (versions, status queries) with stdin closed and a timeout;
# it never installs anything, never logs in and never touches Apple credentials.
#
# Usage: scripts/doctor.sh [--self-test]
# Exit code: 0 when every required check passed, 1 when a required check failed,
#            2 for usage errors or a failed self-test.
#
# Status vocabulary (kept in line with CLAUDE.md):
#   PASS          verified on this machine right now
#   FAIL          required for an iOS build and missing/broken
#   WARN          not required for a build, but needed later (device, signing) or untested
#   NOT_VERIFIED  the check could not be run here (tool missing, timeout); nothing is claimed
#   INFO          optional tooling
set -u

TESTED_XTOOL_VERSION="1.24.0"   # the version whose CLI fixtures live in fixtures/xtool-<version>/
CMD_TIMEOUT="${DOCTOR_TIMEOUT:-60}"
required_failures=0
warnings=0

color() { # name text
  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    case "$1" in
      green) printf '\033[32m%s\033[0m' "$2" ;;
      red) printf '\033[31m%s\033[0m' "$2" ;;
      yellow) printf '\033[33m%s\033[0m' "$2" ;;
      *) printf '%s' "$2" ;;
    esac
  else
    printf '%s' "$2"
  fi
}

report() { # STATUS name detail [hint]
  local status="$1" name="$2" detail="$3" hint="${4:-}"
  case "$status" in
    PASS) color green "PASS        " ;;
    FAIL) color red "FAIL        "; required_failures=$((required_failures + 1)) ;;
    WARN) color yellow "WARN        "; warnings=$((warnings + 1)) ;;
    NOT_VERIFIED) color yellow "NOT_VERIFIED" ;;
    INFO) printf 'INFO        ' ;;
    *) printf '%s' "$status" ;;
  esac
  printf ' %-28s %s\n' "$name" "$detail"
  if [ -n "$hint" ]; then
    printf '             %-28s -> %s\n' '' "$hint"
  fi
}

# run_quiet <cmd...>: runs a read-only command with stdin closed and a timeout; prints combined output.
# Returns the command's exit code, or 124 on timeout.
run_quiet() {
  timeout "$CMD_TIMEOUT" "$@" </dev/null 2>&1
}

first_line() { printf '%s' "$1" | head -n 1; }

# version_from_output "<xtool 1.24.0>" -> "1.24.0"
version_from_output() {
  printf '%s' "$1" | grep -Eo '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -n 1
}

# compare_versions a b -> prints -1, 0 or 1 (numeric, dotted, up to three components)
compare_versions() {
  local a b i x y
  IFS=. read -r -a a <<<"$1"
  IFS=. read -r -a b <<<"$2"
  for i in 0 1 2; do
    x="${a[$i]:-0}"; y="${b[$i]:-0}"
    if [ "$x" -lt "$y" ]; then echo -1; return; fi
    if [ "$x" -gt "$y" ]; then echo 1; return; fi
  done
  echo 0
}

self_test() {
  local failed=0
  check() { # description expected actual
    if [ "$2" = "$3" ]; then printf 'ok   %s\n' "$1"; else printf 'FAIL %s (expected %s, got %s)\n' "$1" "$2" "$3"; failed=1; fi
  }
  check "version_from_output xtool" "1.24.0" "$(version_from_output 'xtool 1.24.0')"
  check "version_from_output swift" "6.1" "$(version_from_output 'Swift version 6.1 (swift-6.1-RELEASE)')"
  check "version_from_output none" "" "$(version_from_output 'no digits here')"
  check "compare equal" "0" "$(compare_versions 1.24.0 1.24.0)"
  check "compare older" "-1" "$(compare_versions 1.23.9 1.24.0)"
  check "compare newer" "1" "$(compare_versions 1.25.0 1.24.0)"
  check "compare two components" "0" "$(compare_versions 1.24 1.24.0)"
  if [ "$failed" -eq 0 ]; then echo "self-test: all passed"; exit 0; fi
  echo "self-test: FAILED"; exit 2
}

case "${1:-}" in
  --self-test) self_test ;;
  "") ;;
  -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
esac

echo "Open iOS Studio environment check"
echo "Tested xtool version: $TESTED_XTOOL_VERSION. Status: PASS / FAIL / WARN / NOT_VERIFIED / INFO."
echo

# 1. Operating system -------------------------------------------------------------------------
os_name="$(uname -s 2>/dev/null || echo unknown)"
arch="$(uname -m 2>/dev/null || echo unknown)"
if [ "$os_name" = "Linux" ] && [ "$arch" = "x86_64" ]; then
  # shellcheck disable=SC1091
  distro="$(. /etc/os-release 2>/dev/null && printf '%s' "${PRETTY_NAME:-unknown}")"
  report PASS "Operating system" "Linux x86_64 (${distro:-unknown distribution})"
else
  report FAIL "Operating system" "$os_name $arch" "Open iOS Studio packages and xtool AppImages are built for Linux x86_64."
fi

if command -v ldconfig >/dev/null 2>&1 && ldconfig -p 2>/dev/null | grep -q 'libwebkit2gtk-4\.1\.so'; then
  report PASS "WebKitGTK 4.1 runtime" "libwebkit2gtk-4.1 is installed (needed to run the desktop app)"
elif command -v ldconfig >/dev/null 2>&1; then
  report WARN "WebKitGTK 4.1 runtime" "libwebkit2gtk-4.1 not found by ldconfig" "sudo apt install libwebkit2gtk-4.1-0 (Ubuntu 22.04+/Linux Mint 21+). The DEB package pulls it in automatically."
else
  report NOT_VERIFIED "WebKitGTK 4.1 runtime" "ldconfig not available"
fi

# 2. Swift toolchain --------------------------------------------------------------------------
swift_ok=0
if swift_path="$(command -v swift 2>/dev/null)"; then
  if out="$(run_quiet swift --version)"; then
    swift_ok=1
    report PASS "Swift toolchain" "$(first_line "$out") [$swift_path]"
  else
    report FAIL "Swift toolchain" "swift found at $swift_path but 'swift --version' failed: $(first_line "$out")" "Reinstall the toolchain from https://swift.org/install/linux (swiftly) and check missing system libraries."
  fi
else
  hint="Install from https://swift.org/install/linux (swiftly). After installing, open a new terminal so PATH is updated."
  if [ -x "$HOME/.local/share/swiftly/bin/swift" ] || [ -x "$HOME/.swiftly/bin/swift" ]; then
    hint="swiftly is installed but not on PATH. Add its bin directory to PATH in ~/.profile (not only ~/.bashrc) so desktop-launched apps see it too."
  fi
  report FAIL "Swift toolchain" "swift is not on PATH" "$hint"
fi

# 3. Darwin SDK (built by `xtool setup`) ---------------------------------------------------------
if [ "$swift_ok" -eq 1 ]; then
  if out="$(run_quiet swift sdk list)"; then
    if printf '%s' "$out" | grep -qi 'darwin'; then
      report PASS "Darwin SDK (swift sdk list)" "$(printf '%s' "$out" | grep -i darwin | head -n 1 | tr -s ' ')"
    else
      report FAIL "Darwin SDK (swift sdk list)" "no SDK named 'darwin' is installed" "Run 'xtool setup' with the path to Xcode.xip (downloaded from developer.apple.com with your Apple ID). It builds the SDK; this can take a while."
    fi
  else
    report NOT_VERIFIED "Darwin SDK (swift sdk list)" "'swift sdk list' failed: $(first_line "$out")"
  fi
else
  report NOT_VERIFIED "Darwin SDK (swift sdk list)" "skipped: Swift is missing"
fi

# 4. xtool ------------------------------------------------------------------------------------
xtool_ok=0
if xtool_path="$(command -v xtool 2>/dev/null)"; then
  if out="$(run_quiet xtool --version)"; then
    version="$(version_from_output "$out")"
    if [ -z "$version" ]; then
      report WARN "xtool" "found at $xtool_path but the version could not be parsed from '$(first_line "$out")'"
      xtool_ok=1
    else
      xtool_ok=1
      case "$(compare_versions "$version" "$TESTED_XTOOL_VERSION")" in
        0) report PASS "xtool" "$version [$xtool_path] (tested version)" ;;
        1) report WARN "xtool" "$version [$xtool_path] is newer than the tested $TESTED_XTOOL_VERSION" "Builds may work; CLI output changes are not covered by the fixtures. Report problems with the version number." ;;
        *) report WARN "xtool" "$version [$xtool_path] is older than the tested $TESTED_XTOOL_VERSION" "Download the latest AppImage from https://github.com/xtool-org/xtool/releases/latest." ;;
      esac
    fi
  else
    code=$?
    if [ "$code" -eq 124 ]; then
      report FAIL "xtool" "'xtool --version' timed out after ${CMD_TIMEOUT}s" "If xtool is an AppImage, FUSE may be missing: sudo apt install libfuse2, or set APPIMAGE_EXTRACT_AND_RUN=1."
    else
      report FAIL "xtool" "'xtool --version' failed (exit $code): $(first_line "$out")" "If xtool is an AppImage, FUSE may be missing: sudo apt install libfuse2. Make sure the file is executable (chmod +x)."
    fi
  fi
else
  report FAIL "xtool" "xtool is not on PATH" "Download the AppImage from https://github.com/xtool-org/xtool/releases/latest, rename it to 'xtool', chmod +x, move it into a PATH directory such as /usr/local/bin."
fi

# 5. xtool SDK status ---------------------------------------------------------------------------
if [ "$xtool_ok" -eq 1 ]; then
  if out="$(run_quiet xtool sdk status)"; then
    if printf '%s' "$out" | grep -qi 'not installed'; then
      report FAIL "xtool sdk status" "$(first_line "$out")" "Run 'xtool setup' (needs Xcode.xip and an Apple ID)."
    else
      report PASS "xtool sdk status" "$(first_line "$out")"
    fi
  else
    report NOT_VERIFIED "xtool sdk status" "command failed: $(first_line "$out")"
  fi
else
  report NOT_VERIFIED "xtool sdk status" "skipped: xtool is missing"
fi

# 6. Apple account (signing) ------------------------------------------------------------------
if [ "$xtool_ok" -eq 1 ]; then
  if out="$(run_quiet xtool auth status)"; then
    if printf '%s' "$out" | grep -qi 'logged out'; then
      report WARN "Apple account (xtool auth)" "logged out: building works, installing on an iPhone does not" "Run 'xtool setup' or 'xtool auth login' in your own terminal. Open iOS Studio never asks for Apple credentials."
    else
      report PASS "Apple account (xtool auth)" "$(first_line "$out")"
    fi
  else
    report NOT_VERIFIED "Apple account (xtool auth)" "command failed: $(first_line "$out")"
  fi
else
  report NOT_VERIFIED "Apple account (xtool auth)" "skipped: xtool is missing"
fi

# 7. USB device support -----------------------------------------------------------------------
if command -v usbmuxd >/dev/null 2>&1 || [ -x /usr/sbin/usbmuxd ] || [ -x /usr/bin/usbmuxd ]; then
  report PASS "usbmuxd" "installed (talks to the iPhone over USB)"
else
  report WARN "usbmuxd" "not installed: an iPhone cannot be detected" "sudo apt install usbmuxd"
fi
if command -v idevice_id >/dev/null 2>&1; then
  if out="$(run_quiet idevice_id -l)"; then
    count="$(printf '%s' "$out" | grep -c '[0-9a-f]' || true)"
    if [ "$count" -gt 0 ]; then
      report PASS "iPhone over USB (idevice_id)" "$count device(s) visible"
    else
      report WARN "iPhone over USB (idevice_id)" "no device visible" "Connect the iPhone with a data cable, unlock it, tap 'Trust this computer', and enable Developer Mode (Settings > Privacy & Security)."
    fi
  else
    report NOT_VERIFIED "iPhone over USB (idevice_id)" "idevice_id failed: $(first_line "$out")"
  fi
else
  report INFO "iPhone over USB (idevice_id)" "libimobiledevice-utils not installed (optional, helps diagnosing USB problems)" "sudo apt install libimobiledevice-utils"
fi

# 8. Devices seen by xtool --------------------------------------------------------------------
if [ "$xtool_ok" -eq 1 ]; then
  if out="$(run_quiet xtool devices --no-wait)"; then
    if printf '%s' "$out" | grep -q '[^[:space:]]'; then
      report PASS "xtool devices" "$(first_line "$out")"
    else
      report WARN "xtool devices" "no iPhone connected (needed only to install and run the app)"
    fi
  else
    report NOT_VERIFIED "xtool devices" "command failed: $(first_line "$out")"
  fi
else
  report NOT_VERIFIED "xtool devices" "skipped: xtool is missing"
fi

# 9. Optional tooling -------------------------------------------------------------------------
if command -v git >/dev/null 2>&1; then
  report PASS "git" "$(first_line "$(run_quiet git --version)")"
else
  report WARN "git" "not installed" "sudo apt install git"
fi
for tool in claude codex; do
  if path="$(command -v "$tool" 2>/dev/null)"; then
    report INFO "$tool CLI (AI, optional)" "found at $path (log in from the app's embedded terminal)"
  else
    report INFO "$tool CLI (AI, optional)" "not installed (needed only for the subscription provider)"
  fi
done
if command -v open-ios-studio >/dev/null 2>&1; then
  report INFO "Open iOS Studio" "installed (DEB): $(command -v open-ios-studio)"
else
  report INFO "Open iOS Studio" "DEB not installed on PATH (AppImage use is fine)"
fi

# Summary ---------------------------------------------------------------------------------------
echo
if [ "$required_failures" -eq 0 ]; then
  if [ "$warnings" -eq 0 ]; then
    echo "Result: all required checks passed."
  else
    echo "Result: required checks passed; $warnings warning(s) above concern device/signing steps."
  fi
  echo "A successful check is not a successful build: run a real build from the app's Derle panel."
  exit 0
fi
echo "Result: $required_failures required check(s) failed. Fix the FAIL lines in order (Swift -> SDK -> xtool), then run again."
exit 1
