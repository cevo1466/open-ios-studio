import { describe, expect, it } from 'vitest';
import { asrDetectors } from './asr';
import type { Capabilities, DetectorResult, ProjectFile } from '../types';

function caps(over: Partial<Capabilities> = {}): Capabilities {
  return {
    targetsAppStore: false,
    hasUserAccounts: false,
    hasSocialLogin: false,
    socialProviders: [],
    hasSignInWithApple: false,
    hasSubscriptions: false,
    hasInAppPurchases: false,
    usesFirebase: false,
    hasBackend: false,
    usesExternalApis: false,
    processesPersonalData: false,
    usesCamera: false,
    usesMicrophone: false,
    usesLocation: false,
    usesPhotos: false,
    usesTracking: false,
    usesWebView: false,
    usesAI: false,
    hasAuthTokens: false,
    hasDeepLinks: false,
    hasExternalPaymentLinks: false,
    hasOtpFlow: false,
    hasPasswordReset: false,
    hasAdminRoles: false,
    hasUserControlledUrlFetch: false,
    hasCiWorkflows: false,
    ...over,
  };
}

function run(id: string, files: ProjectFile[], over: Partial<Capabilities> = {}): DetectorResult {
  const d = asrDetectors.find((x) => x.ruleId === id);
  if (!d) throw new Error(`no detector ${id}`);
  return d.run({ files, capabilities: caps(over) });
}

const plist = (entries: string, path = 'Sources/App/Info.plist'): ProjectFile => ({
  path,
  content: `<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n${entries}\n</dict>\n</plist>\n`,
});
const sw = (content: string, path = 'Sources/App/App.swift'): ProjectFile => ({ path, content });

describe('registry', () => {
  it('exports one detector per rule id', () => {
    expect(asrDetectors.map((d) => d.ruleId).sort()).toEqual([
      'ASR-011',
      'ASR-013',
      'ASR-014',
      'ASR-015',
      'ASR-017',
      'ASR-019',
    ]);
  });
});

describe('ASR-015 permission purpose strings', () => {
  const cameraSwift = sw('import AVFoundation\nfunc go() {\n  let s = AVCaptureSession()\n}\n');

  it('passes when the key has a specific purpose string', () => {
    const r = run('ASR-015', [
      cameraSwift,
      plist('<key>NSCameraUsageDescription</key>\n<string>Used to scan receipts you want to save.</string>'),
    ]);
    expect(r.outcome).toBe('pass');
  });

  it('fails with file and line when the key is missing', () => {
    const r = run('ASR-015', [cameraSwift, plist('<key>CFBundleName</key>\n<string>Demo</string>')]);
    expect(r.outcome).toBe('fail');
    expect(r.findings[0].file).toBe('Sources/App/App.swift');
    expect(r.findings[0].line).toBe(3);
    expect(r.findings[0].evidence).toContain('AVCaptureSession');
    expect(r.findings[0].message).toContain('NSCameraUsageDescription');
  });

  it('fails on empty, generic or short strings pointing at the plist line', () => {
    for (const val of ['', 'TODO', 'Lorem ipsum dolor sit amet consectetur', 'This app needs access to the camera', 'Camera use']) {
      const r = run('ASR-015', [
        cameraSwift,
        plist(`<key>NSCameraUsageDescription</key>\n<string>${val}</string>`),
      ]);
      expect(r.outcome, val).toBe('fail');
      expect(r.findings[0].file).toBe('Sources/App/Info.plist');
      expect(r.findings[0].line).toBe(4);
    }
  });

  it('does not report camera findings when camera is not used', () => {
    const r = run('ASR-015', [sw('import SwiftUI\nstruct A {}\n'), plist('<key>CFBundleName</key>\n<string>Demo</string>')]);
    expect(r.outcome).toBe('pass');
    expect(r.findings.some((f) => f.message.includes('Camera') || f.message.includes('camera'))).toBe(false);
  });

  it('warns about an unused permission key', () => {
    const r = run('ASR-015', [
      sw('struct A {}\n'),
      plist('<key>NSMicrophoneUsageDescription</key>\n<string>Record voice notes for your journal.</string>'),
    ]);
    expect(r.outcome).toBe('warn');
    expect(r.findings[0].message).toContain('Unused permission');
    expect(r.findings[0].line).toBe(4);
  });

  it('is not_verified when an API is used and no plist file exists', () => {
    expect(run('ASR-015', [cameraSwift]).outcome).toBe('not_verified');
  });

  it('ignores API names in comments', () => {
    const r = run('ASR-015', [sw('// AVCaptureSession would go here\n'), plist('<key>CFBundleName</key>\n<string>X</string>')]);
    expect(r.outcome).toBe('pass');
  });
});

describe('ASR-013 account deletion', () => {
  const signup = 'func signUp(email: String) {}\n';

  it('passes when a deletion flow exists (partial note)', () => {
    const r = run('ASR-013', [sw(`${signup}Button("Delete Account") { }\n`)]);
    expect(r.outcome).toBe('pass');
    expect(r.note).toContain('Server-side data deletion is not verified');
  });

  it('fails with the account creation location when no deletion exists', () => {
    const r = run('ASR-013', [sw(`import SwiftUI\n${signup}`)]);
    expect(r.outcome).toBe('fail');
    expect(r.findings[0].file).toBe('Sources/App/App.swift');
    expect(r.findings[0].line).toBe(2);
  });

  it('does not fail when there is no account creation, and ignores comments', () => {
    expect(run('ASR-013', [sw('struct A {}\n')]).outcome).toBe('pass');
    const r = run('ASR-013', [sw(`${signup}// TODO: deleteAccount\n`)]);
    expect(r.outcome).toBe('fail');
  });
});

describe('ASR-014 Sign in with Apple', () => {
  it('passes with SIWA present', () => {
    const r = run('ASR-014', [sw('struct A {}\n')], {
      hasSocialLogin: true,
      socialProviders: ['google'],
      hasSignInWithApple: true,
    });
    expect(r.outcome).toBe('pass');
  });

  it('warns with exceptions explained when social login lacks SIWA', () => {
    const r = run('ASR-014', [sw('import UIKit\nlet g = GoogleSignIn.shared\n')], {
      hasSocialLogin: true,
      socialProviders: ['google'],
    });
    expect(r.outcome).toBe('warn');
    expect(r.findings[0].file).toBe('Sources/App/App.swift');
    expect(r.findings[0].line).toBe(2);
    expect(r.findings[0].remediation).toMatch(/exceptions/i);
  });

  it('does not fail without social login', () => {
    const r = run('ASR-014', [sw('struct A {}\n')]);
    expect(r.outcome).toBe('pass');
    expect(r.note).toBe('no third-party social login detected');
  });

  it('accepts SIWA detected in source even if the capability flag is false', () => {
    const r = run('ASR-014', [sw('let b = SignInWithAppleButton { _ in } onCompletion: { _ in }\n')], {
      hasSocialLogin: true,
      socialProviders: ['facebook'],
    });
    expect(r.outcome).toBe('pass');
  });

  it('is not_verified when providers are unknown', () => {
    const r = run('ASR-014', [sw('struct A {}\n')], { hasSocialLogin: true });
    expect(r.outcome).toBe('not_verified');
  });
});

describe('ASR-011 restore purchases', () => {
  it('passes when restore is implemented', () => {
    const r = run('ASR-011', [
      sw('import StoreKit\nfunc r() async { try? await AppStore.sync() }\n'),
    ], { hasSubscriptions: true });
    expect(r.outcome).toBe('pass');
  });

  it('passes with a "Restore Purchases" string', () => {
    const r = run('ASR-011', [sw('import StoreKit\nButton("Restore Purchases") {}\n')]);
    expect(r.outcome).toBe('pass');
  });

  it('fails with the StoreKit location when restore is missing', () => {
    const r = run('ASR-011', [sw('import SwiftUI\nimport StoreKit\nlet p = try await Product.products(for: ["a"])\n')], {
      hasSubscriptions: true,
    });
    expect(r.outcome).toBe('fail');
    expect(r.findings[0].file).toBe('Sources/App/App.swift');
    expect(r.findings[0].line).toBe(2);
  });

  it('does not fail when no StoreKit is used; restore only in a comment still fails', () => {
    expect(run('ASR-011', [sw('struct A {}\n')]).outcome).toBe('pass');
    const r = run('ASR-011', [sw('import StoreKit\n// restorePurchases later\n')]);
    expect(r.outcome).toBe('fail');
  });

  it('is not_verified when purchases are declared without any StoreKit code', () => {
    expect(run('ASR-011', [sw('struct A {}\n')], { hasInAppPurchases: true }).outcome).toBe('not_verified');
  });
});

describe('ASR-017 placeholder content', () => {
  it('passes for clean sources', () => {
    const r = run('ASR-017', [sw('import SwiftUI\nText("Welcome back")\n')]);
    expect(r.outcome).toBe('pass');
  });

  it('fails for Lorem ipsum / Coming soon in UI strings with correct line', () => {
    const r = run('ASR-017', [
      sw('import SwiftUI\nvar body: some View {\n  Text("Lorem ipsum dolor")\n  Label("Coming soon", systemImage: "x")\n}\n'),
    ]);
    expect(r.outcome).toBe('fail');
    expect(r.findings.map((f) => f.line)).toEqual([3, 4]);
    expect(r.findings[0].file).toBe('Sources/App/App.swift');
  });

  it('warns for the template greeting', () => {
    const r = run('ASR-017', [sw('Text("Hello, world!")\n')]);
    expect(r.outcome).toBe('warn');
    expect(r.findings[0].line).toBe(1);
  });

  it('warns (not fails) for Lorem in a non-UI string', () => {
    const r = run('ASR-017', [sw('let sample = "Lorem ipsum"\n')]);
    expect(r.outcome).toBe('warn');
  });

  it('ignores TODO in comments, non-UI strings and test paths', () => {
    const r = run('ASR-017', [
      sw('// TODO: fix\n/* FIXME later\n Coming soon */\nlet key = "TODO"\n'),
      sw('Text("Lorem ipsum")\n', 'Tests/AppTests/AppTests.swift'),
    ]);
    expect(r.outcome).toBe('pass');
  });

  it('flags TODO inside a Text literal', () => {
    const r = run('ASR-017', [sw('Text("TODO write copy")\n')]);
    expect(r.outcome).toBe('warn');
  });

  it('scans plist and strings files', () => {
    const r = run('ASR-017', [
      { path: 'Resources/en.lproj/Localizable.strings', content: '/* Coming soon */\n"home" = "Home";\n"soon" = "Coming soon";\n' },
    ]);
    expect(r.outcome).toBe('warn');
    expect(r.findings[0].line).toBe(3);
  });

  it('is not_verified without scannable files', () => {
    expect(run('ASR-017', []).outcome).toBe('not_verified');
  });
});

describe('ASR-019 branding consistency', () => {
  it('passes for consistent real branding', () => {
    const r = run('ASR-019', [
      { path: 'xtool.yml', content: 'bundleID: dev.acmeless.notes\n' },
      plist('<key>CFBundleName</key>\n<string>Notes</string>\n<key>CFBundleDisplayName</key>\n<string>Notes</string>'),
      sw('Text("Notes")\n'),
    ]);
    expect(r.outcome).toBe('pass');
  });

  it('fails for com.example bundleID in xtool.yml with line', () => {
    const r = run('ASR-019', [{ path: 'xtool.yml', content: 'version: 1\nbundleID: com.example.MyApp\n' }]);
    expect(r.outcome).toBe('fail');
    expect(r.findings[0]).toMatchObject({ file: 'xtool.yml', line: 2 });
  });

  it('warns for template names and placeholder contacts in UI strings', () => {
    const r = run('ASR-019', [sw('import SwiftUI\nText("Welcome to MyApp")\nText("Mail us: foo@bar.com")\n')]);
    expect(r.outcome).toBe('warn');
    expect(r.findings.map((f) => f.line)).toEqual([2, 3]);
  });

  it('warns for com.example in plist', () => {
    const r = run('ASR-019', [plist('<key>CFBundleIdentifier</key>\n<string>com.example.app</string>')]);
    expect(r.outcome).toBe('warn');
    expect(r.findings[0].line).toBe(5);
  });

  it('warns on display name / bundle name mismatch', () => {
    const r = run('ASR-019', [
      plist('<key>CFBundleName</key>\n<string>Notes</string>\n<key>CFBundleDisplayName</key>\n<string>Jotter</string>'),
    ]);
    expect(r.outcome).toBe('warn');
    expect(r.findings[0].message).toContain('CFBundleDisplayName');
    expect(r.findings[0].line).toBe(6);
  });

  it('ignores template names in comments and identifiers, and $() variables', () => {
    const r = run('ASR-019', [
      sw('// Acme sample\nstruct MyAppView {}\nlet x = 1\n'),
      plist('<key>CFBundleName</key>\n<string>$(PRODUCT_NAME)</string>\n<key>CFBundleDisplayName</key>\n<string>Notes</string>'),
    ]);
    expect(r.outcome).toBe('pass');
  });
});
