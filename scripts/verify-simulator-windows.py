"""Validate an installed Windows package, separately from native UI testing."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("package_check", Path(__file__).with_name("verify-simulator-package.py"))
package_check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package_check)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--installed-dir", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
root = args.installed_dir.resolve(strict=True)
resources = list(root.glob("**/simulator/SwiftUI.swift"))
if len(resources) != 1:
    raise RuntimeError(f"Expected one installed simulator module, got {len(resources)}")
hashes = {}
for name, original in package_check.RESOURCES.items():
    installed = resources[0].parent / name
    if not installed.is_file() or installed.read_bytes() != original.read_bytes():
        raise RuntimeError(f"Installed simulator resource differs: {name}")
    hashes[name] = hashlib.sha256(installed.read_bytes()).hexdigest()
binary = root / "open-ios-studio.exe"
info = package_check.command_json(binary, "--simulator-info")
smoke = package_check.command_json(binary, "--simulator-smoke-test")
assert info["platform"] == "windows" and info["platformSupported"] and info["compilerPath"]
assert smoke["compiled"] and smoke["afterClick"] == "Count: 1"
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps({"resources": hashes, "info": info, "smoke": smoke, "desktopLaunch": "CHECKED_SEPARATELY"}, indent=2) + "\n")
print("Installed Windows resources and actual compiled Swift callback verified.")
