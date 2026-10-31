/**
 * App Store Review (ASR) source-level detectors: ASR-011, 013, 014, 015, 017, 019.
 * All checks are static heuristics over `ctx.files`. They prefer `not_verified` over guessing and
 * only return `pass` when the check really ran and found nothing wrong.
 */
import type {
  Detector,
  DetectorContext,
  DetectorFinding,
  DetectorResult,
  ProjectFile,
} from '../types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const isSwift = (f: ProjectFile): boolean => f.path.endsWith('.swift');
const isPlist = (f: ProjectFile): boolean => f.path.endsWith('.plist');
const isStrings = (f: ProjectFile): boolean => f.path.endsWith('.strings');
const isXtoolYml = (f: ProjectFile): boolean => /(^|\/)xtool\.ya?ml$/.test(f.path);

const isTestPath = (p: string): boolean =>
  /(^|\/)(Tests?|UITests?|[A-Za-z0-9_]+Tests)\//.test(p) || /(Tests?|UITests?)\.swift$/.test(p);

/**
 * Blank out C-style comments (// and block) while keeping string literals and line structure,
 * so line numbers stay 1:1 with the original file.
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (c === '"' && src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3);
      const stop = end === -1 ? n : end + 3;
      out += src.slice(i, stop);
      i = stop;
    } else if (c === '"') {
      out += c;
      i++;
      while (i < n && src[i] !== '"' && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < n && src[i + 1] !== '\n') {
          out += src[i] + src[i + 1];
          i += 2;
        } else {
          out += src[i];
          i++;
        }
      }
      if (i < n && src[i] === '"') {
        out += '"';
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === '\n') line++;
  return line;
}

function lineText(content: string, line: number): string {
  return (content.split('\n')[line - 1] ?? '').trim();
}

function result(findings: DetectorFinding[], failing: boolean, note?: string): DetectorResult {
  return { outcome: failing ? 'fail' : findings.length > 0 ? 'warn' : 'pass', findings, note };
}

/** First regex hit across comment-stripped Swift sources. */
function findInSwift(
  files: ProjectFile[],
  re: RegExp,
): { file: string; line: number; evidence: string } | null {
  for (const f of files.filter(isSwift)) {
    const stripped = stripComments(f.content);
    const m = new RegExp(re.source, re.flags.replace('g', '')).exec(stripped);
    if (m) {
      const line = lineOf(stripped, m.index);
      return { file: f.path, line, evidence: lineText(f.content, line) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// ASR-015 Permission purpose strings
// ---------------------------------------------------------------------------

interface PermissionSpec {
  label: string;
  key: string;
  /** Additional keys that also count as "this permission is declared" for the unused check. */
  relatedKeys: string[];
  cap: 'usesCamera' | 'usesMicrophone' | 'usesLocation' | 'usesPhotos' | 'usesTracking';
  usage: RegExp;
}

const PERMISSIONS: PermissionSpec[] = [
  {
    label: 'camera',
    key: 'NSCameraUsageDescription',
    relatedKeys: [],
    cap: 'usesCamera',
    usage:
      /\bAVCaptureSession\b|\bAVCaptureDevice\b|\bAVCaptureVideoPreviewLayer\b|\bDataScannerViewController\b|sourceType\s*[:=]\s*\.camera/,
  },
  {
    label: 'microphone',
    key: 'NSMicrophoneUsageDescription',
    relatedKeys: [],
    cap: 'usesMicrophone',
    usage:
      /\bAVAudioRecorder\b|\brequestRecordPermission\b|\bSFSpeechRecognizer\b|\bAVAudioEngine\b|AVCaptureDevice\.default\(\s*for:\s*\.audio/,
  },
  {
    label: 'location',
    key: 'NSLocationWhenInUseUsageDescription',
    relatedKeys: ['NSLocationAlwaysAndWhenInUseUsageDescription', 'NSLocationAlwaysUsageDescription'],
    cap: 'usesLocation',
    usage: /\bCLLocationManager\b|\brequestWhenInUseAuthorization\b|\brequestAlwaysAuthorization\b/,
  },
  {
    label: 'photos',
    key: 'NSPhotoLibraryUsageDescription',
    relatedKeys: ['NSPhotoLibraryAddUsageDescription'],
    cap: 'usesPhotos',
    usage:
      /\bPHPhotoLibrary\b|\bPHAsset\b|\bPHAssetChangeRequest\b|\bUIImageWriteToSavedPhotosAlbum\b|sourceType\s*[:=]\s*\.photoLibrary/,
  },
  {
    label: 'tracking',
    key: 'NSUserTrackingUsageDescription',
    relatedKeys: [],
    cap: 'usesTracking',
    usage: /\bATTrackingManager\b|\brequestTrackingAuthorization\b/,
  },
];

interface PlistEntry {
  file: string;
  line: number;
  /** null when the key has no string value */
  value: string | null;
}

function collectPurposeEntries(files: ProjectFile[]): Map<string, PlistEntry[]> {
  const map = new Map<string, PlistEntry[]>();
  const add = (key: string, e: PlistEntry): void => {
    const arr = map.get(key) ?? [];
    arr.push(e);
    map.set(key, arr);
  };
  for (const f of files) {
    if (isPlist(f)) {
      const keyRe = /<key>(NS[A-Za-z]+UsageDescription)<\/key>/g;
      let m: RegExpExecArray | null;
      while ((m = keyRe.exec(f.content))) {
        const after = f.content.slice(m.index + m[0].length);
        const v = /^\s*(?:<string>([\s\S]*?)<\/string>|<string\s*\/>)/.exec(after);
        add(m[1], {
          file: f.path,
          line: lineOf(f.content, m.index),
          value: v ? (v[1] ?? '') : null,
        });
      }
    } else if (isStrings(f) && /InfoPlist\.strings$/.test(f.path)) {
      const re = /^\s*"?(NS[A-Za-z]+UsageDescription)"?\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.content))) {
        add(m[1], { file: f.path, line: lineOf(f.content, m.index), value: m[2] });
      }
    }
  }
  return map;
}

function purposeStringProblem(value: string | null): string | null {
  if (value === null) return 'has no string value';
  const v = value.trim();
  if (v.length === 0) return 'is empty';
  if (/\bTODO\b/i.test(v)) return 'contains a TODO placeholder';
  if (/lorem/i.test(v)) return 'contains Lorem ipsum text';
  if (/^this app needs access\b/i.test(v)) return 'is the generic "This app needs access" text';
  if (v.length < 15) return `is too short to explain the purpose (${v.length} chars, minimum 15)`;
  return null;
}

const asr015: Detector = {
  ruleId: 'ASR-015',
  run(ctx: DetectorContext): DetectorResult {
    const entries = collectPurposeEntries(ctx.files);
    const hasPlistLike = ctx.files.some((f) => isPlist(f) || isStrings(f));
    const findings: DetectorFinding[] = [];
    let failing = false;
    let unverified = false;
    let anyUsed = false;

    for (const spec of PERMISSIONS) {
      const hit = findInSwift(ctx.files, spec.usage);
      const used = Boolean(hit) || ctx.capabilities[spec.cap];
      const declared = [spec.key, ...spec.relatedKeys].flatMap((k) => entries.get(k) ?? []);

      if (used) {
        anyUsed = true;
        const own = entries.get(spec.key) ?? [];
        if (own.length === 0) {
          if (!hasPlistLike) {
            unverified = true;
            continue;
          }
          failing = true;
          findings.push({
            file: hit?.file,
            line: hit?.line,
            message: `The app uses ${spec.label} but ${spec.key} is missing from Info.plist.`,
            evidence: hit?.evidence ?? `${spec.key} not found in any plist file`,
            remediation: `Add ${spec.key} to Info.plist with a specific, user-facing explanation of why the app needs ${spec.label} access.`,
          });
          continue;
        }
        for (const e of own) {
          const problem = purposeStringProblem(e.value);
          if (problem) {
            failing = true;
            findings.push({
              file: e.file,
              line: e.line,
              message: `${spec.key} ${problem}.`,
              evidence: `${spec.key} = "${e.value ?? ''}"`,
              remediation: `Write a specific purpose string (at least 15 characters) explaining why ${spec.label} access is needed and how it benefits the user.`,
            });
          }
        }
      } else if (declared.length > 0) {
        const e = declared[0];
        findings.push({
          file: e.file,
          line: e.line,
          message: `Unused permission: ${spec.key} is declared but no ${spec.label} API usage was found in Swift sources.`,
          evidence: `${spec.key} = "${e.value ?? ''}"`,
          remediation: `Remove ${spec.key} if the app does not use ${spec.label}; unnecessary permission requests can lead to rejection.`,
        });
      }
    }

    if (failing) return result(findings, true);
    if (findings.length > 0) return result(findings, false);
    if (unverified) {
      return {
        outcome: 'not_verified',
        findings: [],
        note: 'Permission APIs are used but no plist file was found in the project files; Info.plist may be generated elsewhere.',
      };
    }
    return {
      outcome: 'pass',
      findings: [],
      note: anyUsed
        ? 'All used permission APIs have non-generic purpose strings.'
        : 'No permission-protected API usage detected.',
    };
  },
};

// ---------------------------------------------------------------------------
// ASR-013 Account deletion
// ---------------------------------------------------------------------------

const ACCOUNT_CREATION =
  /\b(signUp|createUser|createAccount|registerUser|registerAccount|createUserWithEmail)\b|"(Sign Up|Create Account|Register)"/;
const ACCOUNT_DELETION = /\b(deleteAccount|removeAccount|accountDeletion)\b|delete\s+(my\s+)?account/i;

const asr013: Detector = {
  ruleId: 'ASR-013',
  run(ctx: DetectorContext): DetectorResult {
    const creation = findInSwift(ctx.files, ACCOUNT_CREATION);
    if (!creation && !ctx.capabilities.hasUserAccounts) {
      return { outcome: 'pass', findings: [], note: 'No account creation detected.' };
    }
    const deletion = findInSwift(ctx.files, ACCOUNT_DELETION);
    if (deletion) {
      return {
        outcome: 'pass',
        findings: [],
        note: `Account deletion flow found in ${deletion.file}:${deletion.line}. Server-side data deletion is not verified.`,
      };
    }
    return {
      outcome: 'fail',
      findings: [
        {
          file: creation?.file,
          line: creation?.line,
          message:
            'The app supports account creation but no in-app account deletion flow was found (deleteAccount, "Delete Account", removeAccount, accountDeletion).',
          evidence: creation?.evidence ?? 'hasUserAccounts capability is set; no deletion flow in Swift sources',
          remediation:
            'Add an in-app option to initiate account deletion (App Store Review Guideline 5.1.1(v)) and delete the associated server-side data.',
        },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// ASR-014 Sign in with Apple
// ---------------------------------------------------------------------------

const SIWA_SOURCE = /\bASAuthorizationAppleIDProvider\b|\bSignInWithAppleButton\b|\bASAuthorizationAppleIDButton\b/;

const asr014: Detector = {
  ruleId: 'ASR-014',
  run(ctx: DetectorContext): DetectorResult {
    const caps = ctx.capabilities;
    if (!caps.hasSocialLogin) {
      return { outcome: 'pass', findings: [], note: 'no third-party social login detected' };
    }
    const siwaInSource = findInSwift(ctx.files, SIWA_SOURCE);
    if (caps.hasSignInWithApple || siwaInSource) {
      return {
        outcome: 'pass',
        findings: [],
        note: 'Sign in with Apple is present alongside third-party login.',
      };
    }
    if (caps.socialProviders.length === 0) {
      return {
        outcome: 'not_verified',
        findings: [],
        note: 'Social login is flagged but no providers were identified; cannot decide whether an equivalent option is required.',
      };
    }
    const providers = caps.socialProviders;
    const provRe = new RegExp(
      providers.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'i',
    );
    const hit = findInSwift(ctx.files, provRe);
    const fallback = ctx.files.find(isSwift);
    return {
      outcome: 'warn',
      findings: [
        {
          file: hit?.file ?? fallback?.path,
          line: hit?.line ?? (fallback ? 1 : undefined),
          message: `Third-party login (${providers.join(', ')}) is used without Sign in with Apple or an equivalent privacy-focused login option.`,
          evidence: hit?.evidence ?? `socialProviders: ${providers.join(', ')}`,
          remediation:
            'Add Sign in with Apple (or another equivalent option meeting Guideline 4.8). Exceptions exist: apps exclusively using the company\'s own first-party account system, enterprise/education/business apps with existing accounts, government or citizen-ID login, and apps for a specific third-party service. If one applies, document it for App Review.',
        },
      ],
      note: 'Reported as warn because Guideline 4.8 has exceptions that cannot be decided from source.',
    };
  },
};

// ---------------------------------------------------------------------------
// ASR-011 Restore purchases
// ---------------------------------------------------------------------------

const STOREKIT_USAGE =
  /\bimport\s+StoreKit\b|\bimport\s+RevenueCat\b|\bProduct\.products\b|\bSKPaymentQueue\b|\bSKProduct\b|\bTransaction\.currentEntitlements\b|\bPurchases\.shared\b/;
const RESTORE_USAGE =
  /\brestorePurchases\b|\bAppStore\.sync\s*\(\s*\)|\brestoreCompletedTransactions\b|Restore Purchases/i;

const asr011: Detector = {
  ruleId: 'ASR-011',
  run(ctx: DetectorContext): DetectorResult {
    const usage = findInSwift(ctx.files, STOREKIT_USAGE);
    const caps = ctx.capabilities;
    const declared = caps.hasSubscriptions || caps.hasInAppPurchases;
    if (!usage && !declared) {
      return { outcome: 'pass', findings: [], note: 'No StoreKit or subscription usage detected.' };
    }
    const restore = findInSwift(ctx.files, RESTORE_USAGE);
    if (restore) {
      return {
        outcome: 'pass',
        findings: [],
        note: `Restore purchases found in ${restore.file}:${restore.line}. Reachability from the UI is not verified.`,
      };
    }
    if (!usage) {
      return {
        outcome: 'not_verified',
        findings: [],
        note: 'Purchases are declared but no StoreKit code was found in the provided sources.',
      };
    }
    return {
      outcome: 'fail',
      findings: [
        {
          file: usage.file,
          line: usage.line,
          message:
            'In-app purchases/subscriptions are used but no restore purchases mechanism was found.',
          evidence: usage.evidence,
          remediation:
            'Add a visible "Restore Purchases" action that calls AppStore.sync() (StoreKit 2) or SKPaymentQueue.default().restoreCompletedTransactions().',
        },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// String-literal scanning shared by ASR-017 and ASR-019
// ---------------------------------------------------------------------------

const UI_PREFIX =
  /\b(Text|Label|Button|Link|Section|TextField|SecureField|Toggle|Picker|navigationTitle|navigationBarTitle|alert|confirmationDialog|NavigationLink|Tab|ContentUnavailableView)\s*\(\s*(?:verbatim:\s*)?$/;

interface Literal {
  line: number;
  text: string;
  isUI: boolean;
  evidence: string;
}

function swiftLiterals(f: ProjectFile): Literal[] {
  const stripped = stripComments(f.content).split('\n');
  const original = f.content.split('\n');
  const out: Literal[] = [];
  stripped.forEach((ln, idx) => {
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ln))) {
      out.push({
        line: idx + 1,
        text: m[1],
        isUI: UI_PREFIX.test(ln.slice(0, m.index)),
        evidence: (original[idx] ?? '').trim(),
      });
    }
  });
  return out;
}

/** Text values of plist `<string>` elements or `.strings` values, with 1-based lines. */
function resourceValues(f: ProjectFile): { line: number; text: string; evidence: string }[] {
  const out: { line: number; text: string; evidence: string }[] = [];
  if (isPlist(f)) {
    const lines = f.content.split('\n');
    lines.forEach((ln, idx) => {
      const m = /<string>([\s\S]*?)<\/string>/.exec(ln);
      if (m) out.push({ line: idx + 1, text: m[1], evidence: ln.trim() });
    });
  } else if (isStrings(f)) {
    const stripped = stripComments(f.content).split('\n');
    const lines = f.content.split('\n');
    stripped.forEach((ln, idx) => {
      const m = /=\s*"((?:[^"\\]|\\.)*)"\s*;/.exec(ln);
      if (m) out.push({ line: idx + 1, text: m[1], evidence: (lines[idx] ?? '').trim() });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// ASR-017 Placeholder content
// ---------------------------------------------------------------------------

interface PlaceholderPattern {
  name: string;
  re: RegExp;
  /** severity when found inside a UI literal / elsewhere; null = ignore */
  ui: 'fail' | 'warn' | null;
  other: 'fail' | 'warn' | null;
}

const PLACEHOLDERS: PlaceholderPattern[] = [
  { name: 'Lorem ipsum', re: /lorem ipsum/i, ui: 'fail', other: 'warn' },
  { name: 'Coming soon', re: /coming soon|yakında/i, ui: 'fail', other: 'warn' },
  { name: 'placeholder text', re: /placeholder text/i, ui: 'warn', other: 'warn' },
  { name: 'TODO/FIXME', re: /\b(TODO|FIXME)\b/, ui: 'warn', other: null },
  { name: 'template greeting "Hello, world!"', re: /Hello, world!/i, ui: 'warn', other: 'warn' },
];

const asr017: Detector = {
  ruleId: 'ASR-017',
  run(ctx: DetectorContext): DetectorResult {
    const files = ctx.files.filter(
      (f) => (isSwift(f) || isPlist(f) || isStrings(f)) && !isTestPath(f.path),
    );
    if (files.length === 0) {
      return {
        outcome: 'not_verified',
        findings: [],
        note: 'No Swift, plist or strings files to scan.',
      };
    }
    const findings: DetectorFinding[] = [];
    let failing = false;
    const record = (
      path: string,
      line: number,
      text: string,
      evidence: string,
      isUI: boolean,
      plainResource: boolean,
    ): void => {
      for (const p of PLACEHOLDERS) {
        if (!p.re.test(text)) continue;
        // Resource files (plist/strings) are user-visible content: treat TODO as a warning there.
        const sev = isUI ? p.ui : plainResource && p.name === 'TODO/FIXME' ? 'warn' : p.other;
        if (!sev) continue;
        if (sev === 'fail') failing = true;
        findings.push({
          file: path,
          line,
          message: `Placeholder content (${p.name}) in ${isUI ? 'a UI string' : 'app content'}.`,
          evidence,
          remediation:
            'Replace placeholder text with final, user-ready content before submission (Guideline 2.1 App Completeness).',
        });
      }
    };
    for (const f of files) {
      if (isSwift(f)) {
        for (const lit of swiftLiterals(f)) record(f.path, lit.line, lit.text, lit.evidence, lit.isUI, false);
      } else {
        for (const v of resourceValues(f)) record(f.path, v.line, v.text, v.evidence, false, true);
      }
    }
    return result(findings, failing);
  },
};

// ---------------------------------------------------------------------------
// ASR-019 Branding consistency
// ---------------------------------------------------------------------------

const TEMPLATE_NAMES = /\b(MyApp|YourApp|Sample App|Acme)\b/;
const PLACEHOLDER_CONTACT = /example\.com|foo@bar/i;

function plistString(content: string, key: string): { value: string; line: number } | null {
  const m = new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`).exec(content);
  return m ? { value: m[1].trim(), line: lineOf(content, m.index) } : null;
}

const asr019: Detector = {
  ruleId: 'ASR-019',
  run(ctx: DetectorContext): DetectorResult {
    const relevant = ctx.files.filter(
      (f) =>
        (isSwift(f) || isPlist(f) || isXtoolYml(f) || f.path.endsWith('.pbxproj') || /(^|\/)project\.ya?ml$/.test(f.path)) &&
        !isTestPath(f.path),
    );
    if (relevant.length === 0) {
      return { outcome: 'not_verified', findings: [], note: 'No project metadata or sources to scan.' };
    }
    const findings: DetectorFinding[] = [];
    let failing = false;

    for (const f of relevant) {
      if (isXtoolYml(f)) {
        f.content.split('\n').forEach((raw, idx) => {
          const ln = raw.replace(/\s+#.*$/, '');
          if (/^\s*#/.test(raw)) return;
          const bid = /^\s*bundleID\s*:\s*['"]?([^\s'"]+)/.exec(ln);
          if (bid && /com\.example/i.test(bid[1])) {
            failing = true;
            findings.push({
              file: f.path,
              line: idx + 1,
              message: `xtool.yml bundleID uses the template identifier "${bid[1]}".`,
              evidence: raw.trim(),
              remediation: 'Set bundleID to your own reverse-DNS identifier registered in your Apple Developer account.',
            });
          } else if (TEMPLATE_NAMES.test(ln)) {
            findings.push({
              file: f.path,
              line: idx + 1,
              message: 'Leftover template name in xtool.yml.',
              evidence: raw.trim(),
              remediation: 'Replace template names (MyApp, YourApp, Sample App, Acme) with the real product name.',
            });
          }
        });
      } else if (isPlist(f)) {
        const lines = f.content.split('\n');
        lines.forEach((ln, idx) => {
          const m = /<string>([\s\S]*?)<\/string>/.exec(ln);
          if (!m) return;
          const v = m[1];
          if (/com\.example/i.test(v)) {
            findings.push({
              file: f.path,
              line: idx + 1,
              message: 'Template bundle identifier "com.example" found in plist.',
              evidence: ln.trim(),
              remediation: 'Use your own registered bundle identifier.',
            });
          } else if (TEMPLATE_NAMES.test(v)) {
            findings.push({
              file: f.path,
              line: idx + 1,
              message: 'Leftover template name in plist.',
              evidence: ln.trim(),
              remediation: 'Replace template names with the real product name.',
            });
          } else if (PLACEHOLDER_CONTACT.test(v)) {
            findings.push({
              file: f.path,
              line: idx + 1,
              message: 'Placeholder contact detail in plist.',
              evidence: ln.trim(),
              remediation: 'Use a real support/contact address or URL.',
            });
          }
        });
        const display = plistString(f.content, 'CFBundleDisplayName');
        const name = plistString(f.content, 'CFBundleName');
        if (
          display &&
          name &&
          !display.value.startsWith('$(') &&
          !name.value.startsWith('$(') &&
          display.value !== name.value
        ) {
          findings.push({
            file: f.path,
            line: display.line,
            message: `CFBundleDisplayName ("${display.value}") differs from CFBundleName ("${name.value}").`,
            evidence: `CFBundleDisplayName=${display.value}; CFBundleName=${name.value}`,
            remediation: 'Confirm the app is branded consistently; align the names or keep the difference intentional.',
          });
        }
      } else if (isSwift(f)) {
        for (const lit of swiftLiterals(f)) {
          let message: string | null = null;
          if (/com\.example/i.test(lit.text)) message = 'Template bundle identifier "com.example" in a string literal.';
          else if (TEMPLATE_NAMES.test(lit.text)) message = 'Leftover template name in a string literal.';
          else if (PLACEHOLDER_CONTACT.test(lit.text) && lit.isUI)
            message = 'Placeholder contact detail in a UI string.';
          if (message) {
            findings.push({
              file: f.path,
              line: lit.line,
              message,
              evidence: lit.evidence,
              remediation: 'Replace template branding and placeholder contacts with real values.',
            });
          }
        }
      } else {
        // project.pbxproj / project.yml
        f.content.split('\n').forEach((ln, idx) => {
          if (/com\.example/i.test(ln)) {
            findings.push({
              file: f.path,
              line: idx + 1,
              message: 'Template bundle identifier "com.example" in project file.',
              evidence: ln.trim(),
              remediation: 'Use your own registered bundle identifier.',
            });
          }
        });
      }
    }
    return result(findings, failing);
  },
};

export const asrDetectors: Detector[] = [asr011, asr013, asr014, asr015, asr017, asr019];
