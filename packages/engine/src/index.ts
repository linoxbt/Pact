import { availableCapacity, type CapacityView, type Decision, type ExposureQuote,
  type GrantView, type TransferIntent } from '@pact/schemas';

/** Pure preview only. PactAccount and CommitmentLedger remain the enforcement boundary. */
export function quoteTransfer(intent: TransferIntent): ExposureQuote {
  if (intent.amount <= 0n) throw new Error('amount must be positive');
  return { cashNow: intent.amount, grossLiability: intent.amount,
    requiredReservation: intent.amount, token: intent.token, adapter: 'erc20-transfer-v1' };
}

export function evaluateTransfer(
  grant: GrantView, balance: CapacityView, intent: TransferIntent, nowSeconds: bigint,
): Decision {
  const deny = (reason: Decision['reason']): Decision => ({ result: 'DENY', reason });
  if (intent.amount <= 0n || intent.grantId !== grant.id || intent.agent.toLowerCase() !== grant.agent.toLowerCase() ||
      intent.policyHash.toLowerCase() !== grant.policyHash.toLowerCase()) return deny('INVALID_INTENT');
  if (!grant.active) return deny('INACTIVE_GRANT');
  if (intent.deadline <= nowSeconds || grant.expiresAt <= nowSeconds || intent.deadline > grant.expiresAt)
    return deny('EXPIRED');
  if (intent.token.toLowerCase() !== grant.token.toLowerCase()) return deny('TOKEN_DENIED');
  if (intent.to.toLowerCase() !== grant.recipient.toLowerCase()) return deny('RECIPIENT_DENIED');
  if (intent.amount > grant.singleLimit) return deny('LIMIT_EXCEEDED');
  if (intent.amount > availableCapacity(grant, balance)) return deny('INSUFFICIENT_CAPACITY');
  if (intent.amount > grant.approvalThreshold) return { result: 'REQUIRE_APPROVAL', reason: 'APPROVAL_REQUIRED' };
  return { result: 'ALLOW', reason: 'OK' };
}
