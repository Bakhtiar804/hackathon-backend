import bcrypt from 'bcrypt';
import { Company, User, Session } from '../models/index.js';
import { email, password } from '../validators/index.js';
import { assert } from '../utils/errors.js';
import { audit, transaction } from './common.js';

// Offline operator recovery only; intentionally not imported by any HTTP route.
export async function resetAdminPassword(input) {
  const normalizedEmail = email.parse(input.email);
  const newPassword = password.parse(input.newPassword);
  return transaction(async session => {
    assert(await Company.exists({ _id: 'singleton' }).session(session), 409, 'Company is not initialized; use first-time setup instead');
    const user = await User.findOne({ email: normalizedEmail }).session(session);
    assert(user && user.role === 'Admin', 404, 'Existing Admin account not found; no account was created or promoted');
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.mustChangePassword = false;
    user.tokenVersion += 1;
    await user.save({ session });
    await Session.deleteMany({ userId: user._id }, { session });
    await audit(user, 'admin_password_reset_cli', 'User', user._id, null, { sessionsRevoked: true }, session);
    return { email: user.email, active: user.active, loginRequired: true };
  }, { business: false });
}
