import { type Address, type Hex, type PublicClient } from 'viem';
import { AuthorityRegistryAbi as registryAbi, CommitmentLedgerAbi as ledgerAbi,
  PactAccountAbi as accountAbi, ObligationManagerAbi as managerAbi } from '@pact/abis';
import { evaluateTransfer, quoteTransfer } from '@pact/engine';
import { hashObligationTerms, hashTransferIntent, obligationTermsTypes, pactDomain,
  transferApprovalTypes, type CapacityView, type GrantView, type ObligationTerms,
  type TransferIntent } from '@pact/schemas';
import { verifyObligationReservation, verifyReceiptAnchor, verifyTransferReservation } from '@pact/proofs';
export { PactHttpClient } from './http.js';
export { PactControlClient } from './control.js';

export type PactAddresses = Readonly<{
  registry: Address;
  ledger: Address;
  account: Address;
  manager: Address;
  receipts: Address;
}>;

/** Read, quote and prepare exact contract calls. The caller's wallet remains the signer. */
export class PactClient {
  constructor(readonly rpc: PublicClient, readonly addresses: PactAddresses) {}

  forAccount(account: Address): PactClient {
    return new PactClient(this.rpc, { ...this.addresses, account });
  }

  async forGrant(grantId: bigint): Promise<PactClient> {
    const grant = await this.grant(grantId);
    return this.forAccount(grant.account);
  }

  async grant(id: bigint): Promise<GrantView> {
    const [g, active] = await Promise.all([
      this.rpc.readContract({ address: this.addresses.registry, abi: registryAbi,
        functionName: 'getGrant', args: [id] }),
      this.rpc.readContract({ address: this.addresses.registry, abi: registryAbi,
        functionName: 'isActive', args: [id] }),
    ]);
    return { id, principal: g.principal, agent: g.agent, account: g.account, token: g.token,
      recipient: g.recipient, parentId: g.parentId, ceiling: g.ceiling, singleLimit: g.singleLimit,
      approvalThreshold: g.approvalThreshold, expiresAt: g.expiresAt, policyHash: g.policyHash, active };
  }

  async capacity(id: bigint): Promise<CapacityView> {
    const [allocated, reserved, committed, spent] = await this.rpc.readContract({
      address: this.addresses.ledger, abi: ledgerAbi, functionName: 'balances', args: [id],
    });
    return { allocated, reserved, committed, spent };
  }

  async previewTransfer(intent: TransferIntent) {
    const [grant, capacity, block] = await Promise.all([
      this.grant(intent.grantId), this.capacity(intent.grantId), this.rpc.getBlock(),
    ]);
    return { quote: quoteTransfer(intent), decision: evaluateTransfer(grant, capacity, intent, block.timestamp) };
  }

  async prepareReserveTransfer(intent: TransferIntent, reservationExpiry: bigint) {
    const hash = hashTransferIntent(await this.rpc.getChainId(), this.addresses.account, intent);
    return { address: this.addresses.ledger, abi: ledgerAbi, functionName: 'reserve' as const,
      args: [intent.grantId, hash, intent.amount, reservationExpiry] as const };
  }

  prepareExecuteTransfer(intent: TransferIntent, reservationId: bigint, approval: Hex = '0x') {
    return { address: this.addresses.account, abi: accountAbi, functionName: 'executeTransfer' as const,
      args: [intent, reservationId, approval] as const };
  }

  async simulateExecuteTransfer(intent: TransferIntent, reservationId: bigint, approval: Hex = '0x') {
    const blockNumber = await this.rpc.getBlockNumber();
    const call = this.prepareExecuteTransfer(intent,reservationId,approval);
    await this.rpc.simulateContract({...call,account:intent.agent,blockNumber});
    return {success:true as const,blockNumber,account:this.addresses.account};
  }

  async transferApprovalPayload(intent: TransferIntent, reservationId: bigint) {
    const chainId = await this.rpc.getChainId();
    return { domain: pactDomain(chainId, this.addresses.account), types: transferApprovalTypes,
      primaryType: 'TransferApproval' as const,
      message: { intentHash: hashTransferIntent(chainId, this.addresses.account, intent),
        reservationId, deadline: intent.deadline } };
  }

  async prepareReserveObligation(terms: ObligationTerms, reservationExpiry: bigint) {
    const digest = hashObligationTerms(await this.rpc.getChainId(), this.addresses.manager, terms);
    return { address: this.addresses.ledger, abi: ledgerAbi, functionName: 'reserveLiabilityAt' as const,
      args: [terms.grantId, terms.reservationId, digest, terms.amount, reservationExpiry] as const };
  }

  async obligationSignaturePayload(terms: ObligationTerms) {
    return { domain: pactDomain(await this.rpc.getChainId(), this.addresses.manager, 'PactObligation'),
      types: obligationTermsTypes, primaryType: 'ObligationTerms' as const, message: terms };
  }

  prepareCreateObligation(terms: ObligationTerms, principalSignature: Hex, providerSignature: Hex) {
    return { address: this.addresses.manager, abi: managerAbi, functionName: 'create' as const,
      args: [terms, principalSignature, providerSignature] as const };
  }

  verifyTransfer(intent: TransferIntent, reservationId: bigint, approval?: Hex) {
    return verifyTransferReservation(this.rpc, this.addresses, intent, reservationId, approval);
  }

  verifyObligation(terms: ObligationTerms) {
    return verifyObligationReservation(this.rpc, this.addresses, terms);
  }

  verifyReceipt(id: bigint, disclosure?: { termsDigest: Hex; evidenceHash: Hex; verdictHash: Hex; paid: boolean }) {
    return verifyReceiptAnchor(this.rpc, this.addresses.receipts, id, disclosure);
  }
}
