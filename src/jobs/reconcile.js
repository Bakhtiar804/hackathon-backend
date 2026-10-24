import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { connectDB } from '../config/db.js';
import { User, ensureIndexes } from '../models/index.js';
import { company } from '../services/common.js';
import { reconcile } from '../services/attendance.js';
import { currentPolicy } from '../utils/dates.js';
try {await connectDB();await ensureIndexes();const actor=await User.findOne({role:'Admin',active:true});if(!actor)throw new Error('Initialize the application first');const c=await company();const date=DateTime.now().setZone(currentPolicy(c).timezone).minus({days:1}).toISODate();console.log(await reconcile(actor,process.argv[2]||date,process.argv[3]||process.argv[2]||date));}finally{await mongoose.disconnect();}
