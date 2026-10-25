import { parseArgs } from 'node:util';
import { runStartup } from '../utils/startup.js';
let mongoose;
await runStartup('Read-only account inspection failed', async () => {
  const { values } = parseArgs({ options: { email: { type: 'string' }, help: { type: 'boolean' } }, strict: true });
  if (values.help) { console.log('Usage: npm run inspect-account -- --email admin@example.com\nRead-only: reports the configured database, company names and matching account state. Never prints hashes, credentials or tokens.'); return; }
  if (!values.email) throw new Error('Supply the Admin email with --email. No records changed.');
  await import('dotenv/config');
  const uri = process.env.MONGODB_URI;
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error('Configure a valid MONGODB_URI for the intended database.');
  const { email } = await import('../validators/index.js');
  const normalized = email.parse(values.email);
  ({ default: mongoose } = await import('mongoose'));
  try {
    // No models/index initialization: inspection must not create collections or indexes.
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    const db = mongoose.connection.db;
    const companies = await db.collection('companies').find({}, { projection: { _id:1, name:1, slug:1, createdAt:1 } }).limit(20).toArray();
    const accounts = await db.collection('users').find({ email:normalized }, { projection: { _id:1, email:1, role:1, active:1, mustChangePassword:1, workspaceId:1, createdAt:1 } }).limit(20).toArray();
    console.log(JSON.stringify({ readOnly:true, database:db.databaseName, clusterHostname:new URL(uri).hostname, companyCount:await db.collection('companies').countDocuments(), companies, matchingAccounts:accounts }, null, 2));
  } finally { await mongoose.disconnect(); }
}, async () => { if (mongoose) await mongoose.disconnect(); });
