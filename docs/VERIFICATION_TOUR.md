# Verification tour

The one thing CI cannot do: run the packaged app on a real Linux desktop with a real iPhone. This tour is the owner's checklist. Each item names the action, what "pass" looks like, and the row of the "Verification tour" table in `docs/STATUS.md` to update with `VERIFIED` (date, app version) or `BLOCKED` (why). Record what you saw, not what you expected. A screen recording of items 3 to 6 is the launch-day proof.

Prerequisites: Linux Mint 21+/Ubuntu 22.04+, the latest DEB from the Releases page, an iPhone with Developer Mode on, a USB data cable, Swift + xtool + Darwin SDK set up (`docs/ENVIRONMENT.md`).

| # | Action | Pass looks like | STATUS row |
|---|---|---|---|
| 1 | `sudo apt install ./Open-iOS-Studio_<version>_amd64.deb`, start it from the menu. | Window opens with the welcome screen and the four cards; status bar shows the project, xtool, Swift segments. | T1 |
| 2 | Derle → "Ortamı denetle". | Swift, Darwin SDK, xtool and xtool SDK rows are PASS; any WARN names a device/signing step only. | T2 |
| 3 | Dosyalar → "Klasör aç" on an empty folder; Derle → "Yeni proje", name `TourApp`. | `Package.swift`, `xtool.yml`, `Sources/TourApp/` appear in the tree within a few seconds. | T3 |
| 4 | Derle → "Yalnızca derle" on `TourApp`. | Summary says the build succeeded; stages reach the end; Çıktı tab has xtool's "Build complete" line. | T4 |
| 5 | Connect the iPhone, unlock, trust; Cihazlar → "Yenile". | The phone is listed with its name; status bar shows it instead of "iPhone bağlı değil". | T5 |
| 6 | Derle → "Derle ve Yükle" (debug). | The app installs and launches on the phone; Cihaz günlükleri shows the install and launch lines. | T6 |
| 7 | Yapay zekâ → provider "Claude (abonelik)" → "Claude Code'u bu projede aç". | The terminal shows Claude Code's prompt; `ls .claude/skills` in another terminal lists `ios-app-xtool`, `mobile-ios-design`, `find-skills`. | T7 |
| 8 | In the embedded terminal (plain shell), type `çğıöşü ÇĞİÖŞÜ` and press Enter. | The shell echoes the same letters; no extra spaces, no `[Pasted text]`. Repeat inside Claude Code's prompt. | T8 |
| 9 | Ayarlar → Güncellemeler → "Güncellemeleri denetle". | "Güncelsiniz" with the installed and latest versions equal; or the newer version with a download button. | T9 |
| 10 | App Store → "Analizi çalıştır" on a real project (e.g. Zetapilates). | A report with counts; no rule shows PASS without a finding or a detector; the footer disclaimer is visible. | T10 |
| 11 | Terminal: copy a line with the mouse, paste it with Ctrl+Shift+V. | The pasted text matches; Claude Code shows it as pasted text, not as keystrokes. (After PR #52.) | T11 |
| 12 | After the pre-submission check ships: run "Yayın öncesi denetim" on `TourApp`. | Build and policy steps PASS, tests NOT_VERIFIED (no Tests/), manifest NOT_VERIFIED (xtool defaults), verdict green; "Derle ve Yükle" enabled. | T12 |
| 13 | After Swift language support ships: open `ContentView.swift`, type `Text(` and wait. | A completion list appears; a deliberate typo shows a red squiggle and a row in Sorunlar within a few seconds. | T13 |

## When something fails

Write the item number, the exact text on screen and the app version in a GitHub issue with the bug template, or paste it to Claude Code with the request to reproduce it. Do not mark an item VERIFIED on a second try without noting what changed between tries.
