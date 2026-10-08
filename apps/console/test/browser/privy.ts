// Test-only identity adapter. Not imported by the production application.
import {useSyncExternalStore} from 'react';
let did='did:privy:browser-one';
const subscribers=new Set<()=>void>();
export function switchTestUser(){did='did:privy:browser-two';for(const callback of subscribers)callback();}
export async function getAccessToken(){return `test.${btoa(JSON.stringify({sub:did}))}.test`;}
export function usePrivy(){const id=useSyncExternalStore(callback=>{subscribers.add(callback);return()=>subscribers.delete(callback);},()=>did);
  return {ready:true,authenticated:true,user:{id},login(){},logout:async()=>switchTestUser()};}
export function useWallets(){return {wallets:[]};}
export function useConnectWallet(){return {connectWallet(){}};}
export function useLinkWithPasskey(){return {linkWithPasskey:async()=>{if((window as unknown as {testPasskeyReject?:boolean}).testPasskeyReject)throw new Error('Device cancelled');}};}
