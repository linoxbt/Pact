import { z } from 'zod';

export const httpMethod = z.enum(['GET','POST','PUT','PATCH','DELETE']);
const origin = z.url().refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' &&
    (url.protocol === 'https:' || url.protocol === 'http:');
}, 'Use an origin such as https://api.example.com').transform(value => new URL(value).origin);
const decimal = z.string().regex(/^(0|[1-9]\d*)$/).refine(value => BigInt(value) <= 10n ** 36n);
const path = z.string().min(1).max(240).regex(/^\/(?:[A-Za-z0-9._~/:*-]|%[0-9A-Fa-f]{2})*$/)
  .refine(value => !value.includes('..') && !/%2f|%5c|%2e/i.test(value));
export const grantInput = z.object({
  agentId: z.uuid(), name: z.string().trim().min(2).max(100),
  resourceOrigins: z.array(origin).min(1).max(20),
  actions: z.array(httpMethod).min(1).max(5),
  destinationOrigins: z.array(origin).min(1).max(20),
  allowedRecipients: z.array(z.string().min(1).max(240)).max(100).default([]),
  currency: z.string().regex(/^[A-Z]{3,12}$/),
  perActionLimitMinor: decimal, aggregateLimitMinor: decimal,
  approvalThresholdMinor: decimal,
  startsAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((value, ctx) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.startsAt))
    ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Expiry must follow start' });
  if (BigInt(value.perActionLimitMinor) > BigInt(value.aggregateLimitMinor))
    ctx.addIssue({ code: 'custom', path: ['perActionLimitMinor'], message: 'Per action exceeds aggregate' });
});
export type GrantInput = z.infer<typeof grantInput>;
export const policyRule = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,50}$/),
  name: z.string().trim().min(2).max(100),
  effect: z.enum(['allow','deny','approval']),
  methods: z.array(httpMethod).min(1).max(5),
  paths: z.array(path).min(1).max(50),
  destinations: z.array(origin).min(1).max(20),
  maxRequests: z.number().int().min(1).max(100_000).optional(),
  periodSeconds: z.number().int().min(60).max(86_400).optional(),
  maxSpendMinor: decimal.optional(),
  currency: z.string().regex(/^[A-Z]{3,12}$/).optional(),
  windowUtc: z.object({ startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.maxRequests) !== Boolean(value.periodSeconds))
    ctx.addIssue({ code: 'custom', message: 'Rate limit needs count and period' });
  if (value.windowUtc && value.windowUtc.endHour <= value.windowUtc.startHour)
    ctx.addIssue({ code: 'custom', message: 'Time window end must follow start' });
  if (value.maxSpendMinor && !value.currency)
    ctx.addIssue({ code: 'custom', message: 'Spending limit needs a currency' });
});
export const httpPolicyInput = z.object({ agentId: z.uuid(), name: z.string().trim().min(2).max(100),
  rules: z.array(policyRule).min(1).max(50) }).strict().superRefine((value, ctx) => {
  if (new Set(value.rules.map(rule => rule.id)).size !== value.rules.length)
    ctx.addIssue({ code: 'custom', path: ['rules'], message: 'Rule IDs must be unique' });
});
export type HttpPolicyRule = z.infer<typeof policyRule>;
export type HttpPolicyInput = z.infer<typeof httpPolicyInput>;
export const endpointPath = path;
export const upstreamOrigin = origin;

const fieldPath = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){0,5}$/)
  .refine(value=>!value.split('.').some(part=>['__proto__','prototype','constructor'].includes(part)));
export const economicConstraints = z.object({amountPath:fieldPath,currencyPath:fieldPath,recipientPath:fieldPath}).strict();
export function requestEconomics(spec: z.infer<typeof economicConstraints> | null, body: unknown,
  declaredMinor: string, declaredCurrency: string, recipients: string[]) {
  if (!spec) return {costMinor:BigInt(declaredMinor),currency:declaredCurrency,reason:null};
  const field = (path:string):unknown => path.split('.').reduce<unknown>((value,key)=>
    value && typeof value==='object' && !Array.isArray(value) && Object.hasOwn(value,key)
      ? (value as Record<string,unknown>)[key] : undefined,body);
  const amount=field(spec.amountPath),currency=field(spec.currencyPath),recipient=field(spec.recipientPath);
  if (typeof amount!=='string' || !decimal.safeParse(amount).success)
    return {costMinor:0n,currency:declaredCurrency,reason:'INVALID_REQUEST_AMOUNT_MINOR'};
  if (typeof currency!=='string' || currency!==declaredCurrency)
    return {costMinor:0n,currency:declaredCurrency,reason:'REQUEST_CURRENCY_DENIED'};
  if (typeof recipient!=='string' || !recipients.includes(recipient))
    return {costMinor:0n,currency:declaredCurrency,reason:'REQUEST_RECIPIENT_DENIED'};
  return {costMinor:BigInt(amount),currency,reason:null};
}

export function pathMatches(pattern: string, candidate: string): boolean {
  const route = candidate.split('?')[0];
  if (!route || !route.startsWith('/') || route.includes('..') || /%2f|%5c|%2e/i.test(route)) return false;
  const parts = pattern.split('/');
  const actual = route.split('/');
  if (parts.at(-1) === '*') {
    if (actual.length < parts.length - 1) return false;
  } else if (parts.length !== actual.length) return false;
  return parts.every((part, index) => part === '*' && index === parts.length - 1 ? true :
    part.startsWith(':') ? Boolean(actual[index]) && /^[A-Za-z0-9._~-]+$/.test(actual[index]!) :
      part === actual[index]);
}

export type DecisionTrace = { ruleId: string; name: string; result: 'skip'|'allow'|'deny'|'approval';
  reason: string };
export type HttpDecision = { decision: 'allowed'|'denied'|'pending_approval'; reason: string;
  matchedRule: string | null; trace: DecisionTrace[] };
type Usage = { count: number; spentMinor: bigint };
export function evaluateHttpPolicy(input: {
  grant: GrantInput & { status: string; principalAddress: string; spentMinor: bigint };
  policy: HttpPolicyInput & { status: string };
  method: string; path: string; destination: string; costMinor: bigint; currency: string;
  now: Date; usage: (rule: HttpPolicyRule) => Usage;
}): HttpDecision {
  const { grant, policy, method, path, costMinor, currency, now } = input;
  const destination = new URL(input.destination).origin;
  const trace: DecisionTrace[] = [];
  const stop = (ruleId: string, name: string, reason: string): HttpDecision => {
    trace.push({ ruleId, name, result: 'deny', reason });
    return { decision: 'denied', reason, matchedRule: ruleId, trace };
  };
  if (grant.status !== 'active' || now < new Date(grant.startsAt) || now >= new Date(grant.expiresAt))
    return stop('grant', 'Grant bounds', 'GRANT_INACTIVE_OR_OUTSIDE_WINDOW');
  if (!grant.actions.includes(method as never) || !grant.resourceOrigins.includes(destination) ||
      !grant.destinationOrigins.includes(destination))
    return stop('grant', 'Grant bounds', 'ACTION_OR_DESTINATION_OUT_OF_BOUNDS');
  if (currency !== grant.currency || costMinor > BigInt(grant.perActionLimitMinor) ||
      grant.spentMinor + costMinor > BigInt(grant.aggregateLimitMinor))
    return stop('grant', 'Grant bounds', 'SPENDING_LIMIT_EXCEEDED');
  trace.push({ ruleId: 'grant', name: 'Grant bounds', result: 'allow', reason: 'WITHIN_GRANT_BOUNDS' });
  if (policy.status !== 'active') return stop('policy', 'Policy status', 'POLICY_DISABLED');
  for (const rule of policy.rules) {
    if (!rule.methods.includes(method as never) || !rule.paths.some(pattern => pathMatches(pattern, path)) ||
        !rule.destinations.includes(destination)) {
      trace.push({ ruleId: rule.id, name: rule.name, result: 'skip', reason: 'RULE_DID_NOT_MATCH' });
      continue;
    }
    if (rule.windowUtc && (now.getUTCHours() < rule.windowUtc.startHour ||
        now.getUTCHours() >= rule.windowUtc.endHour))
      return stop(rule.id, rule.name, 'OUTSIDE_TIME_WINDOW');
    const usage = input.usage(rule);
    if (rule.maxRequests && usage.count >= rule.maxRequests)
      return stop(rule.id, rule.name, 'RATE_LIMIT_EXCEEDED');
    if (rule.maxSpendMinor && (rule.currency !== currency ||
        usage.spentMinor + costMinor > BigInt(rule.maxSpendMinor)))
      return stop(rule.id, rule.name, 'POLICY_SPENDING_LIMIT_EXCEEDED');
    const approval = rule.effect === 'approval' ||
      (costMinor > 0n && costMinor > BigInt(grant.approvalThresholdMinor));
    const decision = rule.effect === 'deny' ? 'denied' : approval ? 'pending_approval' : 'allowed';
    const reason = rule.effect === 'deny' ? 'RULE_DENIED' : approval ? 'APPROVAL_REQUIRED' : 'RULE_ALLOWED';
    trace.push({ ruleId: rule.id, name: rule.name,
      result: rule.effect === 'deny' ? 'deny' : approval ? 'approval' : 'allow', reason });
    return { decision, reason, matchedRule: rule.id, trace };
  }
  return stop('default', 'Default deny', 'NO_POLICY_RULE_MATCHED');
}
