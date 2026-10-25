import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User, Session } from '../models/index.js';
import { env } from '../config/env.js';
import { assert, AppError } from '../utils/errors.js';
import { withWorkspace } from './tenant.js';
export async function authenticate(req,res,next) {
  const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
  assert(token,401,'Authentication required');
  let claims;
  try { claims=jwt.verify(token,env.JWT_SECRET,{ algorithms:['HS256'], issuer:'hcm-lite', audience:'hcm-api' }); } catch { throw new AppError(401,'Invalid or expired session'); }
  assert(typeof claims.sub === 'string' && /^[a-f\d]{24}$/i.test(claims.sub) && typeof claims.sid === 'string',401,'Invalid or expired session');
  // The sole unscoped authentication lookup resolves ownership, never business data.
  const owner = await User.collection.findOne({ _id: new mongoose.Types.ObjectId(claims.sub) }, { projection: { workspaceId: 1 } });
  assert(owner?.workspaceId,401,'Invalid or expired session');
  assert(claims.workspaceId === owner.workspaceId || (!claims.workspaceId && owner.workspaceId === 'singleton'),401,'Invalid or expired session');
  return withWorkspace(owner.workspaceId, async () => {
    const [u,s] = await Promise.all([User.findById(claims.sub),Session.findOne({ _id:claims.sid, userId:claims.sub, expiresAt:{ $gt:new Date() } })]);
    assert(u?.active && s && u.tokenVersion === claims.ver,401,'Invalid or expired session');
    req.actor=u; req.sessionId=claims.sid; req.workspaceId=owner.workspaceId;
    if(u.mustChangePassword && !['/auth/me','/auth/logout','/auth/change-password'].includes(req.path)) throw new AppError(403,'Password change required');
    next();
  });
}
export const authorize = (...roles) => (req,res,next) => { assert(roles.includes(req.actor.role),403,'Access denied'); next(); };
