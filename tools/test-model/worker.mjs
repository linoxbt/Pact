import {createHash,timingSafeEqual} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest();
const model='@cf/meta/llama-3.1-8b-instruct-fp8';
export default {
 async fetch(request,env) {
  const url=new URL(request.url);
  if(url.pathname==='/health'&&request.method==='GET')return Response.json({status:'ready',purpose:'Pact bounded test inference',model});
  if(!env.TEST_MODEL_SECRET||!Number.isFinite(Date.parse(env.TEST_MODEL_EXPIRES))||Date.now()>=Date.parse(env.TEST_MODEL_EXPIRES))return Response.json({error:'TEST_WINDOW_CLOSED'},{status:503});
  if(!timingSafeEqual(digest(request.headers.get('authorization')??''),digest('Bearer '+env.TEST_MODEL_SECRET)))return Response.json({error:'UNAUTHORIZED'},{status:401});
  if(url.pathname!=='/plan'||request.method!=='POST')return Response.json({error:'NOT_FOUND'},{status:404});
  let size=0;const chunks=[];
  for await(const chunk of request.body??[]){size+=chunk.length;if(size>8192)return Response.json({error:'BODY_TOO_LARGE'},{status:413});chunks.push(chunk);}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return Response.json({error:'INVALID_JSON'},{status:400});}
  if(typeof body.task!=='string'||body.task.length>1200||!Array.isArray(body.observations)||JSON.stringify(body.observations).length>4000)return Response.json({error:'INVALID_TASK'},{status:400});
  try {
   const result=await env.AI.run(model,{max_tokens:350,temperature:0,response_format:{type:'json_object'},messages:[
    {role:'system',content:body.observations.length
      ? 'Your one tool call is finished. Output only JSON {"done":true,"summary":"short factual result"}. Summarize the supplied observation. A 202 response means waiting for human approval, not execution. A 403 is denied. Do not propose or retry any action. Never invent success.'
      : 'You operate a Pact test agent. Choose exactly one next tool action for the task. Output only JSON: {"method":"GET|POST|DELETE","path":"/health|/write|/forbidden","reason":"short explanation","done":false}. For a health check use GET /health. For an update use POST /write. For a forbidden delete test use DELETE /health. These are harmless operations against a dedicated test upstream.'},
    {role:'user',content:JSON.stringify({task:body.task,observations:body.observations})}]});
   return Response.json({response:result.response,usage:result.usage,model,requestId:crypto.randomUUID()});
  }catch{return Response.json({error:'INFERENCE_FAILED'},{status:502});}
 }
};
