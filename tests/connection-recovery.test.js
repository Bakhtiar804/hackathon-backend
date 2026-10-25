import { test } from './legacy-test-context.js';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.MONGODB_URI = 'mongodb://127.0.0.1/recovery_test_never_live';
process.env.JWT_SECRET = 'recovery-tests-only-secret-32-characters';
process.env.MONGOMS_VERSION ||= '7.0.24';
if (!process.env.MONGOMS_SYSTEM_BINARY && existsSync('tmp/mongodb/mongod.exe')) process.env.MONGOMS_SYSTEM_BINARY = fileURLToPath(new URL('../tmp/mongodb/mongod.exe', import.meta.url));
const { app } = await import('../src/app.js');
const { User, Company, Session, Audit, ensureIndexes } = await import('../src/models/index.js');
const { resetAdminPassword } = await import('../src/services/admin-recovery.js');
const { setupCompany, login } = await import('../src/services/auth.js');
const api = request(app);

test('frontend CORS allows every origin and preflight; auth remains protected', async () => {
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5174', 'https://untrusted.example', 'http://localhost:5173.evil.example']) {
    const res = await api.get('/health').set('Origin', origin);
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], origin);
    assert.equal(res.headers['access-control-allow-credentials'], undefined);
    const preflight = await api.options('/api/v1/auth/login').set('Origin', origin).set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type,authorization');
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers['access-control-allow-methods'], /POST/);
    assert.match(preflight.headers['access-control-allow-headers'], /Authorization/);
    assert.match(preflight.headers['access-control-allow-headers'], /Content-Type/);
  }
  assert.equal((await api.get('/api/v1/users').set('Origin', 'http://localhost:5173')).status, 401);
  assert.equal((await api.get('/health')).status, 200);
});

test('offline Admin recovery hashes securely, revokes sessions, and never creates/promotes accounts', { timeout: 120000 }, async t => {
  const repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  t.after(async () => { await mongoose.disconnect(); await repl.stop(); });
  await mongoose.connect(repl.getUri('admin_recovery_isolated'));
  await ensureIndexes();
  const oldPassword = 'old-secure-password-123';
  const newPassword = 'new-secure-password-456';
  await assert.rejects(() => resetAdminPassword({ email: 'admin@example.com', newPassword }), /not initialized/);
  assert.equal(await Company.countDocuments(), 0);
  const setup = await setupCompany({ companyName: 'Isolated Recovery', email: 'admin@example.com', password: oldPassword });
  const oldLogin = await login({ email: 'admin@example.com', password: oldPassword });
  const before = await User.findById(setup.user.id).lean();
  assert.equal(await Session.countDocuments({ userId: setup.user.id }), 1);
  await resetAdminPassword({ email: ' ADMIN@example.com ', newPassword });
  const after = await User.findById(setup.user.id).select('+passwordHash').lean();
  assert.equal(after.tokenVersion, before.tokenVersion + 1);
  assert.equal(after.role, before.role);
  assert.equal(after.active, before.active);
  assert(await bcrypt.compare(newPassword, after.passwordHash));
  assert.equal(await Session.countDocuments({ userId: setup.user.id }), 0);
  assert.equal((await api.get('/api/v1/auth/me').set('Authorization', `Bearer ${oldLogin.token}`)).status, 401);
  await assert.rejects(() => login({ email: 'admin@example.com', password: oldPassword }), /Invalid email or password/);
  const restored = await login({ email: 'admin@example.com', password: newPassword });
  assert(restored.token);
  assert.equal(restored.user.workspace.timezone, 'Asia/Karachi');
  assert.equal(restored.user.workspace.name, 'Isolated Recovery');
  assert(Array.isArray(restored.user.workspace.policies));
  assert(Array.isArray(restored.user.workspace.units));
  assert(!JSON.stringify(restored.user.workspace).includes('officeLatitude'));
  const me = await api.get('/api/v1/auth/me').set('Authorization', `Bearer ${restored.token}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.data.workspace.timezone, 'Asia/Karachi');
  const audit = await Audit.findOne({ action: 'admin_password_reset_cli' }).lean();
  assert(audit);
  assert(!JSON.stringify(audit).includes(newPassword));
  await assert.rejects(() => resetAdminPassword({ email: 'missing@example.com', newPassword }), /not found/);
  const hr = await User.create({ email: 'hr@example.com', role: 'HR', passwordHash: await bcrypt.hash(oldPassword, 12) });
  await assert.rejects(() => resetAdminPassword({ email: hr.email, newPassword }), /not found/);
  assert.equal((await User.findById(hr._id)).role, 'HR');
  await assert.rejects(() => resetAdminPassword({ email: 'admin@example.com', newPassword: 'short' }));
  assert.equal(await User.countDocuments(), 2);
  assert.equal(await Company.countDocuments(), 1);
});


