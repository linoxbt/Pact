import { isAddress, isHex, type Address, type Hex } from 'viem';
import { z } from 'zod';

export const address = z.string().refine(isAddress, 'EVM address required').transform(value => value as Address);
export const hex = z.string().refine(isHex, 'hex value required').transform(value => value as Hex);
export const bytes32 = hex.refine(value => value.length === 66, 'bytes32 required');
export const uint = z.string().regex(/^(0|[1-9]\d*)$/).transform(BigInt);
export const id = uint.refine(value => value > 0n);

export const transferIntent = z.object({
  grantId: id, agent: address, token: address, to: address,
  amount: id, nonce: uint, deadline: id, policyHash: bytes32,
}).strict();

export const obligationTerms = z.object({
  grantId: id, reservationId: id, provider: address, verifier: address,
  arbitrator: address, token: address, amount: id, deliverBy: id,
  verifyBy: id, challengePeriod: id, specificationHash: bytes32,
}).strict();

export const operationKey = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);
