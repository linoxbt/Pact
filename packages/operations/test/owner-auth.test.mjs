import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { PrivyTokenVerifier } from '../dist/index.js';

test('owner authentication verifies signed Privy app tokens and rejects altered claims', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve:'prime256v1' });
  const jwk = publicKey.export({ format:'jwk' });
  const appId = 'test-privy-app-id';
  const verifier = new PrivyTokenVerifier(appId, async url => {
    assert.equal(url,`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`);
    return new Response(JSON.stringify({ keys:[{ ...jwk, kid:'test-key', alg:'ES256' }] }),
      { status:200, headers:{ 'Content-Type':'application/json' } });
  });
  const now = Math.floor(Date.now()/1000);
  const header = Buffer.from(JSON.stringify({ alg:'ES256', kid:'test-key', typ:'JWT' })).toString('base64url');
  const make = claims => {
    const payload = Buffer.from(JSON.stringify({ iss:'privy.io',aud:appId,sub:'did:privy:owner1',
      iat:now,exp:now+3600,...claims })).toString('base64url');
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`),
      { key:privateKey,dsaEncoding:'ieee-p1363' }).toString('base64url');
    return `${header}.${payload}.${signature}`;
  };
  assert.equal((await verifier.verify(make({}))).did,'did:privy:owner1');
  await assert.rejects(() => verifier.verify(make({ aud:'another-app' })),/INVALID_OWNER_TOKEN/);
  await assert.rejects(() => verifier.verify(make({ exp:now-1 })),/INVALID_OWNER_TOKEN/);
  const valid = make({});
  const [one,two,three] = valid.split('.');
  await assert.rejects(() => verifier.verify(`${one}.${two}.${three.slice(0,-2)}xx`),
    /INVALID_OWNER_TOKEN/);
});
