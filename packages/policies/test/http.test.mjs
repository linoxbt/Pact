import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateHttpPolicy, grantInput, httpPolicyInput, pathMatches } from '../dist/index.js';

const origin = 'https://api.example.com';
const grant = grantInput.parse({ agentId:'00000000-0000-4000-8000-000000000001', name:'Example grant',
  resourceOrigins:[origin], actions:['GET'], destinationOrigins:[origin], currency:'USD',
  perActionLimitMinor:'100', aggregateLimitMinor:'1000', approvalThresholdMinor:'50',
  startsAt:'2026-09-01T00:00:00Z', expiresAt:'2026-10-31T00:00:00Z' });
const policy = httpPolicyInput.parse({ agentId: grant.agentId, name:'Example policy', rules:[
  { id:'deny_private', name:'Private route denied', effect:'deny', methods:['GET'],
    paths:['/private/*'], destinations:[origin] },
  { id:'allow_health', name:'Health read allowed', effect:'allow', methods:['GET'],
    paths:['/health'], destinations:[origin], maxRequests:2, periodSeconds:60,
    maxSpendMinor:'100', currency:'USD' },
] });
const evaluate = (changes={}) => evaluateHttpPolicy({ grant:{...grant,status:'active',principalAddress:'0x1',
  spentMinor:0n}, policy:{...policy,status:'active'}, method:'GET',path:'/health',
  destination:origin,costMinor:0n,currency:'USD',now:new Date('2026-09-30T12:00:00Z'),
  usage:()=>({count:0,spentMinor:0n}),...changes });

test('ordered policy gives exact rule and default deny trace', () => {
  assert.equal(evaluate().decision,'allowed');
  assert.equal(evaluate().matchedRule,'allow_health');
  assert.equal(evaluate({path:'/private/reports'}).matchedRule,'deny_private');
  const missing=evaluate({path:'/admin'});
  assert.equal(missing.decision,'denied');
  assert.equal(missing.matchedRule,'default');
  assert.equal(missing.trace.length,4);
  assert.equal(evaluate({method:'DELETE'}).reason,'ACTION_OR_DESTINATION_OUT_OF_BOUNDS');
});
test('rate, spend, time and approval bounds deny before execution', () => {
  assert.equal(evaluate({usage:()=>({count:2,spentMinor:0n})}).reason,'RATE_LIMIT_EXCEEDED');
  assert.equal(evaluate({costMinor:60n}).decision,'pending_approval');
  assert.equal(evaluate({costMinor:101n}).reason,'SPENDING_LIMIT_EXCEEDED');
  assert.equal(evaluate({grant:{...grant,status:'revoked',principalAddress:'0x1',spentMinor:0n}}).reason,
    'GRANT_INACTIVE_OR_OUTSIDE_WINDOW');
});
test('patterns reject traversal and encoded separators', () => {
  assert.equal(pathMatches('/v1/:id','/v1/abc'),true);
  assert.equal(pathMatches('/v1/*','/v1/abc/def'),true);
  assert.equal(pathMatches('/v1/*','/v1/%2fadmin'),false);
  assert.equal(pathMatches('/v1/*','/v1/../admin'),false);
});
