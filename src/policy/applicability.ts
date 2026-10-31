import type { Applicability, Capabilities, CapabilityKey, Rule } from './types.js';

function has(caps: Capabilities, key: CapabilityKey): boolean {
  return caps[key] === true;
}

/** Decide whether a rule applies to a project with the given capabilities. */
export function isApplicable(rule: Rule, caps: Capabilities): boolean {
  const a: Applicability = rule.applicability;
  if ('always' in a && a.always === true) return true;
  const { all, any, none } = a as { all?: CapabilityKey[]; any?: CapabilityKey[]; none?: CapabilityKey[] };
  if (all && all.length > 0 && !all.every((k) => has(caps, k))) return false;
  if (any && any.length > 0 && !any.some((k) => has(caps, k))) return false;
  if (none && none.length > 0 && none.some((k) => has(caps, k))) return false;
  return true;
}
