---
name: ios-app-xtool
description: How to build, run, test and prepare an iOS app for App Store review inside Open iOS Studio on Linux (xtool, SwiftPM layout, no Xcode, no simulator). Use for any work in an Open iOS Studio project - creating screens, fixing build errors, adding permissions, or getting ready to submit.
---

# iOS apps in Open iOS Studio (xtool on Linux)

You are working inside a project created for Open iOS Studio. There is no Xcode and no iOS Simulator on this machine; the only way to see the app is a real iPhone connected by USB. Say that plainly whenever the user asks for a preview.

## Project layout (xtool)

```
Package.swift          SwiftPM manifest; the app is a library target + xtool packaging
xtool.yml              bundle id, version, Info.plist entries, resources
Sources/<AppName>/     SwiftUI code (App struct with @main, views, models)
Tests/<AppName>Tests/  unit tests for logic that does not need UIKit
.claude/skills/        skills Open iOS Studio installed (this file is one of them)
```

Read `Package.swift`, `xtool.yml` and everything under `Sources/` before changing anything.

## Commands (run from the project folder)

| Goal | Command |
|---|---|
| Compile for iOS | `xtool dev build` |
| Build, sign, install and launch on the connected iPhone | `xtool dev` |
| List connected devices | `xtool devices --no-wait` |
| Check the Darwin SDK | `xtool sdk status` |
| Check the Apple account used for signing | `xtool auth status` |
| Run unit tests that do not need UIKit | `swift test` (host build; iOS-only APIs are unavailable) |

Never run `xtool auth login` or `xtool setup` for the user; those need Apple credentials, which the user enters in their own terminal. Never suggest `xcodebuild`, `xcrun`, `simctl` or Instruments.

## Writing code that works here

- Target the Swift toolchain that xtool uses (`swift --version` in the terminal). Prefer APIs available since iOS 16; when using iOS 17/18-only APIs, guard with `if #available` or raise the minimum in `xtool.yml` and tell the user.
- Keep UI in SwiftUI. Use semantic colours and fonts, SF Symbols, `NavigationStack`, `TabView`, sheets. The `mobile-ios-design` skill has the patterns.
- One feature per change: edit the smallest set of files, then run `xtool dev build` and fix every error before moving on. Paste the exact compiler error into your reasoning; do not guess.
- Add permission usage strings (`NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSLocationWhenInUseUsageDescription`, ...) in `xtool.yml` the moment a feature needs them. Missing strings crash the app on device and are rejected by App Review.
- Keep secrets out of the source. API keys belong in the app's keychain at runtime or on a server, never in Swift files or `xtool.yml`.
- Network calls must use HTTPS. Do not add `NSAllowsArbitraryLoads`.
- Store sensitive data with Keychain, never `UserDefaults`.
- Follow the App Store rules the project enforces: `policies/*.rules.json` and `docs/policies/*.md` in the Open iOS Studio repository, and the App Store / Güvenlik panels in the IDE. Build success is not App Store compliance.

## Testing on Linux (what is possible)

- `xtool dev build` is the compile check; run it after every change.
- `swift test` runs logic tests on the host. Anything importing UIKit or SwiftUI cannot run here; keep models, parsers and view models free of UIKit so they stay testable.
- UI tests (XCUITest) and performance tests need Xcode and are not available. Say so; do not pretend they ran.
- Device test: `xtool dev` then the user tries the flow on the iPhone and reports. Ask for the specific steps they tried.

## Before App Store submission

1. In the IDE, run **App Store hazırlığı** and **Güvenlik merkezi**; fix every FAIL and explain each NOT_VERIFIED item the user must check by hand.
2. `xtool.yml`: bundle id, version and build number bumped, display name, category, privacy usage strings, `PrivacyInfo.xcprivacy` listing required-reason APIs and tracking.
3. App icon (1024x1024, no alpha) and launch experience present.
4. Account deletion inside the app if the app has sign-up; login works without social accounts as the only option.
5. Submission needs a paid Apple Developer Program membership and App Store Connect; a free Apple ID can only install on the user's own devices. Say this clearly if the user has no paid account.
6. Draft the App Review notes: demo account, what each permission is for, what is behind every paywall.

## How to report

Answer in Turkish, keep code and identifiers in English, list what you verified (build ran, test ran) and what you could not verify (device, App Review).
