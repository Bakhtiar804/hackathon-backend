export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
export const GEMINI_MODEL = 'gemini-3.5-flash-lite';

export function resolveAIConfig(values) {
  const base=values.AI_BASE_URL?.trim() || GEMINI_BASE_URL;
  const model=values.AI_MODEL?.trim() || (new URL(base).hostname==='generativelanguage.googleapis.com'?GEMINI_MODEL:'gpt-4o-mini');
  return {AI_API_KEY:values.AI_API_KEY?.trim() || undefined,AI_BASE_URL:base,AI_MODEL:model};
}

export class AIProviderError extends Error {
  constructor(code, message, status) { super(message); this.name='AIProviderError'; this.code=code; this.status=status; }
}
export function completionUrl(base) {
  const url=new URL(base);
  url.pathname=url.pathname.replace(/\/+$/,'');
  if(!url.pathname.endsWith('/chat/completions')) url.pathname+='/chat/completions';
  return url.href;
}
export async function providerCompletion(messages, signal, extra, config, fetcher=fetch) {
  const key=config.AI_API_KEY?.trim();
  if(!key) throw new AIProviderError('not_configured','Set AI_API_KEY in the backend environment.');
  const url=completionUrl(config.AI_BASE_URL);
  let response;
  try {
    response=await fetcher(url,{method:'POST',signal,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.AI_MODEL,messages,temperature:0.1,max_tokens:4096,...extra})});
  } catch {
    throw new AIProviderError(signal?.aborted?'timeout':'network',signal?.aborted?'AI provider exceeded the 15-second deadline.':'Could not connect to the AI provider.');
  }
  if(!response.ok) {
    const code=response.status===401||response.status===403?'authentication':response.status===404?'model_not_found':response.status===429?'rate_limited':response.status===400?'request_rejected':'provider_unavailable';
    const messages={authentication:'Provider rejected the key or its project permissions.',model_not_found:'Check AI_MODEL and AI_BASE_URL for this API key.',rate_limited:'Provider quota or rate limit reached.',request_rejected:'Provider rejected the model request or required capabilities.',provider_unavailable:'AI provider is unavailable.'};
    // Never include provider bodies: they can echo credentials or submitted data.
    throw new AIProviderError(code,messages[code],response.status);
  }
  let payload;
  try {payload=await response.json();} catch {throw new AIProviderError('invalid_response','AI provider returned invalid JSON.');}
  const message=payload?.choices?.[0]?.message;
  if(!message || message.role!=='assistant' || (!message.tool_calls?.length && (typeof message.content!=='string'||!message.content.trim()))) throw new AIProviderError('invalid_response','AI provider returned no usable assistant response.');
  // Preserve the complete assistant message, including Gemini thought signatures.
  return message;
}
export async function checkAIProvider(config, fetcher=fetch) {
  const signal=AbortSignal.timeout(15000);
  const tools=[{type:'function',function:{name:'diagnostic_ping',description:'Return a synthetic connection check; no company data.',parameters:{type:'object',properties:{value:{type:'string',enum:['ok']}},required:['value'],additionalProperties:false}}}];
  const messages=[{role:'system',content:'This is a synthetic connection diagnostic, not business data.'},{role:'user',content:'Call diagnostic_ping with value ok. After its result, reply OK.'}];
  const tool=await providerCompletion(messages,signal,{tools,tool_choice:{type:'function',function:{name:'diagnostic_ping'}}},config,fetcher);
  const call=tool.tool_calls?.[0];
  let args;
  try {args=JSON.parse(call?.function?.arguments);} catch { /* Rejected below. */ }
  if(tool.tool_calls?.length!==1 || call?.function?.name!=='diagnostic_ping' || !call.id || args?.value!=='ok') throw new AIProviderError('tool_calling_failed','Model did not return the required function call.');
  await providerCompletion([...messages,tool,{role:'tool',tool_call_id:call.id,content:'{"ok":true}'}],signal,{tools,tool_choice:'none'},config,fetcher);
  const structured=await providerCompletion([{role:'user',content:'Return JSON only: {"ok":true}.'}],signal,{response_format:{type:'json_schema',json_schema:{name:'connection_check',strict:true,schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}}}},config,fetcher);
  let result;
  try {result=JSON.parse(structured.content);} catch { /* Rejected below. */ }
  if(result?.ok!==true || Object.keys(result).length!==1) throw new AIProviderError('structured_output_failed','Model did not return the required JSON structure.');
  return {connected:true,toolCalling:true,toolRoundTrip:true,structuredOutput:true,model:config.AI_MODEL,providerHost:new URL(config.AI_BASE_URL).hostname};
}
