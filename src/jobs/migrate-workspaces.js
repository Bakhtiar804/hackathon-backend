import { parseArgs } from 'node:util';
import { runStartup } from '../utils/startup.js';
let mongoose;
await runStartup('Workspace migration failed', async()=> {
  const {values}=parseArgs({options:{'legacy-slug':{type:'string'},'confirm':{type:'boolean'},help:{type:'boolean'}},strict:true});
  if(values.help) { console.log('Usage: npm run migrate-workspaces -- --legacy-slug my-company --confirm\nBack up the intended database and stop all application writes first. Preserves existing records, credentials, IDs and sessions; adds workspace ownership and scoped uniqueness.'); return; }
  if(!values.confirm) throw new Error('Back up the intended database and stop all application writes, then pass --confirm to run the migration. No records changed.');
  const {connectDB}=await import('../config/db.js');
  ({default:mongoose}=await import('mongoose'));
  const {migrateWorkspaces}=await import('../services/workspace-migration.js');
  try { await connectDB(); const result=await migrateWorkspaces({legacySlug:values['legacy-slug'] || 'legacy'});console.log(JSON.stringify(result)); }
  finally {await mongoose.disconnect();}
},async()=>{if(mongoose) await mongoose.disconnect();});
