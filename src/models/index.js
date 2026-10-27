import mongoose from 'mongoose';
import { tenantSchema } from '../middleware/tenant.js';
const { Schema } = mongoose;
const opts = { timestamps: true, versionKey: false };
const objectId = { type: Schema.Types.ObjectId };
function scoped(definition, options = opts) {
  const schema = new Schema(definition, options);
  schema.plugin(tenantSchema);
  if (definition.email) schema.index({ workspaceId: 1, email: 1 }, { unique: true });
  if (definition.code) schema.index({ workspaceId: 1, code: 1 }, { unique: true });
  if (definition.code && definition.userId) schema.index({ workspaceId: 1, userId: 1 }, { unique: true });
  if (definition.month) schema.index({ workspaceId: 1, month: 1 }, { unique: true });
  return schema;
}
const policy = new Schema({ effectiveDate: String, timezone: String, officeStart: String, officeEnd: String, graceMinutes: Number, halfDayHours: Number, weekendDays: [Number], officeLatitude: Number, officeLongitude: Number, geofenceRadius: Number, leaveTypes: [{ _id: false, name: String, quota: Number, paid: Boolean, active: Boolean }], holidays: [{ _id: false, date: String, name: String, active: Boolean }] }, { _id: false });
const companySchema = new Schema({ _id: { type: String, default: 'singleton' }, slug: String, name: String, policies: [policy], lock: { type: Number, default: 0 }, revision: { type: Number, default: 0 } }, opts);
companySchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: 'string' } } });
export const Company = mongoose.model('Company', companySchema);
export const User = mongoose.model('User', scoped({ displayName: {type:String,default:''}, email: { type: String, required: true, trim: true, lowercase: true }, passwordHash: { type: String, select: false }, role: { type: String, enum: ['Admin','HR','Employee'] }, active: { type: Boolean, default: true }, mustChangePassword: { type: Boolean, default: true }, tokenVersion: { type: Number, default: 0 }, employeeId: objectId }, opts));
export const Session = mongoose.model('Session', scoped({ _id: String, userId: objectId, expiresAt: { type: Date, index: { expires: 0 } } }, opts));
const configSchema = scoped({ kind: { type: String, enum: ['department','designation'] }, name: String, active: { type: Boolean, default: true } }, opts);
configSchema.index({ workspaceId: 1, kind: 1, name: 1 }, { unique: true });
export const OrgUnit = mongoose.model('OrgUnit', configSchema);
export const Employee = mongoose.model('Employee', scoped({ userId: { ...objectId }, code: { type: String }, email: { type: String }, name: String, departmentId: objectId, designationId: objectId, joiningDate: String, exitDate: String, status: String, gender: String, phone: String, address: String, emergencyContact: String, employmentHistory: [{ _id: false, effectiveDate: String, status: String }], salaryHistory: [{ _id: false, effectiveDate: String, basicMinor: Number }] }, opts));
const attendanceSchema = scoped({ employeeId: objectId, date: String, checkIn: Date, checkOut: Date, minutes: { type: Number, default: 0 }, late: { type: Boolean, default: false }, status: String, source: { type: String, default: 'web' }, policySnapshot: policy, correctionHistory: [Schema.Types.Mixed] }, opts);
attendanceSchema.index({ workspaceId: 1, employeeId: 1, date: 1 }, { unique: true });
export const Attendance = mongoose.model('Attendance', attendanceSchema);
const correctionSchema = scoped({ employeeId: objectId, date: String, checkIn: Date, checkOut: Date, reason: String, state: { type: String, default: 'pending' }, comment: String, reviewedBy: objectId }, opts);
correctionSchema.index({ workspaceId: 1, employeeId: 1, date: 1 }, { unique: true, partialFilterExpression: { state: 'pending' } });
export const Correction = mongoose.model('Correction', correctionSchema);
export const Leave = mongoose.model('Leave', scoped({ employeeId: objectId, type: String, start: String, end: String, reason: String, days: [{ _id: false, date: String, year: Number, paid: Boolean, quota: Number }], state: { type: String, default: 'pending' }, comment: String, reviewedBy: objectId }, opts));
export const Payroll = mongoose.model('Payroll', scoped({ month: { type: String }, state: { type: String, default: 'draft' }, sourceRevision: Number, slips: [Schema.Types.Mixed], policySnapshots: [policy], generatedAt: Date, finalizedAt: Date, finalizedBy: objectId }, opts));
export const Announcement = mongoose.model('Announcement', scoped({ title: String, body: String, authorId: objectId }, opts));
export const Notification = mongoose.model('Notification', scoped({ userId: objectId, title: String, entityId: String, readAt: Date }, opts));
export const Audit = mongoose.model('Audit', scoped({ actorId: objectId, action: String, entity: String, entityId: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed }, opts));
export const AiLog = mongoose.model('AiLog', scoped({ userId: objectId, kind: String, outcome: String, tools: [String], durationMs: Number }, { ...opts, collection:'ai_logs' }));
export const tenantModels = [User, Session, OrgUnit, Employee, Attendance, Correction, Leave, Payroll, Announcement, Notification, Audit, AiLog];
export async function assertTenantMigrationReady() {
  const oldCompany = await Company.collection.findOne({ slug: null });
  if (oldCompany) throw new Error('Workspace migration required. Back up the database and run npm run migrate-workspaces before starting this release.');
  for (const model of tenantModels) {
    if (await model.collection.findOne({ workspaceId: null }, { projection: { _id: 1 } })) throw new Error('Workspace migration required. Back up the database and run npm run migrate-workspaces before starting this release.');
    let indexes = [];
    try { indexes = await model.collection.indexes(); } catch (error) { if (error.code !== 26) throw error; }
    if (indexes.some(index => index.unique && index.name !== '_id_' && !('workspaceId' in index.key))) throw new Error('Workspace index migration required. Back up the database and run npm run migrate-workspaces before starting this release.');
  }
}
export async function ensureIndexes() { await assertTenantMigrationReady(); await Promise.all(Object.values(mongoose.models).map(m => m.init())); }
