import bcrypt from 'bcrypt';
import { Company, User, Session } from '../models/index.js';
import { email, password, workspaceSlug } from '../validators/index.js';
import { assert, AppError } from '../utils/errors.js';
import { audit, transaction } from './common.js';
import { withWorkspace } from '../middleware/tenant.js';

export async function resetAdminPassword(input) {
  const normalizedEmail=email.parse(input.email),newPassword=password.parse(input.newPassword);
  assert(await Company.exists({}),409,'Company is not initialized; use workspace creation instead');
  let id;
  if(input.workspaceSlug) id=(await Company.findOne({slug:workspaceSlug.parse(input.workspaceSlug)}).lean())?._id;
  else {
    const users=await User.collection.find({email:normalizedEmail},{projection:{workspaceId:1}}).limit(2).toArray();
    if(users.length>1) throw new AppError(422,'Supply --workspace to select the intended Admin account');
    id=users[0]?.workspaceId;
  }
  assert(id,404,'Existing Admin account not found; no account was created or promoted');
  return withWorkspace(id,()=>transaction(async session=> {
    const user=await User.findOne({email:normalizedEmail}).session(session);
    assert(user && user.role==='Admin',404,'Existing Admin account not found; no account was created or promoted');
    user.passwordHash=await bcrypt.hash(newPassword,12);user.mustChangePassword=false;user.tokenVersion++;
    await user.save({session});await Session.deleteMany({userId:user._id},{session});
    await audit(user,'admin_password_reset_cli','User',user._id,null,{sessionsRevoked:true},session);
    return {email:user.email,active:user.active,workspaceId:id,loginRequired:true};
  },{business:false}));
}
