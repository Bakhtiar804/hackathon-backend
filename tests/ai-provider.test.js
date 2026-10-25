import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providerCompletion,completionUrl,checkAIProvider,GEMINI_BASE_URL,GEMINI_MODEL} from '../src/services/ai-provider.js';
const config={AI_API_KEY:' fixture-provider-key ',AI_BASE_URL:GEMINI_BASE_URL+'/',AI_MODEL:GEMINI_MODEL};
const response=message=>new Response(JSON.stringify({choices:[{message}]}),{headers:{'Content-Type':'application/json'}});

test('Gemini compatibility URL, bearer authentication and message metadata are preserved',async()=>{
 assert.equal(completionUrl(GEMINI_BASE_URL+'/'),GEMINI_BASE_URL+'/chat/completions');
 assert.equal(completionUrl(GEMINI_BASE_URL+'/chat/completions/'),GEMINI_BASE_URL+'/chat/completions');
 const message={role:'assistant',content:null,tool_calls:[{id:'one',type:'function',function:{name:'diagnostic_ping',arguments:'{"value":"ok"}'},extra_content:{google:{thought_signature:'opaque-signature'}}}]};
 const result=await providerCompletion([{role:'user',content:'Synthetic test'}],AbortSignal.timeout(1000),{tool_choice:'auto'},config,async(url,options)=>{
  assert.equal(url,GEMINI_BASE_URL+'/chat/completions');assert.equal(options.headers.Authorization,'Bearer fixture-provider-key');
  const body=JSON.parse(options.body);assert.equal(body.model,GEMINI_MODEL);assert.equal(body.tool_choice,'auto');return response(message);
 });
 assert.deepEqual(result,message);
});

test('provider errors expose safe codes, never provider response bodies or keys',async()=>{
 for(const [status,code]of [[400,'request_rejected'],[401,'authentication'],[403,'authentication'],[404,'model_not_found'],[429,'rate_limited'],[503,'provider_unavailable']]) {
  await assert.rejects(()=>providerCompletion([],undefined,{},config,async()=>new Response('private-provider-error fixture-provider-key',{status})),error=>error.code===code&&!error.message.includes('fixture-provider-key')&&!error.message.includes('private-provider-error'));
 }
 await assert.rejects(()=>providerCompletion([],undefined,{},config,async()=>new Response('invalid JSON')),{code:'invalid_response'});
 await assert.rejects(()=>providerCompletion([],undefined,{},config,async()=>response({role:'assistant',content:''})),{code:'invalid_response'});
});

test('empty configuration makes no provider request; aborts and network failures are distinct',async()=>{
 let sent=false;
 await assert.rejects(()=>providerCompletion([],undefined,{}, {...config,AI_API_KEY:' '},async()=>{sent=true;}),{code:'not_configured'});assert.equal(sent,false);
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>providerCompletion([],controller.signal,{},config,async()=>{throw new Error('private network detail');}),{code:'timeout'});
 await assert.rejects(()=>providerCompletion([],undefined,{},config,async()=>{throw new Error('private network detail');}),{code:'network'});
});

test('Gemini diagnostic verifies tool call, signature round-trip and strict structured JSON without database access',async()=>{
 let count=0;
 const signature={google:{thought_signature:'keep-this-opaque'}};
 const result=await checkAIProvider(config,async(_url,options)=>{
  const body=JSON.parse(options.body);count++;
  if(count===1) {assert.equal(body.tools[0].function.name,'diagnostic_ping');return response({role:'assistant',content:null,tool_calls:[{id:'ping',type:'function',function:{name:'diagnostic_ping',arguments:'{"value":"ok"}'},extra_content:signature}]});}
  if(count===2) {assert.deepEqual(body.messages.at(-2).tool_calls[0].extra_content,signature);assert.equal(body.messages.at(-1).role,'tool');return response({role:'assistant',content:'OK'});}
  assert.equal(body.response_format.type,'json_schema');return response({role:'assistant',content:'{"ok":true}'});
 });
 assert.equal(count,3);assert.equal(result.connected,true);assert.equal(result.toolRoundTrip,true);assert.equal(result.structuredOutput,true);
 assert.equal(result.providerHost,'generativelanguage.googleapis.com');assert(!JSON.stringify(result).includes('fixture-provider-key'));
});

test('diagnostic rejects models that omit the required function call',async()=>{
 await assert.rejects(()=>checkAIProvider(config,async()=>response({role:'assistant',content:'I cannot call tools.'})),{code:'tool_calling_failed'});
});
