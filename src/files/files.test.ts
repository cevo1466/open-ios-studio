import { describe, expect, it } from 'vitest';
import type { Entry } from '../ipc';
import { classifyPath, isNotTextError } from './kind';
import { partitionEntries, sortRoot } from './explorerFilter';

const e = (name: string, isDir = false): Entry => ({ name, path: name, isDir }) as Entry;

describe('classifyPath', () => {
  it('treats .app packages and anything inside them as a bundle', () => {
    expect(classifyPath('xtool/Demo.app')).toBe('bundle');
    expect(classifyPath('xtool/Demo.app/Info.plist')).toBe('bundle');
    expect(classifyPath('x/Demo.framework')).toBe('bundle');
  });
  it('classifies binaries and images, leaves source as text', () => {
    expect(classifyPath('out/Demo.ipa')).toBe('binary');
    expect(classifyPath('a/libx.dylib')).toBe('binary');
    expect(classifyPath('Assets/icon.png')).toBe('image');
    expect(classifyPath('Sources/Demo/ContentView.swift')).toBe('text');
    expect(classifyPath('Package.swift')).toBe('text');
    expect(classifyPath('xtool.yml')).toBe('text');
  });
  it('recognises the Rust not-UTF-8 error', () => {
    expect(isNotTextError('file is not valid UTF-8 text')).toBe(true);
    expect(isNotTextError('permission denied')).toBe(false);
  });
});

describe('partitionEntries', () => {
  const root = [e('Sources', true), e('.build', true), e('xtool', true), e('Package.swift'), e('.git', true), e('xtool.yml')];
  it('moves build artifacts and hidden noise out of the main list at the root', () => {
    const p = partitionEntries(root, true);
    expect(p.primary.map((x) => x.name)).toEqual(['Sources', 'Package.swift', 'xtool.yml']);
    expect(p.artifacts.map((x) => x.name)).toEqual(['.build', 'xtool']);
    expect(p.hidden.map((x) => x.name)).toEqual(['.git']);
  });
  it('only drops hidden noise below the root', () => {
    const p = partitionEntries([e('build', true), e('.DS_Store')], false);
    expect(p.primary.map((x) => x.name)).toEqual(['build']);
    expect(p.hidden.map((x) => x.name)).toEqual(['.DS_Store']);
  });
  it('pins project files first', () => {
    expect(sortRoot([e('README.md'), e('Sources', true), e('Package.swift')]).map((x) => x.name)).toEqual(['Package.swift', 'Sources', 'README.md']);
  });
});
