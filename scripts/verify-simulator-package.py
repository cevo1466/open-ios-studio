#!/usr/bin/env python3
"""Verify simulator resources and real Swift execution from our built Linux packages."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[1]
RESOURCES = {
    "SwiftUI.swift": REPO / "runtime/SwiftUI/SwiftUI.swift",
    "examples/Counter.swift": REPO / "examples/LocalSimulator/Counter.swift",
    "README.md": REPO / "runtime/README.md",
    "LICENSE": REPO / "LICENSE",
}


def command_json(binary, flag):
    result = subprocess.run([str(binary), flag], capture_output=True, text=True, timeout=300)
    if result.returncode:
        raise RuntimeError(f"{flag} failed: {result.stderr[-8000:]}")
    return json.loads(result.stdout)


def verify(package, kind):
    package = package.resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="ois-package-check-") as folder:
        root = Path(folder)
        if kind == "deb":
            subprocess.run(["dpkg-deb", "--extract", str(package), str(root)], check=True)
        else:
            subprocess.run([str(package), "--appimage-extract"], cwd=root, stdout=subprocess.DEVNULL, check=True, timeout=120)
            root = root / "squashfs-root"
        found = list(root.glob("**/simulator/SwiftUI.swift"))
        if len(found) != 1:
            raise RuntimeError(f"{package.name}: expected one bundled SwiftUI module, got {len(found)}")
        resources = found[0].parent
        hashes = {}
        for name, expected in RESOURCES.items():
            bundled = resources / name
            if not bundled.is_file() or bundled.read_bytes() != expected.read_bytes():
                raise RuntimeError(f"{package.name}: missing or changed simulator resource {name}")
            hashes[name] = hashlib.sha256(bundled.read_bytes()).hexdigest()
        binary = root / "usr/bin/open-ios-studio"
        if not binary.is_file():
            raise RuntimeError("Installed Studio executable is missing")
        info = command_json(binary, "--simulator-info")
        if info.get("bundleId") != "open-ios-studio.local-swift.v1" or info.get("runtimeBytes") != RESOURCES["SwiftUI.swift"].stat().st_size:
            raise RuntimeError("Installed executable does not report the expected embedded simulator")
        smoke = command_json(binary, "--simulator-smoke-test")
        if smoke.get("compiled") is not True or smoke.get("afterClick") != "Count: 1":
            raise RuntimeError("Installed simulator did not execute the compiled Swift counter callback")
        return {"package": package.name, "kind": kind, "resources": hashes, "info": info, "smoke": smoke, "desktopLaunch": "NOT_VERIFIED_BY_THIS_CHECK"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deb", type=Path)
    parser.add_argument("--appimage", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    results = []
    for kind in ("deb", "appimage"):
        package = getattr(args, kind)
        if package:
            results.append(verify(package, kind))
    if not results:
        parser.error("Supply --deb and/or --appimage")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"packages": results}, indent=2) + "\n")
    print(f"Simulator resources and compiled Swift callback verified in {len(results)} package(s).")


if __name__ == "__main__":
    main()
