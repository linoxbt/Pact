import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';
import { defineChain } from 'viem';
import { App, type WalletAdapter } from './main.js';

const appId = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;
const monadTestnet = defineChain({ id: 10143, name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadVision', url: 'https://testnet.monadvision.com' } },
  testnet: true });

function WalletConsole() {
  const { ready, authenticated, login, connectWallet, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const walletAdapter: WalletAdapter = { ready, authenticated, walletsReady, wallets,
    login: () => login(), connectWallet: () => connectWallet(),
    logout: () => logout() };
  return <App walletAdapter={walletAdapter}/>;
}

export default function PrivyConsole() {
  if (!appId) return <App/>;
  return <PrivyProvider appId={appId} config={{ loginMethods: ['wallet'],
    supportedChains: [monadTestnet], defaultChain: monadTestnet,
    appearance: { theme: 'dark', accentColor: '#b8f2d1' } }}><WalletConsole/></PrivyProvider>;
}
