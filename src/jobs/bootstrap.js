import { connectDB } from '../config/db.js';
import mongoose from 'mongoose';
import { ensureIndexes, Company } from '../models/index.js';
import { setup } from '../validators/index.js';
import { setupCompany } from '../services/auth.js';
try {
  await connectDB();await ensureIndexes();
  if(await Company.exists({_id:'singleton'})) console.log('Already initialized; no accounts changed.');
  else {const input=setup.parse({companyName:process.env.COMPANY_NAME||'HCM Lite',email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});await setupCompany(input);console.log('Company and first Admin initialized.');}
} finally {await mongoose.disconnect();}
