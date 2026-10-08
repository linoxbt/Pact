import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
const folder=new URL('../../.secrets/live-agent/',import.meta.url);mkdirSync(folder,{recursive:true,mode:0o700});
const file=new URL('owner.key',folder);
if(!existsSync(file))writeFileSync(file,generatePrivateKey(),{mode:0o600});
const wallet=privateKeyToAccount(readFileSync(file,'utf8').trim());
const origin='https://pact-protocol-monad.alemzdelight.workers.dev';
const appId='cmujow5b401c90dlc6eho7trr';
const post=async(path,body)=>{
 const response=await fetch('https://auth.privy.io/api/v1/'+path,{method:'POST',
 headers:{'Content-Type':'application/json','privy-app-id':appId,Origin:origin},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const data=await response.json();if(!response.ok)throw Error(`Privy ${path} ${response.status}`);return data;
};
console.log('Dedicated test owner:',wallet.address);
const {nonce}=await post('siwe/init',{address:wallet.address});
const message=`${new URL(origin).host} wants you to sign in with your Ethereum account:\n${wallet.address}\n\nBy signing, you are proving you own this wallet and logging in. This does not initiate a transaction or cost any fees.\n\nURI: ${origin}\nVersion: 1\nChain ID: 10143\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}\nResources:\n- https://privy.io`;
const signature=await wallet.signMessage({message});
const result=await post('siwe/authenticate',{message,signature,chainId:'eip155:10143',walletClientType:'metamask',connectorType:'injected',mode:'login-or-sign-up'});
writeFileSync(new URL('privy-session.json',folder),JSON.stringify(result),{mode:0o600});
console.log('Authenticated Privy test identity:',result.user?.id,'tokenPresent:',Boolean(result.token));
