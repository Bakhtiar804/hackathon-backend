import mongoose from 'mongoose';
import { app, logger } from './src/app.js';
import { connectDB } from './src/config/db.js';
import { env } from './src/config/env.js';
import { ensureIndexes } from './src/models/index.js';
await connectDB(); await ensureIndexes();
const server=app.listen(env.PORT,()=>logger.info({port:env.PORT},'HCM Lite API listening'));
let stopping=false;
async function shutdown(signal) {if(stopping)return;stopping=true;logger.info({signal},'shutting down');const deadline=setTimeout(()=>process.exit(1),10000);deadline.unref();server.close(async()=>{await mongoose.disconnect();clearTimeout(deadline);process.exit(0);});}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
