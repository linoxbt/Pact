# Monad mainnet release

## Per-user ownership

Mainnet deployment creates six protocol contracts, including `PactAccountFactory`. It creates **no shared PactAccount and assigns no global user principal**. Its manifest has `principal: null`, `accountMode: per_user_factory`, and a zero-address legacy account sentinel. The sentinel is not a signing account or recipient.

Users sign in through Privy, use their unique account identifier for HTTP grants, and prove control of their embedded or external wallet before enabling onchain signing. Each signing wallet deploys its own account through the factory. Existing grants preserve their original principal and require explicit migration/reissuance. Testnet manifests describe historical contracts, not default principals for new users.

## Network and simulation

Official reference: [Monad network information](https://docs.monad.xyz/developer-essentials/network-information).
Mainnet chain ID is `143`; public RPC is `https://rpc.monad.xyz`.

The factory-only deployment was simulated successfully against mainnet on 8 October 2026. Observed estimate: 7,762,177 gas at 202 gwei, approximately 1.567959754 MON. Gas prices and actual usage can change. This was a simulation, not a deployment. No mainnet contract address is claimed until its runtime and links are verified.

```sh
# Simulates without broadcast or a principal wallet.
forge script packages/contracts/script/DeployFactory.s.sol:DeployFactory \
  --root packages/contracts --rpc-url https://rpc.monad.xyz \
  --sender YOUR_DEPLOYER_ADDRESS

# Requires a funded deployer and explicit spending cap.
PACT_RPC_URL=https://rpc.monad.xyz \
PACT_BROADCAST_MAINNET=yes \
PACT_MAX_DEPLOYMENT_COST_MON=2.5 \
node scripts/deploy-monad-mainnet.mjs --broadcast

PACT_RPC_URL=https://rpc.monad.xyz node scripts/verify-contract-release.mjs deployments/monad-mainnet.json
```

The deployer key is read from a protected local file (`PACT_DEPLOYER_KEY_FILE`). It never enters the frontend. Deployment checkpoints persist signed transactions before broadcast so interrupted runs resume the same transaction. Run only one deployment process for a given deployer/checkpoint. The accumulated transaction costs and next maximum fee must fit the explicit cap.

## Service activation

Do not mix testnet and mainnet onchain projections/operations in the same database. Keep the existing testnet release available until the mainnet database/configuration is prepared and verified. The current Free deployment remains testnet; no automatic paid resources are created.

Mainnet service variables must use the verified mainnet manifest: `PACT_CHAIN_ID=143`, mainnet RPC, all protocol addresses, `PACT_ACCOUNT_FACTORY`, `PACT_ACCOUNT=0x0000000000000000000000000000000000000000`, and the mainnet start block. Use a separate database/environment. Build Console with `VITE_PACT_CHAIN_ID=143` and its matching API/gateway origins. Privy supports both Monad networks; all onchain signatures are scoped to the selected chain/account. Keep testnet-funded credit disabled on mainnet.

Production activation still requires configured KMS/encrypted evidence/IAM, verified database TLS, a real backup/evidence restore drill, and hosted sign-in/signing/recovery validation. A successful chain deployment does not satisfy those gates.

## Live verification

Console Overview → **Test enforcement** → **Run live enforcement check** uses the signed-in user's real authorization. It provisions a temporary zero-spend HTTP grant, ordered policy, scoped keys and encrypted upstream secret. It checks allow/deny, upstream counters, approval, rotation, grant revocation, key revocation, sensitive field redaction and activity request IDs. The agent is disabled and keys/secrets removed afterward. Requests are harmless test operations; records remain in audit history.

This checks HTTP enforcement. It is not a language-model run or an onchain receipt. A real model-backed run requires a dedicated provider key stored through Pact's credential flow; Codex session credentials are not exportable API keys. Hosted Privy verification requires the user to sign in; local browser tests replace only identity for repeatability.
