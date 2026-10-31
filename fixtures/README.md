# Captured CLI fixtures

`xtool-1.24.0/` is real output of the pinned xtool 1.24.0 release (`xtool-x86_64.AppImage`, sha256
`dbfd9d72…ab59f`), captured by `.github/workflows/xtool-fixtures.yml` with `scripts/capture-xtool.sh`
on a GitHub Ubuntu runner: no credentials, no Darwin SDK, no device. Each case has `.args`, `.stdout`,
`.stderr`, `.exit`. Parser tests read these files, so a new xtool version must add its own directory.
