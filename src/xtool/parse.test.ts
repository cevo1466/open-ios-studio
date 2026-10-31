import { describe, expect, it } from 'vitest';
import {
  buildOutcome,
  compatibility,
  parseDiagnostics,
  parseSwiftVersion,
  parseXtoolVersion,
  redactLine,
  TESTED_XTOOL_RANGE,
  validateProjectName,
} from './parse';

const SHA = 'bec5aa106ac31ce9ae49aaef93dfeabf0a097e35';

describe('parseXtoolVersion', () => {
  it('parses plain semver', () => {
    expect(parseXtoolVersion('xtool 1.24.0')).toMatchObject({ kind: 'semver', value: '1.24.0' });
  });
  it('parses v-prefixed semver with trailing newline', () => {
    expect(parseXtoolVersion('xtool v1.25.1\n')).toMatchObject({ kind: 'semver', value: '1.25.1' });
  });
  it('parses commit builds', () => {
    expect(parseXtoolVersion(`xtool commit ${SHA}`)).toMatchObject({ kind: 'commit', value: SHA });
  });
  it('handles CRLF and banner lines', () => {
    const r = parseXtoolVersion(`Welcome\r\nxtool 1.24.3 extra\r\n`);
    expect(r).toMatchObject({ kind: 'semver', value: '1.24.3' });
  });
  it('returns unknown for garbage and empty', () => {
    expect(parseXtoolVersion('command not found')).toMatchObject({ kind: 'unknown', value: null });
    expect(parseXtoolVersion('')).toMatchObject({ kind: 'unknown', value: null });
    expect(parseXtoolVersion('xtool commit abc')).toMatchObject({ kind: 'unknown' });
  });
});

describe('compatibility', () => {
  it('classifies versions', () => {
    expect(TESTED_XTOOL_RANGE).toEqual({ major: 1, minor: 24 });
    expect(compatibility(parseXtoolVersion('xtool 1.24.0'))).toBe('tested');
    expect(compatibility(parseXtoolVersion('xtool 1.24.9'))).toBe('tested');
    expect(compatibility(parseXtoolVersion('xtool v1.25.1'))).toBe('untested');
    expect(compatibility(parseXtoolVersion('xtool 2.24.0'))).toBe('untested');
    expect(compatibility(parseXtoolVersion(`xtool commit ${SHA}`))).toBe('untested');
    expect(compatibility(parseXtoolVersion('nope'))).toBe('unknown');
  });
});

describe('parseSwiftVersion', () => {
  it('parses Linux release output', () => {
    const out =
      'Swift version 6.2 (swift-6.2-RELEASE)\nTarget: x86_64-unknown-linux-gnu\n';
    expect(parseSwiftVersion(out)).toBe('6.2');
  });
  it('parses three-part and swiftlang output', () => {
    expect(
      parseSwiftVersion('swift-driver version: 1.120 Apple Swift version 6.2.1 (swiftlang-6.2.1.4.8)'),
    ).toBe('6.2.1');
  });
  it('returns null otherwise', () => {
    expect(parseSwiftVersion('')).toBeNull();
    expect(parseSwiftVersion('bash: swift: not found')).toBeNull();
  });
});

describe('parseDiagnostics', () => {
  it('parses file diagnostics and strips ANSI', () => {
    const lines = [
      '\u001b[1m/work/App/Sources/App/ContentView.swift:12:34: \u001b[31merror: \u001b[0m\u001b[1mcannot find \'x\' in scope\u001b[0m',
      'Sources/App/A.swift:3:1: warning: unused variable',
      'Sources/App/A.swift:4:2: note: did you mean y?',
    ];
    const d = parseDiagnostics(lines);
    expect(d).toHaveLength(3);
    expect(d[0]).toMatchObject({
      file: '/work/App/Sources/App/ContentView.swift',
      line: 12,
      column: 34,
      severity: 'error',
      message: "cannot find 'x' in scope",
    });
    expect(d[0]?.raw).not.toContain('\u001b');
    expect(d[1]).toMatchObject({ severity: 'warning', file: 'Sources/App/A.swift' });
    expect(d[2]?.severity).toBe('note');
  });
  it('parses file-less errors and ignores other lines', () => {
    const d = parseDiagnostics([
      'Compiling App',
      '\u001b[31merror: fatalError\u001b[0m',
      '    let x = 1',
      '    ^',
    ]);
    expect(d).toEqual([
      {
        file: null,
        line: null,
        column: null,
        severity: 'error',
        message: 'fatalError',
        raw: 'error: fatalError',
      },
    ]);
  });
});

describe('validateProjectName', () => {
  it('accepts valid names', () => {
    expect(validateProjectName('My-App_2')).toEqual({ ok: true });
    expect(validateProjectName('_x')).toEqual({ ok: true });
  });
  it.each(['2app', '-x', 'a b', '', 'ünï'])('rejects %j', (n) => {
    const r = validateProjectName(n);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });
});

describe('redactLine', () => {
  it('masks passwords', () => {
    expect(redactLine('xtool auth --password hunter2 --x')).toBe('xtool auth --password *** --x');
    expect(redactLine('tool -p hunter2')).toBe('tool -p ***');
    expect(redactLine('tool --password=hunter2')).toBe('tool --password=***');
    expect(redactLine('hunter2')).toBe('hunter2');
  });
  it('masks tokens and bearer', () => {
    const t = 'ghp_' + 'a'.repeat(36);
    expect(redactLine(`token ${t} end`)).toBe('token *** end');
    expect(redactLine('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer ***');
  });
  it('masks username emails and private keys', () => {
    expect(redactLine('login --username me@icloud.com ok')).toBe('login --username *** ok');
    expect(redactLine('-----BEGIN RSA PRIVATE KEY-----')).toBe('***');
    expect(redactLine('-----BEGIN PRIVATE KEY-----')).toBe('***');
  });
  it('leaves normal text', () => {
    expect(redactLine('Compiling App')).toBe('Compiling App');
  });
});

describe('buildOutcome', () => {
  const diags = parseDiagnostics(['a.swift:1:1: error: e', 'a.swift:2:1: warning: w', 'warning: w2']);
  it('exit 0 succeeds with warnings', () => {
    expect(buildOutcome({ code: 0, cancelled: false, timedOut: false }, diags)).toEqual({
      status: 'succeeded',
      errorCount: 1,
      warningCount: 2,
    });
  });
  it('precedence', () => {
    expect(buildOutcome({ code: 0, cancelled: true, timedOut: true }, []).status).toBe('succeeded');
    expect(buildOutcome({ code: null, cancelled: true, timedOut: true }, []).status).toBe('cancelled');
    expect(buildOutcome({ code: null, cancelled: false, timedOut: true }, []).status).toBe('timed_out');
    expect(buildOutcome({ code: null, cancelled: false, timedOut: false }, []).status).toBe('failed');
    expect(buildOutcome({ code: 2, cancelled: false, timedOut: false }, []).status).toBe('failed');
  });
});
