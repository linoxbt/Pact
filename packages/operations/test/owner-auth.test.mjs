import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { PrivyTokenVerifier, OwnerAuthService, createDatabase, migrate } from '../dist/index.js';

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

test('new Privy account gets a unique HTTP principal without a wallet or RPC call',
  { skip: !process.env.PACT_TEST_DATABASE_URL }, async () => {
    const database = createDatabase(process.env.PACT_TEST_DATABASE_URL);
    await migrate(database);
    const rpc = { verifyMessage: async () => { throw Error('wallet proof must not run on signup'); } };
    let didIndex = 0;
    const prefix = randomUUID().replaceAll('-','');
    const verifier = { verify: async () => ({ did: `did:privy:${prefix}${++didIndex}`, issuedAt: 1 }) };
    const auth = new OwnerAuthService(database, rpc, verifier, 'localhost');
    try {
      const first = await auth.authenticate('Bearer test');
      const second = await auth.authenticate('Bearer test');
      assert.match(first.principalAddress,/^0x[0-9a-f]{40}$/);
      assert.equal(first.principalStatus,'account_assigned');
      assert.notEqual(first.principalAddress,second.principalAddress);
      const stored = await database.query('SELECT principal_status FROM pact_users WHERE id=$1',[first.id]);
      assert.equal(stored.rows[0].principal_status,'account_assigned');
    } finally { await database.end(); }
  });
