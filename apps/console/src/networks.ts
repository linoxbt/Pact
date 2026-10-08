import { defineChain } from 'viem';

export const monadMainnet = defineChain({id:143,name:'Monad Mainnet',
  nativeCurrency:{name:'Monad',symbol:'MON',decimals:18},
  rpcUrls:{default:{http:['https://rpc.monad.xyz']}},
  blockExplorers:{default:{name:'MonadVision',url:'https://monadvision.com'}}});
export const monadTestnet = defineChain({id:10143,name:'Monad Testnet',
  nativeCurrency:{name:'Monad',symbol:'MON',decimals:18},
  rpcUrls:{default:{http:['https://testnet-rpc.monad.xyz']}},
  blockExplorers:{default:{name:'MonadVision',url:'https://testnet.monadvision.com'}},testnet:true});
const configuredId=Number(import.meta.env.VITE_PACT_CHAIN_ID ?? 10143);
if(configuredId!==143 && configuredId!==10143) throw Error('Unsupported VITE_PACT_CHAIN_ID');
export const activeNetwork=configuredId===143?monadMainnet:monadTestnet;
export const networkNotice=configuredId===143?'Monad mainnet · Real MON for transactions':'Monad testnet · Test tokens only';
