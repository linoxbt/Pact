import {createRequire} from 'node:module';
import{load,save,gateway,api,control}from'./client.mjs';
import{spawnSync}from'node:child_process';
const require=createRequire(new URL('../../apps/mcp/package.json',import.meta.url));
const {Client}=await import(require.resolve('@modelcontextprotocol/client'));
const {StdioClientTransport}=await import(require.resolve('@modelcontextprotocol/client/stdio'));
const r=load('resources.json'),report={checks:[]};
const client=new Client({name:'pact-live-verifier',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:['apps/mcp/dist/main.js'],env:{PATH:process.env.PATH,PACT_GATEWAY_URL:gateway,PACT_AGENT_KEY:r.key.secret}});
try{
 await client.connect(transport);
 const tools=await client.listTools();
 const authority=await client.callTool({name:'pact_http_authority',arguments:{}});if(authority.isError)throw Error('MCP authority failed');
 const allowed=await client.callTool({name:'pact_proxy_request',arguments:{agentId:r.agent.id,serviceId:r.service.id,method:'GET',path:r.probe.path+'/read'}});
 if(allowed.isError||!allowed.content.some(c=>c.text?.includes('true')))throw Error('MCP allowed call failed: '+JSON.stringify(allowed));
 const denied=await client.callTool({name:'pact_proxy_request',arguments:{agentId:r.agent.id,serviceId:r.service.id,method:'GET',path:r.probe.path+'/forbidden'}});
 if(!denied.isError||denied.content.some(c=>c.text?.includes('request_failed')))throw Error('MCP denial reason missing');
 report.checks.push({name:'Real MCP stdio discovery, authority, allowed and denied proxy tools',status:'passed',evidence:{tools:tools.tools.map(t=>t.name),allowed,denied}});
}finally{await client.close();}
const python=spawnSync('python3',['-c',`import json,sys
from pact import PactClient
from pact.client import PactApiError
c=json.load(sys.stdin)
p=PactClient(c['gateway'],c['key'])
assert p.proxy(c['agent'],c['service'],'GET',c['path']+'/read')['ok'] is True
try:
 p.proxy(c['agent'],c['service'],'GET',c['path']+'/forbidden')
 raise AssertionError('forbidden call allowed')
except PactApiError as e:
 assert e.status==403
 assert e.code!='HTTP_ERROR'
print('Python SDK allowed GET and denied forbidden operation')
`],{env:{...process.env,PYTHONPATH:'packages/sdk-python/src'},input:JSON.stringify({gateway,key:r.key.secret,agent:r.agent.id,service:r.service.id,path:r.probe.path}),encoding:'utf8'});
if(python.status!==0)throw Error('Python live SDK failed: '+python.stderr.slice(-500));
report.checks.push({name:'Real Python SDK allowed and denied gateway calls',status:'passed'});
save('clients-report.json',report);console.log(JSON.stringify(report));
