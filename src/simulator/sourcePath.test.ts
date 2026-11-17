import { describe, expect, it } from 'vitest';
import { sourcePath } from './sourcePath';
describe('simulator diagnostic paths', () => {
  it('maps Windows compiler drive, case, separators and canonical prefix to the editor', () => {
    expect(sourcePath('\\\\?\\C:\\Users\\Ada\\Demo', 'c:\\users\\ada\\demo\\Sources\\Counter.swift')).toBe('Sources/Counter.swift');
    expect(sourcePath('C:\\Work\\Demo', 'C:/Work/Demo/Counter.swift')).toBe('Counter.swift');
    expect(sourcePath('\\\\?\\UNC\\host\\share\\Demo', '\\\\host\\share\\Demo\\Counter.swift')).toBe('Counter.swift');
    expect(sourcePath('C:\\Work\\Demo', 'C:/Work/Demo-other/Counter.swift')).toBe('C:/Work/Demo-other/Counter.swift');
  });
  it('preserves POSIX case and workspace boundaries', () => {
    expect(sourcePath('/work/demo', '/work/demo/Counter.swift')).toBe('Counter.swift');
    expect(sourcePath('/work/demo', '/Work/demo/Counter.swift')).toBe('/Work/demo/Counter.swift');
    expect(sourcePath('/work/demo', null)).toBeNull();
  });
});
