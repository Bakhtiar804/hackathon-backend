import 'dotenv/config';
import { parseArgs } from 'node:util';
import { checkAIProvider } from '../services/ai-provider.js';
const {values}=parseArgs({options:{help:{type:'boolean'}},strict:true});
if(values.help) console.log('Usage: npm run check-ai\nUses backend AI_API_KEY, AI_BASE_URL and AI_MODEL. Tests tool calling/round-trip and JSON output with synthetic prompts only. No database access or company data. Makes three provider requests with one 15-second deadline. Never prints keys or provider response bodies.');
else {
  try {
    const result=await checkAIProvider({AI_API_KEY:process.env.AI_API_KEY,AI_BASE_URL:process.env.AI_BASE_URL||'https://api.openai.com/v1',AI_MODEL:process.env.AI_MODEL||'gpt-4o-mini'});
    console.log(JSON.stringify(result,null,2));
  } catch(error) {
    console.error(JSON.stringify({connected:false,code:error.code||'configuration_error',message:error.name==='AIProviderError'?error.message:'Check the backend AI environment configuration.'},null,2));
    process.exitCode=1;
  }
}
