// Preserve the existing testnet command; the network cannot be overridden accidentally.
process.env.PACT_DEPLOY_NETWORK = 'testnet';
await import('./deploy-monad.mjs');
