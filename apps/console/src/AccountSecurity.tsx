import {useState} from 'react';
import {useLinkWithPasskey,usePrivy} from '@privy-io/react-auth';
import {Icon} from './ui.js';

export function AccountSecurity() {
  const {user}=usePrivy();
  const {linkWithPasskey}=useLinkWithPasskey();
  const [pending,setPending]=useState(false);
  const [message,setMessage]=useState('');
  const [failed,setFailed]=useState(false);
  const passkeys=user?.linkedAccounts?.filter(account=>account.type==='passkey')??[];
  const supported=window.isSecureContext&&typeof window.PublicKeyCredential!=='undefined';
  const create=async()=>{
    setPending(true);setMessage('');setFailed(false);
    try {await linkWithPasskey({name:'Pact account'});setMessage('Passkey created. You can use it to sign in.');}
    catch {setFailed(true);setMessage('Passkey was not created. Retry and complete your device prompt.');}
    finally {setPending(false);}
  };
  return <section className="cpCard cpSecurity" aria-label="Sign-in and security">
    <div><span className="cpEyebrow">SIGN-IN & SECURITY</span><h2>Passkeys</h2>
      <p>Sign in with your fingerprint, face or device PIN.</p>
      <span className="cpVerified"><Icon name="key" size={16}/>{passkeys.length?`${passkeys.length} passkey${passkeys.length===1?'':'s'} linked`:'No passkey linked'}</span>
    </div>
    <div><button className="cpPrimary" disabled={pending||!supported} onClick={()=>void create()}>
      <Icon name="key" size={16}/>{pending?'Creating passkey…':passkeys.length?'Create another passkey':'Create passkey'}
    </button>
      {!supported&&<p role="status">Open Pact in a browser that supports passkeys over HTTPS.</p>}
      {message&&<p role={failed?'alert':'status'}>{message}</p>}
    </div>
  </section>;
}
