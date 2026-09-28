import { PrivyProvider, useLinkWithPasskey, usePrivy, useWallets } from '@privy-io/react-auth';
import { defineChain } from 'viem';
import { App, type WalletAdapter } from './main.js';

const appId = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;
const monadTestnet = defineChain({ id: 10143, name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadVision', url: 'https://testnet.monadvision.com' } },
  testnet: true });

function WalletConsole() {
  const { ready, authenticated, user, login, connectWallet, logout } = usePrivy();
  const { linkWithPasskey } = useLinkWithPasskey();
  const { wallets, ready: walletsReady } = useWallets();
  const walletAdapter: WalletAdapter = { ready, authenticated, walletsReady, wallets,
    login: () => login(), connectWallet: () => connectWallet(),
    logout: () => logout(),
    hasPasskey: user?.linkedAccounts.some(account => account.type === 'passkey') ?? false,
    createPasskey: () => linkWithPasskey({ name: 'Pact Console' }) };
  return <App walletAdapter={walletAdapter}/>;
}

export default function PrivyConsole() {
  if (!appId) return <App/>;
  return <PrivyProvider appId={appId} config={{ loginMethods: ['email', 'wallet', 'passkey'],
    supportedChains: [monadTestnet], defaultChain: monadTestnet,
    appearance: { theme: 'light', accentColor: '#245342', showWalletLoginFirst: false, walletChainType: 'ethereum-only' } }}><WalletConsole/></PrivyProvider>;
}
