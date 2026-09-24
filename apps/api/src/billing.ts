import type { FastifyInstance } from 'fastify';
import { decodeEventLog, erc20Abi, isAddress, isHex, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { AuthError, jsonSafe } from '@pact/operations';
import type { ApiContext } from './server.js';

export type BillingConfig = Readonly<{ token: Address; treasury: Address;
  prices: Record<string, { input: number; output: number }> }>;
export const priceFor = (config: BillingConfig | undefined, provider: string, model: string) =>
  config?.prices[`${provider}:${model}`];

export function loadBillingConfig(env: NodeJS.ProcessEnv): BillingConfig | undefined {
  if (!env.PACT_BILLING_TOKEN || !env.PACT_BILLING_TREASURY || !env.PACT_MODEL_PRICES_JSON)
    return undefined;
  if (env.PACT_ENVIRONMENT === 'production') throw new Error('Pact-funded billing is testnet-only until audit');
  if (!isAddress(env.PACT_BILLING_TOKEN) || !isAddress(env.PACT_BILLING_TREASURY))
    throw new Error('Invalid billing addresses');
  const parsed = z.record(z.string(), z.object({ input: z.number().int().positive(),
    output: z.number().int().positive() }).strict()).parse(JSON.parse(env.PACT_MODEL_PRICES_JSON));
  return { token: env.PACT_BILLING_TOKEN, treasury: env.PACT_BILLING_TREASURY, prices: parsed };
}

export function registerBillingRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/v1/billing/config', async () => ctx.billing ? {
    enabled: true, chainId: ctx.auth.config.chainId, token: ctx.billing.token,
    treasury: ctx.billing.treasury, markupBps: 2000, tokenDecimals: 6,
    note: 'Unaudited testnet credit. No production custody or cash redemption.' } :
    { enabled: false });
  app.get('/v1/billing/balance', async request => {
    const session = await ctx.auth.authenticate(request.headers.authorization);
    if (session.kind !== 'principal') throw new AuthError('PRINCIPAL_ONLY', 403);
    const row = await ctx.database.query<{ balance_micro: string }>(
      'SELECT balance_micro FROM pact_billing_accounts WHERE principal=$1',
      [session.principal.toLowerCase()]);
    return { balanceMicro: row.rows[0]?.balance_micro ?? '0', tokenDecimals: 6 };
  });
  app.post('/v1/billing/deposits', async request => {
    if (!ctx.billing) throw new AuthError('TESTNET_BILLING_UNAVAILABLE', 503);
    const session = await ctx.auth.authenticate(request.headers.authorization);
    if (session.kind !== 'principal') throw new AuthError('PRINCIPAL_ONLY', 403);
    const input = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).strict()
      .parse(request.body);
    if (!isHex(input.txHash)) throw new AuthError('INVALID_TX_HASH', 400);
    const receipt = await ctx.rpc.getTransactionReceipt({ hash: input.txHash as Hex });
    const head = await ctx.rpc.getBlockNumber();
    const finality = BigInt(Math.max(5, ctx.auth.config.finalityBlocks));
    if (receipt.status !== 'success' || head < receipt.blockNumber + finality)
      throw new AuthError('DEPOSIT_NOT_FINAL', 409);
    const canonical = await ctx.rpc.getBlock({ blockNumber: receipt.blockNumber });
    if (canonical.hash !== receipt.blockHash) throw new AuthError('DEPOSIT_REORGED', 409);
    let amount = 0n;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== ctx.billing!.token.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
        if (decoded.eventName === 'Transfer' &&
            decoded.args.from.toLowerCase() === session.principal.toLowerCase() &&
            decoded.args.to.toLowerCase() === ctx.billing!.treasury.toLowerCase())
          amount += decoded.args.value;
      } catch { /* Other token events do not count. */ }
    }
    if (amount < 1n) throw new AuthError('DEPOSIT_TRANSFER_NOT_FOUND', 400);
    const client = await ctx.database.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO pact_billing_deposits (tx_hash,principal,token,amount_micro,block_number)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING tx_hash`,
        [input.txHash.toLowerCase(), session.principal.toLowerCase(),
          ctx.billing.token.toLowerCase(), amount.toString(), receipt.blockNumber.toString()]);
      if (!inserted.rowCount) throw new AuthError('DEPOSIT_ALREADY_CLAIMED', 409);
      await client.query(
        `INSERT INTO pact_billing_accounts (principal,balance_micro) VALUES ($1,$2)
         ON CONFLICT (principal) DO UPDATE SET balance_micro=
           pact_billing_accounts.balance_micro+excluded.balance_micro,updated_at=now()`,
        [session.principal.toLowerCase(), amount.toString()]);
      await client.query('COMMIT');
    } catch (cause) { await client.query('ROLLBACK'); throw cause; }
    finally { client.release(); }
    return jsonSafe({ status: 'credited', amountMicro: amount, txHash: input.txHash });
  });
}
