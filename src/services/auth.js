import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { Company, User, Session, OrgUnit } from '../models/index.js';
import { env } from '../config/env.js';
import { assert, AppError } from '../utils/errors.js';
import { transaction, audit, roles } from './common.js';
import { withWorkspace, workspaceId } from '../middleware/tenant.js';
import { policy as policySchema } from '../validators/index.js';
import { normalizeEmail } from '../utils/email.js';
import { currentPolicy } from '../utils/dates.js';
export const temporaryPassword = () => randomBytes(18).toString('base64url');
export const publicUser = u => ({ id:u._id, workspaceId:u.workspaceId, email:u.email, role:u.role, active:u.active, mustChangePassword:u.mustChangePassword, employeeId:u.employeeId });
export async function sessionUser(user, session = null) {
  const c = await Company.findById(workspaceId()).session(session);
  const units = await OrgUnit.find().select('kind name active').session(session).lean();
  const policies = (c?.policies || []).map(p => ({ effectiveDate:p.effectiveDate, timezone:p.timezone, officeStart:p.officeStart, officeEnd:p.officeEnd, graceMinutes:p.graceMinutes, halfDayHours:p.halfDayHours, weekendDays:p.weekendDays, leaveTypes:p.leaveTypes, holidays:p.holidays }));
  return { ...publicUser(user), workspace:c ? { id:c._id, slug:c.slug, name:c.name, timezone:currentPolicy(c).timezone, policies, units } : null };
}
async function initializeCompany(input, { reuseExistingUser = false, idempotent = false, id = 'singleton', slug = 'legacy' } = {}) {
  return withWorkspace(id, () => transaction(async session => {
    if (id === 'singleton') {
      const initialized = await Company.findOne().session(session);
      if (initialized && idempotent) return { initialized:false, companyName:initialized.name };
      assert(!initialized,409,'Application already initialized');
    }
    const email=normalizeEmail(input.email);
    let user = reuseExistingUser ? await User.findOne({ email }).session(session) : null;
    const reusedUser=Boolean(user);
    const [c]=await Company.create([{ _id:id, slug, name:input.companyName, policies:[{ ...policySchema.parse(input.policy || {}), effectiveDate:'0001-01-01' }] }],{ session });
    if(!user) [user]=await User.create([{ email,passwordHash:await bcrypt.hash(input.password,12),role:'Admin',mustChangePassword:false }],{ session });
    await audit(user,'setup','Company',c._id,null,{ name:c.name },session);
    return { initialized:true,reusedUser,companyName:c.name,workspace:{id:c._id,slug:c.slug,name:c.name},user:publicUser(user) };
  }, { business:false }));
}
export async function createWorkspace(input) {
  const { workspaceSlug, ...fields }=input;
  const result=await initializeCompany(fields,{id:new mongoose.Types.ObjectId().toString(),slug:workspaceSlug});
  return { workspace:result.workspace,user:result.user };
}
// Deprecated compatibility endpoint: remains strictly first-install only.
export async function setupCompany(input) {
  const {companyName,user}=await initializeCompany(input);
  return {companyName,user};
}
export async function bootstrapCompany(input) {
  return withWorkspace('singleton', async () => {
    for(let attempt=0;attempt<3;attempt++) {
      try { return await initializeCompany({...input,email:normalizeEmail(input.email)},{reuseExistingUser:true,idempotent:true}); }
      catch(error) {
        if(error.code!==11000) throw error;
        const existing=await Company.findOne();
        if(existing) return {initialized:false,companyName:existing.name};
        if(!await User.findOne({email:normalizeEmail(input.email)}) || attempt===2) throw error;
      }
    }
  });
}
const dummyHash=await bcrypt.hash(randomBytes(24).toString('hex'),12);
export async function login({email,password,workspaceSlug}) {
  email=normalizeEmail(email);
  let id;
  if(workspaceSlug) id=(await Company.findOne({slug:workspaceSlug}).lean())?._id;
  else {
    // Only authentication may resolve an email globally; no list is returned.
    const candidates=await User.collection.find({email},{projection:{workspaceId:1,passwordHash:1,active:1}}).limit(2).toArray();
    if(candidates.length>1) {
      const checks=await Promise.all(candidates.map(candidate=>bcrypt.compare(password,candidate.active?candidate.passwordHash:dummyHash)));
      assert(checks.some((valid,index)=>valid&&candidates[index].active),401,'Invalid email or password');
      throw new AppError(422,'Enter your workspace address to sign in',[{field:'workspaceSlug',reason:'Enter the workspace address for this account.'}]);
    }
    id=candidates[0]?.workspaceId;
  }
  return withWorkspace(id || '__unknown_workspace__', async () => {
    const user=await User.findOne({email}).select('+passwordHash');
    const valid=await bcrypt.compare(password,user?.passwordHash || dummyHash);
    assert(user && valid && user.active,401,'Invalid email or password');
    return transaction(async session => {
      const current=await User.findById(user._id).select('+passwordHash').session(session);
      assert(current?.active && current.passwordHash===user.passwordHash,401,'Invalid email or password');
      const sid=randomUUID();
      await Session.create([{_id:sid,userId:current._id,expiresAt:new Date(Date.now()+8*3600000)}],{session});
      const token=jwt.sign({sub:String(current._id),workspaceId:workspaceId(),ver:current.tokenVersion,sid},env.JWT_SECRET,{expiresIn:'8h',issuer:'hcm-lite',audience:'hcm-api',algorithm:'HS256'});
      return {token,tokenType:'Bearer',expiresIn:28800,user:await sessionUser(current,session)};
    },{business:false});
  });
}
export async function changePassword(actor, input) {
  return transaction(async session => {
    const u = await User.findById(actor._id).select('+passwordHash').session(session);
    assert(await bcrypt.compare(input.currentPassword,u.passwordHash),401,'Current password is incorrect');
    assert(input.currentPassword !== input.newPassword,422,'Choose a different password');
    u.passwordHash = await bcrypt.hash(input.newPassword,12); u.mustChangePassword = false; u.tokenVersion++;
    await u.save({ session }); await Session.deleteMany({ userId:u._id },{ session });
    await audit(actor,'password_changed','User',u._id,null,null,session);
    return { loginRequired:true };
  }, { business:false });
}
export async function createHR(actor, input) {
  roles(actor,'Admin');
  return transaction(async session => {
    const password = temporaryPassword();
    const [u] = await User.create([{ email:input.email, role:'HR', passwordHash:await bcrypt.hash(password,12) }], { session });
    await audit(actor,'created','User',u._id,null,publicUser(u),session);
    return { user:publicUser(u), temporaryPassword:password };
  }, { business:false });
}
export async function manageUser(actor,id,action) {
  roles(actor,'Admin');
  return transaction(async session => {
    const u = await User.findById(id).session(session); assert(u && u.role !== 'Admin',403,'Only HR and Employee logins can be managed');
    const before = publicUser(u); let password;
    if(action === 'reset') { password=temporaryPassword(); u.passwordHash=await bcrypt.hash(password,12); u.mustChangePassword=true; }
    else u.active = action === 'activate';
    u.tokenVersion++; await u.save({ session }); await Session.deleteMany({ userId:id },{ session });
    await audit(actor,action,'User',id,before,publicUser(u),session);
    return { user:publicUser(u), ...(password && { temporaryPassword:password }) };
  }, { business:false });
}



