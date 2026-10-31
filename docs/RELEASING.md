# Releasing

Releases are cut by the owner only. Never create a tag or release without explicit owner approval.

## Rule: pre-release first

Every release is published as a GitHub pre-release. It stays a pre-release until a human has launched the packaged app on a real Linux desktop and confirmed it works. CI never verifies the desktop launch. Only after that confirmation may the owner edit the release and clear the pre-release flag.

## Steps

1. Branch `release/vX.Y.Z` from up-to-date `main`.
2. Bump the version to `X.Y.Z` in all three places:
   - `package.json` (`version`)
   - `src-tauri/tauri.conf.json` (`version`)
   - `src-tauri/Cargo.toml` (`[package] version`)
3. In `CHANGELOG.md`, move items from `[Unreleased]` into a new `## [X.Y.Z] - YYYY-MM-DD` section, keep the Known limitations list honest, and update the compare links.
4. Update `docs/STATUS.md`. Open a PR, wait for green CI, merge.
5. With the owner's approval, tag the merge commit and push the tag:
   ```sh
   git tag -a vX.Y.Z -m "Open iOS Studio vX.Y.Z"
   git push origin vX.Y.Z
   ```
   Tag pushes are the only automatic trigger of `.github/workflows/release.yml`. It can also be run manually (Actions, "Release", input `tag`) for an existing tag.

## What the workflow does

1. `verify`: typecheck, lint, tests, policy catalog validation, frontend build, `cargo fmt --check`, `clippy`, `cargo test`.
2. `bundle`: fails if the tag version differs from `src-tauri/tauri.conf.json`; builds DEB and AppImage; renames them to `Open-iOS-Studio_<version>_amd64.deb` and `Open-iOS-Studio_<version>_amd64.AppImage`; writes and checks `SHA256SUMS.txt`; checks the DEB contains `usr/bin/open-ios-studio` and that the AppImage starts with the ELF magic; uploads the artifact.
3. `publish`: the only job with `contents: write`. Builds `RELEASE_NOTES.md` from the matching `CHANGELOG.md` section plus a fixed honesty block, then runs `gh release create ... --prerelease`.

## Verifying a download

```sh
sha256sum -c SHA256SUMS.txt
```

Run it in the folder holding the downloaded files (it checks both). Before announcing a release, install the DEB or run the AppImage on a real desktop and record the result in `docs/STATUS.md`.

## Deleting a bad pre-release

Needs owner approval. With the GitHub CLI:

```sh
gh release delete vX.Y.Z --cleanup-tag --yes
```

Then fix the problem, bump to a new patch version rather than reusing the tag, and release again.
