import { getAccessToken, PrivyProvider, useLinkWithPasskey, usePrivy, useWallets } from '@privy-io/react-auth';
import { request } from './api.js';
import { defineChain } from 'viem';
import { App, type WalletAdapter } from './main.js';
import { ControlConsole } from './ControlConsole.js';

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
    createPasskey: () => linkWithPasskey({ name: 'Pact Console' }),
    getPrincipal:async()=>{
      const token=await getAccessToken();if(!token) throw Error('Sign in to use your Pact account');
      const account=await request('/v2/account',token);
      if(account.verificationStatus!=='verified') throw Error('Enable Monad signing from the Account page first.');
      return account.principalAddress as string;
    } };
  return window.location.pathname.startsWith('/legacy') ? <App key={user?.id ?? 'signed-out'} walletAdapter={walletAdapter}/> :
    <ControlConsole key={user?.id ?? 'signed-out'}/>;
}

export default function PrivyConsole() {
  if (!appId) return <p role="alert">Pact sign in is unavailable: VITE_PRIVY_APP_ID is missing.</p>;
  return <PrivyProvider appId={appId} config={{ loginMethods: ['email', 'wallet', 'passkey'],
    supportedChains: [monadTestnet], defaultChain: monadTestnet,
    embeddedWallets: { ethereum: { createOnLogin: 'all-users' } },
    appearance: { theme: 'light', accentColor: '#245342', showWalletLoginFirst: false, walletChainType: 'ethereum-only' } }}><WalletConsole/></PrivyProvider>;
}
