import { hashTypedData, keccak256, toBytes, type Address, type Hex } from 'viem';
import { z } from 'zod';

const repository = z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/);
export const gatewayPolicySchema = z.object({
  version: z.literal(1),
  provider: z.literal('github'),
  operation: z.literal('repository.read'),
  repositories: z.array(repository).min(1).max(100),
  maxRequests: z.number().int().min(1).max(100_000),
  periodSeconds: z.number().int().min(60).max(86_400),
  expiresAt: z.string().regex(/^[1-9]\d*$/),
  publicAuthority: z.boolean().optional(),
}).strict();
export type GatewayPolicy = z.infer<typeof gatewayPolicySchema>;

export function canonicalGatewayPolicy(input: unknown): GatewayPolicy {
  const value = gatewayPolicySchema.parse(input);
  return { ...value, repositories: [...new Set(value.repositories.map(item => item.toLowerCase()))].sort() };
}

export function hashGatewayPolicy(input: unknown): Hex {
  return keccak256(toBytes(JSON.stringify(canonicalGatewayPolicy(input))));
}

export const policyApprovalTypes = {
  PolicyApproval: [
    { name: 'grantId', type: 'uint256' },
    { name: 'policyHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const;

export function policyApprovalPayload(chainId: number, registry: Address, grantId: bigint,
  policyHash: Hex, deadline: bigint) {
  return { domain: { name: 'PactPolicy', version: '1', chainId, verifyingContract: registry },
    types: policyApprovalTypes, primaryType: 'PolicyApproval' as const,
    message: { grantId, policyHash, deadline } };
}

export function hashPolicyApproval(chainId: number, registry: Address, grantId: bigint,
  policyHash: Hex, deadline: bigint): Hex {
  return hashTypedData(policyApprovalPayload(chainId, registry, grantId, policyHash, deadline));
}
