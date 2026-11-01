/**
 * Additional source-level detectors: ASR-005, 008, 009, 016, 023 and MSEC-017, 018.
 * Static heuristics over `ctx.files` only. They return `pass` only when the check ran and found
 * nothing wrong in source; they never claim that a server, App Store Connect or the running app
 * is compliant. Where source cannot decide they return `not_verified`.
 */
import type { Detector, DetectorContext, DetectorFinding, DetectorResult, ProjectFile } from '../types';
import { stripComments } from './asr';

const isSwift = (f: ProjectFile): boolean => f.path.endsWith('.swift');
const isStrings = (f: ProjectFile): boolean => f.path.endsWith('.strings');
const isPlist = (f: ProjectFile): boolean => f.path.endsWith('.plist');
const isTestPath = (p: string): boolean =>
  /(^|\/)(Tests?|UITests?|[A-Za-z0-9_]+Tests)\//.test(p) || /(Tests?|UITests?)\.swift$/.test(p);

const appSwift = (ctx: DetectorContext): ProjectFile[] => ctx.files.filter((f) => isSwift(f) && !isTestPath(f.path));
/** User-visible text sources: Swift (comments stripped) and .strings tables. */
const textSources = (ctx: DetectorContext): ProjectFile[] =>
  ctx.files
    .filter((f) => (isSwift(f) && !isTestPath(f.path)) || isStrings(f))
    .map((f) => (isSwift(f) ? { path: f.path, content: stripComments(f.content) } : f));

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === '\n') line++;
  return line;
}

function firstHit(files: ProjectFile[], re: RegExp): { file: string; line: number; evidence: string } | null {
  const rx = new RegExp(re.source, re.flags.replace('g', ''));
  for (const f of files) {
    const m = rx.exec(f.content);
    if (m) {
      const line = lineOf(f.content, m.index);
      return { file: f.path, line, evidence: (f.content.split('\n')[line - 1] ?? '').trim().slice(0, 200) };
    }
  }
  return null;
}

const noSources = (): DetectorResult => ({
  outcome: 'not_verified',
  findings: [],
  note: 'No Swift sources or string tables to scan.',
});

// ---------------------------------------------------------------------------
// ASR-005 Privacy policy (in-app link only; the App Store Connect URL stays manual)
// ---------------------------------------------------------------------------
const asr005: Detector = {
  ruleId: 'ASR-005',
  run(ctx) {
    const src = textSources(ctx);
    if (src.length === 0) return noSources();
    const hit = firstHit(src, /privacy[\s_-]*policy|datenschutz|gizlilik\s+politikas/i);
    if (hit) {
      return {
        outcome: 'pass',
        findings: [],
        note: `A privacy policy reference exists in the app (${hit.file}:${hit.line}). The URL in App Store Connect and its content are not checked.`,
      };
    }
    return {
      outcome: 'warn',
      findings: [
        {
          message: 'No in-app reference to a privacy policy was found in the sources.',
          evidence: `${src.length} source/string files scanned`,
          remediation: 'Add a reachable privacy policy link inside the app (for example in Settings) and in App Store Connect.',
        },
      ],
      note: 'Whether the App Store Connect URL is set and reachable cannot be checked here.',
    };
  },
};

// ---------------------------------------------------------------------------
// ASR-008 Subscription disclosure (wording presence on the paywall side)
// ---------------------------------------------------------------------------
const asr008: Detector = {
  ruleId: 'ASR-008',
  run(ctx) {
    const src = textSources(ctx);
    if (src.length === 0) return noSources();
    const renewal = firstHit(src, /auto[\s-]*renew|renews?\s+(automatically|every|monthly|yearly|annually)|will\s+renew|otomatik\s+yenile/i);
    const cancel = firstHit(src, /cancel(l?ation)?\b|iptal/i);
    const findings: DetectorFinding[] = [];
    if (!renewal) {
      findings.push({
        message: 'No auto-renewal wording was found in the app text.',
        evidence: `${src.length} source/string files scanned`,
        remediation: 'State price, billing period and that the subscription renews automatically before the purchase button.',
      });
    }
    if (!cancel) {
      findings.push({
        message: 'No wording about how to cancel was found in the app text.',
        evidence: `${src.length} source/string files scanned`,
        remediation: 'Explain how to cancel (Settings > Apple ID > Subscriptions) near the purchase button.',
      });
    }
    return {
      outcome: findings.length > 0 ? 'warn' : 'pass',
      findings,
      note: 'Only wording presence is checked, not whether it is shown clearly before purchase.',
    };
  },
};

// ---------------------------------------------------------------------------
// ASR-009 Terms of Use / EULA link
// ---------------------------------------------------------------------------
const asr009: Detector = {
  ruleId: 'ASR-009',
  run(ctx) {
    const src = textSources(ctx);
    if (src.length === 0) return noSources();
    const hit = firstHit(
      src,
      /terms\s+(of\s+use|of\s+service|and\s+conditions|&\s+conditions)|\beula\b|stdeula|kullan[ıi]m\s+ko[sş]ullar/i,
    );
    if (hit) {
      return {
        outcome: 'pass',
        findings: [],
        note: `A Terms of Use / EULA reference exists (${hit.file}:${hit.line}). The App Store Connect EULA field is not checked.`,
      };
    }
    return {
      outcome: 'warn',
      findings: [
        {
          message: 'No Terms of Use / EULA reference was found in the app text of a subscription app.',
          evidence: `${src.length} source/string files scanned`,
          remediation: 'Link the Terms of Use (or the standard Apple EULA) in the paywall and in App Store Connect.',
        },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// ASR-016 App Tracking Transparency
// ---------------------------------------------------------------------------
const asr016: Detector = {
  ruleId: 'ASR-016',
  run(ctx) {
    const swift = appSwift(ctx).map((f) => ({ path: f.path, content: stripComments(f.content) }));
    const plists = ctx.files.filter(isPlist);
    if (swift.length === 0 && plists.length === 0) return noSources();
    const request = firstHit(swift, /requestTrackingAuthorization/);
    const idUse = firstHit(swift, /ASIdentifierManager|advertisingIdentifier|\bAdSupport\b/);
    const hasKey = plists.some((p) => /NSUserTrackingUsageDescription/.test(p.content));
    const findings: DetectorFinding[] = [];
    let failing = false;
    if (idUse && !request) {
      failing = true;
      findings.push({
        file: idUse.file,
        line: idUse.line,
        message: 'The advertising identifier is used but ATTrackingManager.requestTrackingAuthorization is never called.',
        evidence: idUse.evidence,
        remediation: 'Request tracking authorization before reading the identifier, or remove the tracking code.',
      });
    }
    if (request && !hasKey) {
      failing = true;
      findings.push({
        file: request.file,
        line: request.line,
        message: 'The ATT prompt is requested but NSUserTrackingUsageDescription is missing from every Info.plist.',
        evidence: request.evidence,
        remediation: 'Add NSUserTrackingUsageDescription with a clear, honest purpose string.',
      });
    }
    return {
      outcome: failing ? 'fail' : 'pass',
      findings,
      note: 'Third-party SDK tracking and privacy nutrition labels are not analysed.',
    };
  },
};

// ---------------------------------------------------------------------------
// ASR-023 Minimum functionality (web-view-only pattern)
// ---------------------------------------------------------------------------
const asr023: Detector = {
  ruleId: 'ASR-023',
  run(ctx) {
    const swift = appSwift(ctx).map((f) => ({ path: f.path, content: stripComments(f.content) }));
    if (swift.length === 0) return noSources();
    const web = firstHit(swift, /WKWebView|\bWebView\b|SFSafariViewController/);
    if (!web) {
      return {
        outcome: 'not_verified',
        findings: [],
        note: 'No web view found, but minimum functionality still needs a human review of the running app.',
      };
    }
    const views = swift.reduce((n, f) => n + (f.content.match(/\bstruct\s+\w+\s*:\s*[^{\n]*\bView\b/g)?.length ?? 0), 0);
    if (views <= 2) {
      return {
        outcome: 'warn',
        findings: [
          {
            file: web.file,
            line: web.line,
            message: `The app uses a web view and defines only ${views} SwiftUI view(s); it may be a repackaged website.`,
            evidence: web.evidence,
            remediation: 'Add native functionality and value beyond a website wrapper.',
          },
        ],
      };
    }
    return {
      outcome: 'not_verified',
      findings: [],
      note: 'A web view exists alongside other views; whether the app offers enough native value needs human review.',
    };
  },
};

// ---------------------------------------------------------------------------
// MSEC-017 Backup / file protection
// ---------------------------------------------------------------------------
const msec017: Detector = {
  ruleId: 'MSEC-017',
  run(ctx) {
    const swift = appSwift(ctx).map((f) => ({ path: f.path, content: stripComments(f.content) }));
    if (swift.length === 0) return noSources();
    const write = firstHit(swift, /\.write\(\s*to:|createFile\(\s*atPath|FileManager[\s\S]{0,200}?\.(documentDirectory|applicationSupportDirectory)/);
    if (!write) {
      return { outcome: 'pass', findings: [], note: 'No file writes to app storage were found in source.' };
    }
    const hasBackupOrProtection = firstHit(swift, /isExcludedFromBackup|\.completeFileProtection|FileProtectionType|NSFileProtectionKey/);
    if (!hasBackupOrProtection) {
      return {
        outcome: 'warn',
        findings: [
          {
            file: write.file,
            line: write.line,
            message: 'The app writes files but never sets a backup exclusion or a data protection class.',
            evidence: write.evidence,
            remediation: 'Exclude sensitive files with isExcludedFromBackup and use .completeFileProtection where appropriate.',
          },
        ],
        note: 'Which files hold sensitive data is not determined.',
      };
    }
    return {
      outcome: 'pass',
      findings: [],
      note: 'Backup exclusion or data protection flags exist. Whether they cover every sensitive file is not verified.',
    };
  },
};

// ---------------------------------------------------------------------------
// MSEC-018 Deep link validation
// ---------------------------------------------------------------------------
const HANDLER = /\.onOpenURL\b|\.onContinueUserActivity\b|func\s+application\s*\([^)]*open\s+url|openURLContexts/g;
const VALIDATION = /URLComponents|\.host\b|\.scheme\b|\.pathComponents|allowed|whitelist|allowlist|guard\s|switch\s+\w*(url|link|path)/i;

const msec018: Detector = {
  ruleId: 'MSEC-018',
  run(ctx) {
    const swift = appSwift(ctx).map((f) => ({ path: f.path, content: stripComments(f.content) }));
    if (swift.length === 0) return noSources();
    const findings: DetectorFinding[] = [];
    let handlers = 0;
    for (const f of swift) {
      const lines = f.content.split('\n');
      lines.forEach((ln, i) => {
        HANDLER.lastIndex = 0;
        if (!HANDLER.test(ln)) return;
        handlers++;
        const window = lines.slice(i, i + 30).join('\n');
        if (!VALIDATION.test(window)) {
          findings.push({
            file: f.path,
            line: i + 1,
            message: 'Deep link handler without visible validation of scheme, host or path.',
            evidence: ln.trim().slice(0, 200),
            remediation: 'Parse with URLComponents, check scheme/host against an allow-list, validate parameters and require authentication for sensitive actions.',
          });
        }
      });
    }
    if (handlers === 0) {
      return {
        outcome: 'not_verified',
        findings: [],
        note: 'Deep links are declared but no handler was found in source; review the handler manually.',
      };
    }
    return {
      outcome: findings.length > 0 ? 'warn' : 'pass',
      findings,
      note: 'Heuristic: validation keywords near the handler were found; correctness of the validation is not verified.',
    };
  },
};

export const extraDetectors: Detector[] = [asr005, asr008, asr009, asr016, asr023, msec017, msec018];
