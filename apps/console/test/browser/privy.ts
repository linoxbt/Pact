// Test-only identity adapter. Not imported by the production application.
import {useSyncExternalStore} from 'react';
import type {ReactNode} from 'react';
let did='did:privy:browser-one';
const subscribers=new Set<()=>void>();
export function switchTestUser(){did='did:privy:browser-two';for(const callback of subscribers)callback();}
export async function getAccessToken(){return `test.${btoa(JSON.stringify({sub:did}))}.test`;}
export function PrivyProvider({children}:{children:ReactNode}){return children;}
export function usePrivy(){const id=useSyncExternalStore(callback=>{subscribers.add(callback);return()=>subscribers.delete(callback);},()=>did);
  return {ready:true,authenticated:true,user:{id,linkedAccounts:[]},login(){},connectWallet(){},logout:async()=>switchTestUser()};}
export function useWallets(){const testWindow=window as unknown as {testFeeWallet?:string;testFeeTransactions?:number};
  return {wallets:testWindow.testFeeWallet?[{address:testWindow.testFeeWallet,walletClientType:'privy',switchChain:async()=>{},getEthereumProvider:async()=>({request:async()=>{testWindow.testFeeTransactions=(testWindow.testFeeTransactions??0)+1;return '0x'+Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');}})}]:[]};}
export function useConnectWallet(){return {connectWallet(){}};}
export function useLinkWithPasskey(){return {linkWithPasskey:async()=>{if((window as unknown as {testPasskeyReject?:boolean}).testPasskeyReject)throw new Error('Device cancelled');}};}
