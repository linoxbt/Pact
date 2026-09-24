import { hashTypedData, type Address, type Hex } from 'viem';

export type TransferIntent = Readonly<{
  grantId: bigint;
  agent: Address;
  token: Address;
  to: Address;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
  policyHash: Hex;
}>;

export type TransferApproval = Readonly<{
  intentHash: Hex;
  reservationId: bigint;
  deadline: bigint;
}>;

export type ObligationTerms = Readonly<{
  grantId: bigint;
  reservationId: bigint;
  provider: Address;
  verifier: Address;
  arbitrator: Address;
  token: Address;
  amount: bigint;
  deliverBy: bigint;
  verifyBy: bigint;
  challengePeriod: bigint;
  specificationHash: Hex;
}>;

export type GrantView = Readonly<{
  id: bigint;
  principal: Address;
  agent: Address;
  account: Address;
  token: Address;
  recipient: Address;
  parentId: bigint;
  ceiling: bigint;
  singleLimit: bigint;
  approvalThreshold: bigint;
  expiresAt: bigint;
  policyHash: Hex;
  active: boolean;
}>;

export type CapacityView = Readonly<{
  allocated: bigint;
  reserved: bigint;
  committed: bigint;
  spent: bigint;
}>;

export type ExposureQuote = Readonly<{
  cashNow: bigint;
  grossLiability: bigint;
  requiredReservation: bigint;
  token: Address;
  adapter: 'erc20-transfer-v1';
}>;

export type Decision = Readonly<{
  result: 'DENY' | 'REQUIRE_APPROVAL' | 'ALLOW';
  reason: 'INVALID_INTENT' | 'INACTIVE_GRANT' | 'TOKEN_DENIED' | 'RECIPIENT_DENIED' |
    'LIMIT_EXCEEDED' | 'INSUFFICIENT_CAPACITY' | 'EXPIRED' | 'APPROVAL_REQUIRED' | 'OK';
}>;

export const transferIntentTypes = {
  TransferIntent: [
    { name: 'grantId', type: 'uint256' },
    { name: 'agent', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
    { name: 'policyHash', type: 'bytes32' },
  ],
} as const;

export const transferApprovalTypes = {
  TransferApproval: [
    { name: 'intentHash', type: 'bytes32' },
    { name: 'reservationId', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const;

export const obligationTermsTypes = {
  ObligationTerms: [
    { name: 'grantId', type: 'uint256' },
    { name: 'reservationId', type: 'uint256' },
    { name: 'provider', type: 'address' },
    { name: 'verifier', type: 'address' },
    { name: 'arbitrator', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'deliverBy', type: 'uint64' },
    { name: 'verifyBy', type: 'uint64' },
    { name: 'challengePeriod', type: 'uint64' },
    { name: 'specificationHash', type: 'bytes32' },
  ],
} as const;

export function pactDomain(chainId: number, account: Address, name = 'PactAccount') {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('invalid chain ID');
  return { name, version: '1', chainId, verifyingContract: account } as const;
}

export function hashTransferIntent(chainId: number, account: Address, intent: TransferIntent): Hex {
  return hashTypedData({ domain: pactDomain(chainId, account), types: transferIntentTypes,
    primaryType: 'TransferIntent', message: intent });
}

export function hashTransferApproval(chainId: number, account: Address, approval: TransferApproval): Hex {
  return hashTypedData({ domain: pactDomain(chainId, account), types: transferApprovalTypes,
    primaryType: 'TransferApproval', message: approval });
}

export function hashObligationTerms(chainId: number, manager: Address, terms: ObligationTerms): Hex {
  return hashTypedData({ domain: pactDomain(chainId, manager, 'PactObligation'), types: obligationTermsTypes,
    primaryType: 'ObligationTerms', message: terms });
}

export function availableCapacity(grant: GrantView, balance: CapacityView): bigint {
  const used = balance.allocated + balance.reserved + balance.committed + balance.spent;
  if (used > grant.ceiling) throw new Error('capacity invariant violated');
  return grant.ceiling - used;
}

export function parseBaseUnits(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('invalid decimals');
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw new Error('invalid amount');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('too many decimal places');
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt((fraction.padEnd(decimals, '0')) || '0');
}
