import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isBlockedUpstreamAddress,forwardUpstream} from '../dist/upstream.js';
import {createServer} from 'node:http';
test('public IPv4 and IPv6 survive mapped-address SSRF protections',()=>{
 for(const ip of ['104.21.1.1','8.8.8.8','1.1.1.1','2606:4700::1111'])
  assert.equal(isBlockedUpstreamAddress(ip),false,ip);
});
test('a DNS hostname forwards using its validated pinned address on Node 22',async()=>{
 const server=createServer((_req,res)=>res.end('ok'));
 await new Promise(resolve=>server.listen(0,'localhost',resolve));
 try {
  const response=await forwardUpstream(new URL(`http://localhost:${server.address().port}/`),'GET',{},Buffer.alloc(0),true);
  assert.equal(response.status,200);assert.equal(response.body.toString(),'ok');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('private, metadata, mapped and translation addresses remain blocked',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.1.2','192.168.1.1',
  '100.64.0.1','0.0.0.0','224.0.0.1','::1','fd00::1','fe80::1','::ffff:127.0.0.1',
  '::ffff:8.8.8.8','64:ff9b::808:808','2001:db8::1','invalid'])
  assert.equal(isBlockedUpstreamAddress(ip),true,ip);
});
