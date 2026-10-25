import { runStartup } from '../utils/startup.js';
let mongoose;
await runStartup('Reconciliation failed',async()=> {
  const {connectDB}=await import('../config/db.js');
  ({default:mongoose}=await import('mongoose'));
  const {DateTime}=await import('luxon');
  const {User,Company,ensureIndexes}=await import('../models/index.js');
  const {withWorkspace}=await import('../middleware/tenant.js');
  const {reconcile}=await import('../services/attendance.js');
  const {currentPolicy}=await import('../utils/dates.js');
  await connectDB();await ensureIndexes();
  for(const c of await Company.find()) await withWorkspace(c._id,async()=> {
    const actor=await User.findOne({role:'Admin',active:true});
    if(!actor) return;
    const date=DateTime.now().setZone(currentPolicy(c).timezone).minus({days:1}).toISODate();
    const result=await reconcile(actor,process.argv[2]||date,process.argv[3]||process.argv[2]||date);
    console.log({workspace:c.slug,...result});
  });
  await mongoose.disconnect();
},async()=>{if(mongoose)await mongoose.disconnect();});
