/** Disclosure is explicit and owner-only; common secrets and personal fields remain redacted. */
export function redactApprovalIntent(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[DEPTH_LIMIT]';
  if (Array.isArray(value)) return value.map(child => redactApprovalIntent(child, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, /password|secret|token|authorization|cookie|api.?key|email|phone|ssn|birth|card.number/i.test(key)
      ? '[REDACTED]' : redactApprovalIntent(child, depth + 1)]));
  return value;
}
