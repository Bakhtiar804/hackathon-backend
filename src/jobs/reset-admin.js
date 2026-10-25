import { emitKeypressEvents, createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { runStartup } from '../utils/startup.js';

function hiddenQuestion(label) {
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(label);
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const cleanup = () => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onKey = (text, key = {}) => {
      if (key.ctrl && key.name === 'c') { cleanup(); reject(new Error('Recovery cancelled; no password was changed')); }
      else if (key.name === 'return' || key.name === 'enter') { cleanup(); resolve(value); }
      else if (key.name === 'backspace') value = [...value].slice(0, -1).join('');
      else if (!key.ctrl && !key.meta && text && !/[\r\n\x00-\x1f\x7f]/.test(text)) value += text;
    };
    process.stdin.on('keypress', onKey);
  });
}

let mongoose;
await runStartup('Admin recovery failed', async () => {
  const { values } = parseArgs({ options: { workspace: { type: 'string' }, email: { type: 'string' }, help: { type: 'boolean' } }, strict: true });
  if (values.help) { console.log('Usage: npm run reset-admin -- --workspace my-company --email admin@example.com\nRun in an interactive terminal. Passwords are prompted without echo. Check the configured MONGODB_URI before proceeding.'); return; }
  if (!values.email) throw new Error('Supply the existing Admin email: npm run reset-admin -- --workspace my-company --email admin@example.com');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run recovery in an interactive terminal. Passwords are never accepted as command-line arguments or printed.');
  const { email, password } = await import('../validators/index.js');
  const adminEmail = email.parse(values.email);
  console.log('This explicitly resets one existing Admin in the database configured by MONGODB_URI and revokes all of their sessions. It never creates a company or account. Verify the target database configuration before continuing.');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const confirmation = await new Promise(resolve => prompt.question(`Type RESET ${adminEmail} to continue (workspace: ${values.workspace || 'unique matching account'}): `, resolve));
  prompt.close();
  if (confirmation !== `RESET ${adminEmail}`) throw new Error('Recovery cancelled; no password was changed');
  let newPassword = password.parse(await hiddenQuestion('New Admin password (hidden): '));
  let repeat = await hiddenQuestion('Confirm new password (hidden): ');
  if (newPassword !== repeat) throw new Error('Passwords do not match; no password was changed');
  const { connectDB } = await import('../config/db.js');
  ({ default: mongoose } = await import('mongoose'));
  const { resetAdminPassword } = await import('../services/admin-recovery.js');
  try {
    await connectDB();
    const result = await resetAdminPassword({ email: adminEmail, newPassword, workspaceSlug: values.workspace });
    console.log(result.active ? 'Admin password updated; all previous sessions revoked. Sign in with the new password.' : 'Password updated and sessions revoked; this Admin remains inactive. Recovery did not change account activation.');
  } finally { newPassword = ''; repeat = ''; await mongoose.disconnect(); }
}, async () => { if (mongoose) await mongoose.disconnect(); });

