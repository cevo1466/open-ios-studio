/**
 * Static source detectors for the Mobile Security catalog (MSEC-012 .. MSEC-026).
 * Conservative by design: `not_verified` over guessing, `pass` only when the check really ran.
 * Evidence never contains a full secret (first 4 characters + an ellipsis).
 */
import type { Detector, DetectorContext, DetectorFinding, DetectorResult, ProjectFile } from '../types.js';

type Level = 'fail' | 'warn';
interface Hit extends DetectorFinding {
  level: Level;
}

const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|icns|pdf|zip|gz|tgz|ipa|apk|aab|jar|class|so|dylib|a|o|woff2?|ttf|otf|mp[34]|mov|car|nib|p12|pfx|der)$/i;
const LOCK_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Package\.resolved|Cargo\.lock|Podfile\.lock)$/;

const isText = (p: string): boolean => !BINARY_EXT.test(p);
const baseName = (p: string): string => p.split('/').pop() ?? p;
const dirName = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const ext = (p: string): string => (baseName(p).includes('.') ? baseName(p).split('.').pop()!.toLowerCase() : '');
const splitLines = (c: string): string[] => c.split(/\r?\n/);
const lineOf = (content: string, index: number): number => content.slice(0, index).split('\n').length;
const isComment = (l: string): boolean => /^\s*(\/\/|#|\*|\/\*)/.test(l);
const trunc = (s: string, n = 160): string => {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const redact = (s: string): string => (s.length <= 4 ? '…' : `${s.slice(0, 4)}…`);

function finish(hits: Hit[], passNote?: string): DetectorResult {
  const outcome: DetectorResult['outcome'] = hits.some((h) => h.level === 'fail')
    ? 'fail'
    : hits.length > 0
      ? 'warn'
      : 'pass';
  const findings: DetectorFinding[] = hits.map((h) => ({ file: h.file, line: h.line, message: h.message, evidence: h.evidence, remediation: h.remediation }));
  return { outcome, findings, ...(passNote && hits.length === 0 ? { note: passNote } : {}) };
}

/** Run `fn` on every non-comment line of every file accepted by `filter`. */
function eachLine(
  files: ProjectFile[],
  filter: (f: ProjectFile) => boolean,
  fn: (line: string, no: number, f: ProjectFile) => void,
  skipComments = true,
): void {
  for (const f of files) {
    if (!isText(f.path) || !filter(f)) continue;
    splitLines(f.content).forEach((l, i) => {
      if (skipComments && isComment(l)) return;
      fn(l, i + 1, f);
    });
  }
}

const hasExt = (...exts: string[]) => (f: ProjectFile) => exts.includes(ext(f.path));
const SWIFT_LIKE = hasExt('swift', 'm', 'mm', 'h');
const CODE_EXT = ['swift', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'kt', 'java', 'm', 'mm', 'rs', 'go'];

// ---------------------------------------------------------------- MSEC-014

const PLACEHOLDER = /your[_\-\s]|xxxx|placeholder|example|changeme|change_me|replace|dummy|sample|<[^>]+>|\$\{|\$\(|\$[A-Z_]{3,}|process\.env|ProcessInfo|getenv|\*{4}|^(.)\1+$/i;
const GENERIC_KEY = /(api[_-]?key|secret|token|password|passwd)\w*["']?\s*[:=]\s*["']([^"'\n]{16,})["']/gi;
const PLIST_KEY = /<key>[^<]*(api[_-]?key|secret|token|password)[^<]*<\/key>\s*<string>([^<]{16,})<\/string>/gi;
const SPECIFIC: Array<{ name: string; re: RegExp; mask: boolean }> = [
  { name: 'private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g, mask: false },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/g, mask: true },
  { name: 'Stripe live secret key', re: /\bsk_live_[0-9A-Za-z]{10,}/g, mask: true },
  { name: 'GitHub token', re: /\bgh[po]_[0-9A-Za-z]{20,}/g, mask: true },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, mask: true },
];
const KEY_FILE_EXT = ['swift', 'plist', 'json', 'yml', 'yaml', 'xcconfig', 'm', 'h'];

const msec014: Detector = {
  ruleId: 'MSEC-014',
  run({ files }: DetectorContext): DetectorResult {
    const hits: Hit[] = [];
    for (const f of files) {
      if (!isText(f.path) || /\/fixtures\//.test(`/${f.path}`) || /\.test\./.test(f.path) || LOCK_FILES.test(f.path)) continue;
      const seen = new Set<string>();
      const push = (line: number, name: string, evidence: string): void => {
        const k = `${line}:${name}`;
        if (seen.has(k)) return;
        seen.add(k);
        hits.push({
          level: 'fail',
          file: f.path,
          line,
          message: `Possible hard-coded secret (${name}) in source or bundle file.`,
          evidence,
          remediation:
            'Remove the secret from the repository, rotate it, and load it at runtime from the Keychain, a secrets manager or build-time CI secrets.',
        });
      };
      for (const p of SPECIFIC) {
        for (const m of f.content.matchAll(p.re)) {
          const val = m[0];
          push(lineOf(f.content, m.index ?? 0), p.name, p.mask ? `${p.name}: ${redact(val)}` : `${p.name}: ${redact(val)}`);
        }
      }
      if (KEY_FILE_EXT.includes(ext(f.path))) {
        for (const re of [GENERIC_KEY, PLIST_KEY]) {
          for (const m of f.content.matchAll(re)) {
            const value = m[2] ?? '';
            if (PLACEHOLDER.test(value) || /\s/.test(value) || !/^[A-Za-z0-9_\-+/=.:]{16,}$/.test(value)) continue;
            push(lineOf(f.content, m.index ?? 0), 'credential literal', `${m[1]} = "${redact(value)}"`);
          }
        }
      }
    }
    const res = finish(hits);
    res.note = 'Static source scan only; compiled IPA/APK binaries are not analysed here.';
    return res;
  },
};

// ---------------------------------------------------------------- MSEC-016

const TOKEN_WORD = /access_?token|refresh_?token|id_?token|auth_?token|bearer|\bjwt\b|["']token["']/i;
const LOG_SINK = /\b(print|debugPrint|dump|NSLog|os_log|console\.(log|info|debug|warn|error)|logger\.\w+|Logger\()/;
const FILE_SINK = /\.write\(\s*(to|toFile)|FileManager|writeFile(Sync)?\(|write_text\(|\.write\(contentsOf/;
const DEFAULTS_SINK = /UserDefaults|@AppStorage|localStorage|SharedPreferences|\bdefaults\.(set|setValue)\b/;
const URL_TOKEN = /[?&](access_?token|token|jwt|refresh_?token)=/i;
const KEYCHAIN = /SecItemAdd|Keychain/;

const msec016: Detector = {
  ruleId: 'MSEC-016',
  run({ files, capabilities }: DetectorContext): DetectorResult {
    const hits: Hit[] = [];
    let keychain = false;
    let tokenSeen = false;
    const add = (f: ProjectFile, no: number, sink: string, line: string): void => {
      hits.push({
        level: 'fail',
        file: f.path,
        line: no,
        message: `Authentication token handled insecurely (${sink}).`,
        evidence: trunc(line.replace(/(["'])([A-Za-z0-9_\-.]{12,})\1/g, (_m, q: string, v: string) => `${q}${redact(v)}${q}`)),
        remediation: 'Store tokens only in the Keychain (kSecAttrAccessibleWhenUnlockedThisDeviceOnly), never log them, and send them in the Authorization header instead of the URL.',
      });
    };
    eachLine(
      files,
      (f) => CODE_EXT.includes(ext(f.path)) || ['plist', 'json', 'yml', 'yaml'].includes(ext(f.path)),
      (line, no, f) => {
        if (KEYCHAIN.test(line)) keychain = true;
        if (!TOKEN_WORD.test(line) && !URL_TOKEN.test(line)) return;
        tokenSeen = true;
        if (LOG_SINK.test(line) && TOKEN_WORD.test(line)) return add(f, no, 'logged', line);
        if (DEFAULTS_SINK.test(line)) return add(f, no, 'UserDefaults/local preferences', line);
        if (FILE_SINK.test(line)) return add(f, no, 'plain file', line);
        if (URL_TOKEN.test(line) && /https?:\/\/|URL|url|\\\(|\$\{/.test(line)) return add(f, no, 'URL query string', line);
      },
    );
    if (hits.length > 0) return finish(hits);
    if (keychain) return { outcome: 'pass', findings: [], note: 'Keychain usage found and no insecure token sink detected.' };
    if (tokenSeen || capabilities.hasAuthTokens) {
      return { outcome: 'not_verified', findings: [], note: 'Token handling found but no Keychain usage could be confirmed from source.' };
    }
    return { outcome: 'pass', findings: [], note: 'No token handling found in source.' };
  },
};

// ---------------------------------------------------------------- MSEC-012

const SENSITIVE_KEY = /["']?(\w*(password|passwd|ssn|creditcard|cardnumber|secret)\w*)["']?/i;
const DEFAULTS_LINE = /UserDefaults|@AppStorage|\bdefaults\.(set|setValue|string|object)\b/;

const msec012: Detector = {
  ruleId: 'MSEC-012',
  run({ files }: DetectorContext): DetectorResult {
    const hits: Hit[] = [];
    eachLine(files, SWIFT_LIKE, (line, no, f) => {
      if (/kSecAttrAccessibleAlways(ThisDeviceOnly)?\b/.test(line)) {
        hits.push({
          level: 'fail',
          file: f.path,
          line: no,
          message: 'kSecAttrAccessibleAlways* is deprecated and leaves Keychain items readable while the device is locked.',
          evidence: trunc(line),
          remediation: 'Use kSecAttrAccessibleWhenUnlockedThisDeviceOnly or kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly.',
        });
        return;
      }
      if (!DEFAULTS_LINE.test(line)) return;
      const m = line.match(SENSITIVE_KEY);
      if (m?.[1]) {
        hits.push({
          level: 'fail',
          file: f.path,
          line: no,
          message: 'Sensitive value stored via UserDefaults/@AppStorage (unencrypted plist).',
          evidence: `UserDefaults/@AppStorage key "${m[1]}"`,
          remediation: 'Store sensitive data in the Keychain, or in a file with Data Protection (.completeFileProtection).',
        });
      }
    });
    return finish(hits, 'No sensitive keys in UserDefaults/@AppStorage and no kSecAttrAccessibleAlways* found.');
  },
};

// ---------------------------------------------------------------- MSEC-019

const TLS_FAIL: Array<{ re: RegExp; msg: string }> = [
  { re: /XTL_DISABLE_TLS_VALIDATION/, msg: 'TLS validation disabled through XTL_DISABLE_TLS_VALIDATION.' },
  { re: /NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*['"]?0/, msg: 'NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate validation.' },
  { re: /rejectUnauthorized\s*:\s*false/, msg: 'rejectUnauthorized: false disables certificate validation.' },
  { re: /\bverify\s*=\s*False\b/, msg: 'verify=False disables certificate validation.' },
  { re: /(^|\s)--insecure\b/, msg: '--insecure disables certificate validation.' },
  { re: /\bcurl\s+(?:[^|\n]*\s)?-[A-Za-z]*k[A-Za-z]*(\s|$)/, msg: 'curl -k disables certificate validation.' },
];
const LOCAL_HOST = /^http:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|10\.0\.2\.2)([:/]|$)/i;

const msec019: Detector = {
  ruleId: 'MSEC-019',
  run({ files }: DetectorContext): DetectorResult {
    const hits: Hit[] = [];
    for (const f of files) {
      if (!isText(f.path)) continue;
      const e = ext(f.path);
      // ATS
      for (const m of f.content.matchAll(/<key>(NSAllowsArbitraryLoads(?:InWebContent)?)<\/key>\s*<true\s*\/>/g)) {
        hits.push({
          level: 'fail',
          file: f.path,
          line: lineOf(f.content, m.index ?? 0),
          message: `App Transport Security is disabled (${m[1]}).`,
          evidence: `${m[1]} = true`,
          remediation: 'Remove the ATS exception or restrict it to specific domains with NSExceptionDomains.',
        });
      }
      if (e === 'swift') {
        const lines = splitLines(f.content);
        const evaluates = /SecTrustEvaluateWithError|SecTrustSetAnchorCertificates/.test(f.content);
        lines.forEach((l, i) => {
          if (isComment(l)) return;
          if (/URLCredential\(\s*trust:/.test(l) && !evaluates) {
            hits.push({
              level: 'fail',
              file: f.path,
              line: i + 1,
              message: 'URLSession delegate accepts any server trust without evaluating it.',
              evidence: trunc(l),
              remediation: 'Evaluate the trust with SecTrustEvaluateWithError, or use .performDefaultHandling.',
            });
          } else if (/^\s*(_\s*=\s*)?SecTrustEvaluate(WithError)?\(/.test(l)) {
            hits.push({
              level: 'fail',
              file: f.path,
              line: i + 1,
              message: 'Result of SecTrustEvaluate is ignored.',
              evidence: trunc(l),
              remediation: 'Check the evaluation result and cancel the challenge when it fails.',
            });
          }
          for (const m of l.matchAll(/http:\/\/[^\s"')]+/g)) {
            if (LOCAL_HOST.test(m[0]) || /^http:\/\/www\.w3\.org|^http:\/\/www\.apple\.com\/DTDs/.test(m[0])) continue;
            hits.push({
              level: 'warn',
              file: f.path,
              line: i + 1,
              message: 'Cleartext http:// URL in Swift source.',
              evidence: trunc(l),
              remediation: 'Use https:// endpoints.',
            });
          }
        });
      }
      if (e !== 'md' && e !== 'txt' && e !== 'markdown') {
        splitLines(f.content).forEach((l, i) => {
          if (isComment(l) && e !== 'sh' && e !== 'yml' && e !== 'yaml') return;
          if (/^\s*#/.test(l)) return;
          for (const t of TLS_FAIL) {
            if (t.re.test(l)) {
              hits.push({ level: 'fail', file: f.path, line: i + 1, message: t.msg, evidence: trunc(l), remediation: 'Remove the flag and fix the trust chain (install the CA) instead of disabling validation.' });
              break;
            }
          }
        });
      }
    }
    return finish(hits, 'No TLS weakening found. Certificate pinning is not required by this rule.');
  },
};

// ---------------------------------------------------------------- MSEC-021

const ENV_FILE = /^\.env(\..+)?$/;
const ENV_SAFE = /\.(example|sample|template|dist|defaults)$/i;
const KEY_NAME = /\.(p12|key)$|^id_(rsa|dsa|ecdsa|ed25519)$/i;

const msec021: Detector = {
  ruleId: 'MSEC-021',
  run({ files }: DetectorContext): DetectorResult {
    const hits: Hit[] = [];
    let gitignore: ProjectFile | undefined;
    for (const f of files) {
      const b = baseName(f.path);
      if (f.path === '.gitignore') gitignore = f;
      if (ENV_FILE.test(b) && !ENV_SAFE.test(b)) {
        hits.push({ level: 'fail', file: f.path, line: 1, message: 'Environment file committed to the project.', evidence: `${b} present in file list`, remediation: 'Remove it from version control, rotate contained secrets, add it to .gitignore and commit a .env.example instead.' });
      } else if (/\.pem$/i.test(b)) {
        const priv = /PRIVATE KEY/.test(f.content);
        const certOnly = /BEGIN CERTIFICATE/.test(f.content) && !priv;
        hits.push({ level: certOnly ? 'warn' : 'fail', file: f.path, line: 1, message: certOnly ? 'Certificate (.pem) committed; verify it is public.' : 'Private key / credential file (.pem) committed.', evidence: `${b} present in file list`, remediation: 'Keep key material out of the repository; use CI secrets or a secrets manager.' });
      } else if (KEY_NAME.test(b)) {
        hits.push({ level: 'fail', file: f.path, line: 1, message: 'Key or certificate bundle committed to the project.', evidence: `${b} present in file list`, remediation: 'Keep key material out of the repository; use CI secrets or a secrets manager.' });
      } else if (b === 'GoogleService-Info.plist') {
        hits.push({ level: 'warn', file: f.path, line: 1, message: 'GoogleService-Info.plist committed (client config, not secret, but restrict the API key in the Google console).', evidence: `${b} present in file list`, remediation: 'Restrict the Firebase API key by bundle id and enable App Check.' });
      }
    }
    if (gitignore) {
      const ok = splitLines(gitignore.content).some((l) => /^\/?(\*\*\/)?(\*)?\.env(\.\*|\*|\.local)?\/?$/.test(l.trim()));
      if (!ok) {
        hits.push({ level: 'warn', file: gitignore.path, line: 1, message: '.gitignore does not ignore .env files.', evidence: '.gitignore has no ".env" pattern', remediation: 'Add ".env" and ".env.*" (with "!.env.example") to .gitignore.' });
      }
    }
    return finish(hits, 'No committed env/key files found.');
  },
};

// ---------------------------------------------------------------- MSEC-022

function hasLock(files: ProjectFile[], manifest: string, locks: string[]): boolean {
  let dir = dirName(manifest);
  for (;;) {
    for (const l of locks) {
      const p = dir ? `${dir}/${l}` : l;
      if (files.some((f) => f.path === p)) return true;
    }
    if (!dir) return false;
    dir = dirName(dir);
  }
}

const msec022: Detector = {
  ruleId: 'MSEC-022',
  run({ files }: DetectorContext): DetectorResult {
    const hits: Hit[] = [];
    let manifests = 0;
    let locked = 0;
    for (const f of files) {
      if (/(^|\/)node_modules\//.test(f.path)) continue;
      const b = baseName(f.path);
      if (b === 'Package.swift' && /\.package\(/.test(f.content)) {
        manifests++;
        if (files.some((x) => baseName(x.path) === 'Package.resolved')) locked++;
        else hits.push({ level: 'warn', file: f.path, line: 1, message: 'Package.swift has dependencies but no Package.resolved is committed.', evidence: 'Package.resolved missing', remediation: 'Commit Package.resolved to pin transitive dependency versions.' });
      } else if (b === 'package.json') {
        let hasDeps: boolean;
        try {
          const j = JSON.parse(f.content) as Record<string, unknown>;
          hasDeps = ['dependencies', 'devDependencies', 'optionalDependencies'].some((k) => j[k] && Object.keys(j[k] as object).length > 0);
        } catch {
          hasDeps = true;
        }
        if (!hasDeps) continue;
        manifests++;
        if (hasLock(files, f.path, ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'])) locked++;
        else hits.push({ level: 'fail', file: f.path, line: 1, message: 'package.json has dependencies but no lockfile (package-lock.json, yarn.lock, pnpm-lock.yaml).', evidence: 'lockfile missing', remediation: 'Commit a lockfile and install with `npm ci`.' });
      } else if (b === 'Cargo.toml' && /\[(dev-|build-)?dependencies/.test(f.content)) {
        manifests++;
        if (hasLock(files, f.path, ['Cargo.lock'])) locked++;
        else hits.push({ level: 'warn', file: f.path, line: 1, message: 'Cargo.toml has dependencies but no Cargo.lock is committed.', evidence: 'Cargo.lock missing', remediation: 'Commit Cargo.lock for applications and binaries.' });
      }
    }
    if (manifests === 0) return { outcome: 'pass', findings: [], note: 'No dependency manifests found. Vulnerability scanning was not performed (requires network).' };
    const res = finish(hits);
    res.note =
      hits.length === 0
        ? `Lockfiles present for ${locked} manifest(s). Vulnerability scanning was not performed (requires network); exact-pin age cannot be judged from source.`
        : 'Vulnerability scanning was not performed (requires network).';
    return res;
  },
};

// ---------------------------------------------------------------- MSEC-023

function isScriptFile(f: ProjectFile): boolean {
  const b = baseName(f.path);
  return (
    ['sh', 'bash', 'zsh', 'mk'].includes(ext(f.path)) ||
    /^(Makefile|makefile|GNUmakefile)$/.test(b) ||
    /^Dockerfile/.test(b) ||
    b === 'package.json' ||
    /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path)
  );
}

const msec023: Detector = {
  ruleId: 'MSEC-023',
  run({ files }: DetectorContext): DetectorResult {
    const hits: Hit[] = [];
    eachLine(files, isScriptFile, (line, no, f) => {
      const add = (level: Level, message: string): void => {
        hits.push({ level, file: f.path, line: no, message, evidence: trunc(line), remediation: 'Download, verify (checksum/signature) and then run scripts; avoid sudo, eval and world-writable modes in build steps.' });
      };
      if (/\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/.test(line)) return add('fail', 'Remote script piped straight into a shell.');
      if (/base64\s+(-d|-D|--decode)\b[^\n]*(\|\s*(sudo\s+)?(ba|z)?sh\b|\beval\b)|\beval\b[^\n]*base64\s+(-d|-D|--decode)/.test(line)) return add('fail', 'Base64-decoded content is executed.');
      const ev = line.match(/\beval\s+["']?\$\((.*)/);
      if (ev) return add(/curl|wget|base64/.test(ev[1] ?? '') ? 'fail' : 'warn', 'eval of command substitution.');
      if (/\bchmod\s+(-R\s+)?0?777\b/.test(line)) return add('fail', 'chmod 777 makes files world-writable.');
      if (/\bnpm\s+(i|install|ci)\b[^\n]*--unsafe-perm/.test(line)) return add('warn', 'npm install with --unsafe-perm runs lifecycle scripts as root.');
      if (/(^|[\s;&|("'])sudo\s/.test(line)) return add('warn', 'sudo used in a build/install script.');
    });
    return finish(hits, 'No risky install/build script patterns found.');
  },
};

// ---------------------------------------------------------------- MSEC-024

const WORKFLOW = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/;

const msec024: Detector = {
  ruleId: 'MSEC-024',
  run({ files }: DetectorContext): DetectorResult {
    const wfs = files.filter((f) => WORKFLOW.test(f.path));
    if (wfs.length === 0) return { outcome: 'pass', findings: [], note: 'No GitHub workflows found.' };
    const hits: Hit[] = [];
    let unpinned = 0;
    for (const f of wfs) {
      const lines = splitLines(f.content);
      const body = lines.map((l, i) => ({ l, no: i + 1 })).filter((x) => !/^\s*#/.test(x.l));
      const find = (re: RegExp) => body.find((x) => re.test(x.l));
      const prt = find(/(^|[\s[,-])pull_request_target\b/);
      const head = find(/github\.event\.pull_request\.head/);
      if (prt && head) {
        hits.push({ level: 'fail', file: f.path, line: head.no, message: 'pull_request_target workflow checks out / uses untrusted PR head code with privileged token.', evidence: trunc(head.l), remediation: 'Use pull_request for untrusted code, or never check out the PR head in pull_request_target jobs.' });
      }
      const wa = find(/^\s*permissions\s*:\s*write-all\b/);
      if (wa) hits.push({ level: 'fail', file: f.path, line: wa.no, message: 'Workflow grants write-all permissions.', evidence: trunc(wa.l), remediation: 'Declare least-privilege permissions (e.g. contents: read).' });
      else {
        const top = body.some((x) => /^permissions\s*:/.test(x.l));
        if (!top) {
          const jobsIdx = body.findIndex((x) => /^jobs\s*:/.test(x.l));
          const jobs = jobsIdx < 0 ? [] : body.slice(jobsIdx + 1).filter((x) => /^ {2}[\w-]+\s*:\s*$/.test(x.l));
          const jobPerms = body.filter((x) => /^ {4}permissions\s*:/.test(x.l)).length;
          if (jobs.length === 0 || jobPerms < jobs.length) {
            hits.push({ level: 'warn', file: f.path, line: 1, message: 'Workflow has no top-level `permissions:` block (defaults may be write-all).', evidence: 'permissions: missing', remediation: 'Add `permissions: contents: read` at the top level and widen per job only when needed.' });
          }
        }
      }
      const pr = body.some((x) => !x.l.includes('${{') && /\bpull_request\b/.test(x.l));
      if (pr && !prt) {
        const sec = body.find((x) => /secrets\.(?!GITHUB_TOKEN\b)\w+/.test(x.l));
        const guarded = /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/.test(f.content);
        if (sec && !guarded && !body.some((x) => /^\s*environment\s*:/.test(x.l))) {
          hits.push({ level: 'warn', file: f.path, line: sec.no, message: 'Secrets referenced in a workflow triggered by pull_request (forks) without environment protection.', evidence: trunc(sec.l.replace(/secrets\.(\w{0,4})\w*/g, 'secrets.$1…')), remediation: 'Do not expose secrets to fork PRs; gate with an environment requiring approval.' });
        }
      }
      for (const x of body) {
        const m = x.l.match(/uses\s*:\s*([\w.-]+\/[\w./-]+)@(\S+)/);
        if (m && !/^actions\//.test(m[1]!) && !/^[0-9a-f]{40}$/.test(m[2]!)) unpinned++;
      }
    }
    const res = finish(hits);
    res.note = `${unpinned} third-party action reference(s) not pinned by commit SHA (informational, not a finding).`;
    return res;
  },
};

// ---------------------------------------------------------------- MSEC-013

const msec013: Detector = {
  ruleId: 'MSEC-013',
  run({ files, capabilities }: DetectorContext): DetectorResult {
    if (!capabilities.usesFirebase) return { outcome: 'pass', findings: [], note: 'Firebase not used' };
    if (files.some((f) => isText(f.path) && /AppCheck|FirebaseAppCheck|AppCheckProviderFactory/.test(f.content))) {
      return { outcome: 'pass', findings: [], note: 'Firebase App Check usage found.' };
    }
    let first: { f: ProjectFile; no: number; l: string } | undefined;
    eachLine(files, SWIFT_LIKE, (l, no, f) => {
      if (!first && /FirebaseApp\.configure|^\s*import\s+Firebase/.test(l)) first = { f, no, l };
    });
    if (!first) return { outcome: 'not_verified', findings: [], note: 'usesFirebase is set but no Firebase initialisation was found in Swift sources.' };
    return {
      outcome: 'warn',
      findings: [{ file: first.f.path, line: first.no, message: 'Firebase is used but Firebase App Check is not configured.', evidence: trunc(first.l), remediation: 'Add FirebaseAppCheck, set an AppCheckProviderFactory (App Attest / DeviceCheck) before FirebaseApp.configure() and enforce it in the Firebase console.' }],
    };
  },
};

// ---------------------------------------------------------------- MSEC-025

const AI_USE = /openai|anthropic|\bllm\b|\bclaude\b|chat\.completions|messages\.create|ollama|gemini|generativelanguage|systemPrompt|system_prompt/i;
const AI_TAINT_SRC = /openai|anthropic|\bllm\b|\bclaude\b|chat\.completions|messages\.create|ollama|gemini|completion|modelOutput|model_output|aiResponse|aiOutput|assistant/i;
const EXEC_SINK = /(?<![\w.])(exec|execSync|spawn|spawnSync|execFile|execFileSync|eval)\(|\bnew Function\(|(?<![\w.])Function\(|\bProcess\(\)/;
const FN_START = /\b(function\b|func\s|def\s|=>\s*\{|^\s*(async\s+)?\w+\s*\([^)]*\)\s*\{)/;
const DELIM = /untrusted|<data|<document|<file_content|delimit|sanitiz|escape/i;

function ids(s: string): string[] {
  return [...s.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]);
}

const msec025: Detector = {
  ruleId: 'MSEC-025',
  run({ files, capabilities }: DetectorContext): DetectorResult {
    const hits: Hit[] = [];
    let aiUse = capabilities.usesAI;
    for (const f of files) {
      if (!isText(f.path) || !CODE_EXT.includes(ext(f.path)) || /\.md$/i.test(f.path)) continue;
      const lines = splitLines(f.content);
      if (AI_USE.test(f.content)) aiUse = true;
      // (a) untrusted content interpolated into a system prompt
      lines.forEach((l, i) => {
        if (isComment(l) || !/system/i.test(l)) return;
        const js = /\$\{[^}]*(readme|issue|fileContent|\blogs?\b|logOutput|content|body)[^}]*\}/i.test(l);
        const sw = /\\\([^)]*(readme|fileContent|issueBody|content|\blogs?\b)[^)]*\)/i.test(l);
        if (!js && !sw) return;
        const near = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
        if (DELIM.test(near)) return;
        hits.push({ level: 'warn', file: f.path, line: i + 1, message: 'Fetched/file/log content is concatenated into a system prompt without delimiting.', evidence: trunc(l), remediation: 'Pass untrusted content as clearly delimited user-role data (e.g. <untrusted_data> blocks) and never as system instructions.' });
      });
      // (b) model output flowing into exec/eval/spawn
      lines.forEach((l, i) => {
        if (isComment(l) || !EXEC_SINK.test(l)) return;
        let s = i;
        while (s > 0 && i - s < 40 && !FN_START.test(lines[s]!)) s--;
        const win = lines.slice(s, i);
        const tainted = new Set<string>();
        for (let pass = 0; pass < 3; pass++) {
          for (const wl of win) {
            const m = wl.match(/\b(?:const|let|var|val)?\s*([A-Za-z_$][\w$]*)\s*=\s*([^=].*)$/);
            if (!m) continue;
            const rhs = m[2]!;
            if (AI_TAINT_SRC.test(rhs) || ids(rhs).some((x) => tainted.has(x))) tainted.add(m[1]!);
          }
        }
        const args = l.slice(l.search(EXEC_SINK));
        if (AI_TAINT_SRC.test(args) || ids(args).some((x) => tainted.has(x))) {
          hits.push({ level: 'fail', file: f.path, line: i + 1, message: 'Model/LLM output is passed directly into a shell/exec/eval call.', evidence: trunc(l), remediation: 'Never execute model output. Map it to an allow-listed action with validated arguments and require user approval.' });
        }
      });
    }
    if (hits.length > 0) return finish(hits);
    if (aiUse) return { outcome: 'not_verified', findings: [], note: 'AI usage detected but prompt construction and tool execution are not statically analysable beyond the heuristics.' };
    return { outcome: 'pass', findings: [], note: 'No AI usage detected.' };
  },
};

// ---------------------------------------------------------------- MSEC-026

const AGENT_FAIL: Array<{ re: RegExp; msg: string }> = [
  { re: /allowed[_-]?tools["']?\s*[:=]\s*\[\s*['"]\*['"]\s*\]/i, msg: 'Agent allowed tools use a wildcard.' },
  { re: /["']?permissions?["']?\s*[:=]\s*['"]all['"]/i, msg: 'Agent permission is set to "all".' },
  { re: /--dangerously-skip-permissions/, msg: 'Agent runs with --dangerously-skip-permissions.' },
  { re: /bypassPermissions/, msg: 'Agent permission mode bypassPermissions disables approval prompts.' },
  { re: /["']?sandbox["']?\s*[:=]\s*false\b/i, msg: 'Agent sandbox is disabled.' },
  { re: /["']?(fs|rootDir|root_dir)["']?\s*[:=]\s*['"]\/['"]/, msg: 'Agent filesystem scope is the filesystem root.' },
];
const AGENT_CFG = /allowed[_-]?tools|"permissions"\s*:|defineTool|\btools\s*:\s*\[|permissionMode/i;
const APPROVAL = /approv|confirm|requiresApproval|requireApproval|needsApproval|humanInTheLoop|dryRun/i;

const msec026: Detector = {
  ruleId: 'MSEC-026',
  run({ files }: DetectorContext): DetectorResult {
    const hits: Hit[] = [];
    let cfg = false;
    for (const f of files) {
      if (!isText(f.path) || /\.(md|markdown|txt)$/i.test(f.path)) continue;
      const e = ext(f.path);
      if (!(CODE_EXT.includes(e) || ['json', 'yml', 'yaml', 'toml', 'sh'].includes(e))) continue;
      const lines = splitLines(f.content);
      const isCfg = AGENT_CFG.test(f.content);
      if (isCfg) cfg = true;
      lines.forEach((l, i) => {
        if (isComment(l)) return;
        for (const a of AGENT_FAIL) {
          if (a.re.test(l)) {
            hits.push({ level: 'fail', file: f.path, line: i + 1, message: a.msg, evidence: trunc(l), remediation: 'Grant the agent an explicit minimal tool list and a scoped workspace root; keep approval prompts and the sandbox enabled.' });
            return;
          }
        }
        if (isCfg && e !== 'sh' && /rm\s+-rf|\bdeleteAll\w*|\bdropTable\w*/.test(l)) {
          const near = lines.slice(Math.max(0, i - 5), i + 6).join('\n');
          if (!APPROVAL.test(near)) {
            hits.push({ level: 'warn', file: f.path, line: i + 1, message: 'Destructive agent tool without an approval/confirm flag nearby.', evidence: trunc(l), remediation: 'Mark destructive tools requiresApproval: true and show a diff/confirmation before execution.' });
          }
        }
      });
    }
    if (hits.length > 0) return finish(hits);
    if (cfg) return { outcome: 'pass', findings: [], note: 'Agent configuration found with scoped permissions (no wildcard or unguarded destructive tools).' };
    return { outcome: 'not_verified', findings: [], note: 'No agent tool/permission configuration found to analyse.' };
  },
};

export const msecDetectors: Detector[] = [
  msec012,
  msec013,
  msec014,
  msec016,
  msec019,
  msec021,
  msec022,
  msec023,
  msec024,
  msec025,
  msec026,
];
