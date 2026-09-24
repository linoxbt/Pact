import { encodeAbiParameters, keccak256, parseAbi, recoverAddress, type Address, type Hex, type PublicClient } from 'viem';
import { AuthorityRegistryAbi as registryAbi, CommitmentLedgerAbi as ledgerAbi,
  PactAccountAbi as accountAbi, ObligationManagerAbi as managerAbi,
  ReceiptRegistryAbi as receiptsAbi } from '@pact/abis';
import { hashObligationTerms, hashTransferApproval, hashTransferIntent,
  type ObligationTerms, type TransferIntent } from '@pact/schemas';

const signerAbi = parseAbi(['function isValidSignature(bytes32, bytes) view returns (bytes4)']);

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export type Verification = Readonly<{ valid: boolean; reason: string }>;
const valid = (): Verification => ({ valid: true, reason: 'OK' });
const invalid = (reason: string): Verification => ({ valid: false, reason });

/** Checks live onchain capacity evidence without contacting a Pact service. */
export async function verifyTransferReservation(
  client: PublicClient,
  addresses: { registry: Address; ledger: Address; account: Address },
  intent: TransferIntent,
  reservationId: bigint,
  approval?: Hex,
): Promise<Verification> {
  const chainId = await client.getChainId();
  const block = await client.getBlock();
  const [configuredRegistry, accountRegistry, accountLedger, accountPrincipal, active, grant, reservation] =
    await Promise.all([
      client.readContract({ address: addresses.ledger, abi: ledgerAbi, functionName: 'registry' }),
      client.readContract({ address: addresses.account, abi: accountAbi, functionName: 'registry' }),
      client.readContract({ address: addresses.account, abi: accountAbi, functionName: 'ledger' }),
      client.readContract({ address: addresses.account, abi: accountAbi, functionName: 'principal' }),
      client.readContract({ address: addresses.registry, abi: registryAbi, functionName: 'isActive', args: [intent.grantId] }),
      client.readContract({ address: addresses.registry, abi: registryAbi, functionName: 'getGrant', args: [intent.grantId] }),
      client.readContract({ address: addresses.ledger, abi: ledgerAbi, functionName: 'reservations', args: [reservationId] }),
    ]);
  const [reservedGrantId, reservedHash, reservedAmount, reservedExpiry, consumed, liability] = reservation;
  if (!eq(configuredRegistry, addresses.registry) || !eq(accountRegistry, addresses.registry) ||
      !eq(accountLedger, addresses.ledger)) return invalid('CONTRACT_LINK_MISMATCH');
  if (!active || !eq(grant.principal, accountPrincipal) || !eq(grant.account, addresses.account) ||
      !eq(grant.agent, intent.agent) || !eq(grant.token, intent.token) || !eq(grant.recipient, intent.to) ||
      !eq(grant.policyHash, intent.policyHash)) return invalid('GRANT_MISMATCH');
  if (intent.amount === 0n || intent.amount > grant.singleLimit || intent.deadline <= block.timestamp ||
      intent.deadline > grant.expiresAt) return invalid('ACTION_OUT_OF_BOUNDS');
  if (reservedGrantId !== intent.grantId || consumed || liability ||
      reservedAmount !== intent.amount || reservedExpiry <= block.timestamp ||
      !eq(reservedHash, hashTransferIntent(chainId, addresses.account, intent)))
    return invalid('RESERVATION_MISMATCH');
  if (intent.amount > grant.approvalThreshold) {
    if (!approval) return invalid('APPROVAL_REQUIRED');
    const digest = hashTransferApproval(chainId, addresses.account,
      { intentHash: reservedHash, reservationId, deadline: intent.deadline });
    let approved = false;
    try { approved = eq(await recoverAddress({ hash: digest, signature: approval }), grant.principal); }
    catch { /* May be an ERC-1271 signature. */ }
    if (!approved) {
      try {
        const magic = await client.readContract({ address: grant.principal, abi: signerAbi,
          functionName: 'isValidSignature', args: [digest, approval] });
        approved = magic === '0x1626ba7e';
      } catch { return invalid('INVALID_APPROVAL'); }
    }
    if (!approved) return invalid('INVALID_APPROVAL');
  }
  return valid();
}

/** Checks a liability reservation and the exact proposed terms before both parties accept. */
export async function verifyObligationReservation(
  client: PublicClient,
  addresses: { registry: Address; ledger: Address; manager: Address },
  terms: ObligationTerms,
): Promise<Verification> {
  const chainId = await client.getChainId();
  const block = await client.getBlock();
  const [managerRegistry, managerLedger, configuredRegistry, active, grant, reservation] = await Promise.all([
    client.readContract({ address: addresses.manager, abi: managerAbi, functionName: 'registry' }),
    client.readContract({ address: addresses.manager, abi: managerAbi, functionName: 'ledger' }),
    client.readContract({ address: addresses.ledger, abi: ledgerAbi, functionName: 'registry' }),
    client.readContract({ address: addresses.registry, abi: registryAbi, functionName: 'isActive', args: [terms.grantId] }),
    client.readContract({ address: addresses.registry, abi: registryAbi, functionName: 'getGrant', args: [terms.grantId] }),
    client.readContract({ address: addresses.ledger, abi: ledgerAbi, functionName: 'reservations', args: [terms.reservationId] }),
  ]);
  const [reservedGrantId, reservedHash, reservedAmount, reservedExpiry, consumed, liability] = reservation;
  if (!eq(managerRegistry, addresses.registry) || !eq(managerLedger, addresses.ledger) ||
      !eq(configuredRegistry, addresses.registry))
    return invalid('CONTRACT_LINK_MISMATCH');
  if (!active || !eq(grant.token, terms.token) || !eq(grant.recipient, terms.provider))
    return invalid('GRANT_MISMATCH');
  if (terms.amount <= 0n || terms.deliverBy <= block.timestamp || terms.deliverBy > grant.expiresAt ||
      terms.verifyBy <= terms.deliverBy || terms.verifyBy > terms.deliverBy + 2_592_000n ||
      terms.challengePeriod <= 0n || terms.challengePeriod > 2_592_000n ||
      terms.specificationHash === `0x${'00'.repeat(32)}` ||
      eq(terms.provider, grant.principal) || eq(terms.verifier, grant.principal) ||
      eq(terms.arbitrator, grant.principal) || eq(terms.verifier, terms.provider) ||
      eq(terms.arbitrator, terms.provider) || eq(terms.arbitrator, terms.verifier))
    return invalid('TERMS_OUT_OF_BOUNDS');
  if (reservedGrantId !== terms.grantId || !liability || consumed ||
      reservedAmount !== terms.amount || reservedExpiry <= block.timestamp ||
      !eq(reservedHash, hashObligationTerms(chainId, addresses.manager, terms)))
    return invalid('RESERVATION_MISMATCH');
  return valid();
}

/** Verifies the onchain receipt anchor. Evidence truth remains dependent on its named verifier. */
export async function verifyReceiptAnchor(
  client: PublicClient, registry: Address, obligationId: bigint,
  disclosure?: { termsDigest: Hex; evidenceHash: Hex; verdictHash: Hex; paid: boolean },
): Promise<Verification> {
  const receipt = await client.readContract({ address: registry, abi: receiptsAbi,
    functionName: 'getReceipt', args: [obligationId] });
  if (receipt.root === `0x${'00'.repeat(32)}`) return invalid('RECEIPT_NOT_FINAL');
  const chainId = await client.getChainId();
  const expected = keccak256(encodeAbiParameters([
    { type: 'uint256' }, { type: 'address' }, { type: 'uint256' },
    { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bool' },
  ], [BigInt(chainId), registry, obligationId, receipt.termsDigest, receipt.evidenceHash,
    receipt.verdictHash, receipt.paid]));
  if (!eq(expected, receipt.root)) return invalid('INVALID_RECEIPT_ROOT');
  if (disclosure && (!eq(disclosure.termsDigest, receipt.termsDigest) ||
      !eq(disclosure.evidenceHash, receipt.evidenceHash) ||
      !eq(disclosure.verdictHash, receipt.verdictHash) || disclosure.paid !== receipt.paid))
    return invalid('DISCLOSURE_MISMATCH');
  return valid();
}
