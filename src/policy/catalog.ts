import appStore from '../../policies/app-store.rules.json';
import mobileSecurity from '../../policies/mobile-security.rules.json';
import type { Rule } from './types.js';

/** Minimal validation of a catalog JSON: either an array of rules or `{ rules: [...] }`. */
export function catalogFromJson(json: unknown): Rule[] {
  const list: unknown =
    Array.isArray(json) ? json : (json as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(list)) {
    throw new Error('Invalid rule catalog: expected an array of rules or an object with a "rules" array');
  }
  list.forEach((r, i) => {
    const id = (r as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`Invalid rule catalog: entry ${i} has no string "id"`);
    }
  });
  return list as Rule[];
}

export function loadCatalogs(): Rule[] {
  return [...catalogFromJson(appStore), ...catalogFromJson(mobileSecurity)];
}
