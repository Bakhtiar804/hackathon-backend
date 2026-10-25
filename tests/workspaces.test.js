import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
process.env.NODE_ENV='test';process.env.LOG_LEVEL='silent';
process.env.MONGODB_URI='mongodb://127.0.0.1/isolated_workspace_tests';
process.env.JWT_SECRET='workspace-test-only-secret-at-least-32';
process.env.AI_API_KEY='';
process.env.MONGOMS_VERSION='7.0.24';
if(existsSync('tmp/mongodb/mongod.exe'))process.env.MONGOMS_SYSTEM_BINARY=fileURLToPath(new URL('../tmp/mongodb/mongod.exe',import.meta.url));
const {app}=await import('../src/app.js');
const models=await import('../src/models/index.js');
const {Company,User,Session,Employee,OrgUnit,Attendance,Payroll,Announcement,AiLog,ensureIndexes,tenantModels}=models;
const {withWorkspace}=await import('../src/middleware/tenant.js');
const {migrateWorkspaces}=await import('../src/services/workspace-migration.js');
const {policy}=await import('../src/validators/index.js');
const api=request(app),password='Workspace-test-password-123!';
const call=(method,path,token,body)=>{let r=api[method]('/api/v1'+path);if(token)r=r.set('Authorization',`Bearer ${token}`);return body===undefined?r:r.send(body);};
async function signin(workspaceSlug,email='admin@example.com',secret=password){const r=await call('post','/auth/login',null,{workspaceSlug,email,password:secret});assert.equal(r.status,200,r.body.message);return r.body.data;}
async function create(slug){const r=await call('post','/workspaces',null,{companyName:slug==='alpha-team'?'Alpha Company':'Beta Company',workspaceSlug:slug,email:'admin@example.com',password});assert.equal(r.status,200,r.body.message);return r.body.data;}

test('multiple workspaces preserve isolation across roles, queries, mutations and legacy migration',{timeout:240000},async t=>{
  const repl=await MongoMemoryReplSet.create({binary:{version:'7.0.24'},replSet:{count:1,storageEngine:'wiredTiger'}});
  t.after(async()=>{t.mock.timers.reset();await mongoose.disconnect();await repl.stop();});
  await mongoose.connect(repl.getUri('workspace_isolation'));await ensureIndexes();
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-02T05:00:00Z')});
  let alpha,beta,a,b,ha,hb,ea,eb,employeeA,employeeB,departmentA,departmentB,designationA,designationB;
  await t.test('independent creation remains available after a company exists and email uniqueness is scoped',async()=>{
    alpha=await create('alpha-team');beta=await create('beta-team');
    assert.notEqual(alpha.workspace.id,beta.workspace.id);
    assert.equal((await call('get','/setup-status')).body.data.workspaceCreationAvailable,true);
    assert.equal((await call('get','/setup-status')).body.data.initializationRequired,false);
    assert.equal((await call('post','/setup',null,{companyName:'Legacy',email:'legacy@example.com',password})).status,409);
    const duplicate=await call('post','/workspaces',null,{companyName:'Duplicate',workspaceSlug:'alpha-team',email:'other@example.com',password});
    assert.equal(duplicate.status,409);assert.equal(duplicate.body.errors[0].field,'workspaceSlug');
    assert.equal(await Company.countDocuments(),2);
    a=(await signin('alpha-team')).token;b=(await signin('beta-team')).token;
    const ambiguous=await call('post','/auth/login',null,{email:'admin@example.com',password});
    assert.equal(ambiguous.status,422);assert.equal(ambiguous.body.errors[0].field,'workspaceSlug');
    const me=await call('get','/auth/me',a);assert.equal(me.body.data.workspace.slug,'alpha-team');assert.equal(me.body.data.workspaceId,alpha.workspace.id);
    assert.equal((await call('post','/auth/login',null,{workspaceSlug:'unknown-team',email:'admin@example.com',password})).status,401);
  });
  await t.test('parallel requests keep workspace context and configuration separate',async()=>{
    const [ad,bd,ag,bg]=await Promise.all([
      call('post','/organization/units',a,{kind:'department',name:'Engineering'}),call('post','/organization/units',b,{kind:'department',name:'Engineering'}),
      call('post','/organization/units',a,{kind:'designation',name:'Engineer'}),call('post','/organization/units',b,{kind:'designation',name:'Engineer'}),
    ]);for(const r of [ad,bd,ag,bg])assert.equal(r.status,200,r.body.message);
    departmentA=ad.body.data._id;departmentB=bd.body.data._id;designationA=ag.body.data._id;designationB=bg.body.data._id;
    for(let i=0;i<8;i++){
      const [ra,rb]=await Promise.all([call('get','/organization',a),call('get','/organization',b)]);
      assert.equal(ra.body.data.company._id,alpha.workspace.id);assert.equal(rb.body.data.company._id,beta.workspace.id);
      assert(ra.body.data.units.every(u=>u.workspaceId===alpha.workspace.id));assert(rb.body.data.units.every(u=>u.workspaceId===beta.workspace.id));
    }
    assert.equal((await call('patch',`/organization/units/${departmentB}`,a,{name:'Stolen'})).status,404);
    assert.equal((await call('get','/organization',a).set('X-Workspace-Id',beta.workspace.id)).body.data.company._id,alpha.workspace.id);
    assert.equal((await call('get',`/employees?workspaceId=${beta.workspace.id}`,a)).status,422);
  });
  await t.test('HR and employee accounts, codes, email addresses and references are scoped',async()=>{
    for(const [admin,slug,departmentId,designationId,label]of [[a,'alpha-team',departmentA,designationA,'Alpha person'],[b,'beta-team',departmentB,designationB,'Beta person']]){
      const hr=await call('post','/users/hr',admin,{email:'hr@example.com'});assert.equal(hr.status,200,hr.body.message);
      const first=await signin(slug,'hr@example.com',hr.body.data.temporaryPassword);
      assert.equal((await call('post','/auth/change-password',first.token,{currentPassword:hr.body.data.temporaryPassword,newPassword:password})).status,200);
      const h=(await signin(slug,'hr@example.com')).token;
      const employee=await call('post','/employees',h,{code:'EMP001',email:'employee@example.com',name:label,departmentId,designationId,joiningDate:'2026-09-01',basicSalary:80000,status:'active'});
      assert.equal(employee.status,200,employee.body.message);
      const auth=await signin(slug,'employee@example.com',employee.body.data.temporaryPassword);
      assert.equal((await call('post','/auth/change-password',auth.token,{currentPassword:employee.body.data.temporaryPassword,newPassword:password})).status,200);
      const e=(await signin(slug,'employee@example.com')).token;
      if(slug==='alpha-team'){ha=h;ea=e;employeeA=employee.body.data.employee._id;}else{hb=h;eb=e;employeeB=employee.body.data.employee._id;}
    }
    const invalid=await call('post','/employees',ha,{code:'EMP002',email:'two@example.com',name:'Wrong reference',departmentId:departmentB,designationId:designationB,joiningDate:'2026-09-01',basicSalary:80000});assert.equal(invalid.status,422);
    assert.equal((await call('get',`/employees/${employeeB}`,a)).status,404);
    assert.equal((await call('get',`/employees/${employeeB}`,ea)).status,403);
    assert.equal((await call('patch',`/employees/${employeeB}`,ha,{phone:'stolen'})).status,404);
    assert.equal((await call('get','/employees',a)).body.data.items[0].name,'Alpha person');
    assert.equal((await call('get','/employees',b)).body.data.items[0].name,'Beta person');
    const foreignUser=(await call('get','/users',b)).body.data.items.find(u=>u.role==='Employee');
    assert.equal((await call('post',`/users/${foreignUser.id}/deactivate`,a,{})).status,403);
    assert.equal((await call('get','/auth/me',eb)).status,200);
  });
  await t.test('attendance, leave, corrections, notifications and exports never cross tenants',async()=>{
    assert.equal((await call('post','/attendance/check-in',ea,{})).status,200);
    assert.equal((await call('get','/attendance',hb)).body.data.total,0);
    const leave=await call('post','/leaves',ea,{type:'annual',start:'2026-11-03',end:'2026-11-03',reason:'Alpha leave'});assert.equal(leave.status,200,leave.body.message);
    assert.equal((await call('get','/leaves',hb)).body.data.total,0);
    assert.equal((await call('post',`/leaves/${leave.body.data._id}/decision`,hb,{decision:'approved',comment:'Foreign'})).status,404);
    assert.equal((await call('post',`/leaves/${leave.body.data._id}/decision`,ha,{decision:'approved',comment:'Approved'})).status,200);
    const correction=await call('post','/attendance/corrections',ea,{date:'2026-10-30',checkIn:'2026-10-30T09:00:00+05:00',checkOut:'2026-10-30T17:00:00+05:00',reason:'Alpha correction'});assert.equal(correction.status,200,correction.body.message);
    assert.equal((await call('post',`/attendance/corrections/${correction.body.data._id}/decision`,hb,{decision:'approved',comment:'Foreign'})).status,404);
    assert.equal((await call('get','/attendance/corrections',hb)).body.data.total,0);
    const notice=(await call('get','/notifications',ea)).body.data.items[0];assert(notice);
    assert.equal((await call('post',`/notifications/${notice._id}/read`,eb,{})).status,404);
    const exported=await call('get','/employees/export',ha);assert(exported.text.includes('Alpha person'));assert(!exported.text.includes('Beta person'));
    assert.equal((await call('get',`/leaves/balances/${employeeB}?year=2026`,a)).status,404);
  });
  await t.test('payroll month uniqueness, finalization revision locks and PDFs are workspace-specific',async()=>{
    const pa=await call('post','/payroll',ha,{month:'2026-10'});assert.equal(pa.status,200,pa.body.message);
    const pb=await call('post','/payroll',hb,{month:'2026-10'});assert.equal(pb.status,200,pb.body.message);
    assert.notEqual(pa.body.data._id,pb.body.data._id);
    assert(pa.body.data.slips.every(s=>s.employeeId===employeeA));assert(pb.body.data.slips.every(s=>s.employeeId===employeeB));
    assert.equal((await call('post','/announcements',b,{title:'Beta secret',body:'Only Beta can read this'})).status,200);
    assert.equal((await call('get','/announcements',a)).body.data.total,0);
    assert.equal((await call('post',`/payroll/${pa.body.data._id}/finalize`,a,{})).status,200);
    assert.equal((await call('get',`/payroll/${pb.body.data._id}`,a)).status,404);
    assert.equal((await call('post',`/payroll/${pb.body.data._id}/finalize`,a,{})).status,404);
    assert.equal((await call('get',`/payslips/${pb.body.data._id}/${employeeB}/pdf`,a)).status,404);
    assert.equal((await call('get','/payslips',eb)).body.data.length,0);
    const dashboard=await call('get','/dashboard?from=2026-10-01&to=2026-10-31',a);assert.equal(dashboard.status,200);assert.equal(dashboard.body.data.headcount,1);assert(!JSON.stringify(dashboard.body.data).includes('Beta secret'));
    const audits=await call('get','/audit-logs',a);assert(audits.body.data.items.every(row=>row.workspaceId===alpha.workspace.id));
    await call('post','/ai/chat',ea,{message:'My leave balance'});
    assert.equal(await withWorkspace(beta.workspace.id,()=>AiLog.countDocuments()),0);
    assert.equal(await withWorkspace(alpha.workspace.id,()=>AiLog.countDocuments()),1);
  });
  await t.test('model isolation fails closed and signed sessions cannot be reassigned by callers',async()=>{
    await assert.rejects(()=>Employee.find(),/Workspace context/);
    assert.equal(await withWorkspace(alpha.workspace.id,()=>Employee.countDocuments({workspaceId:beta.workspace.id})),0);
    assert.equal((await withWorkspace(beta.workspace.id,()=>Employee.updateOne({_id:employeeA},{$set:{name:'Changed'}}))).matchedCount,0);
    await assert.rejects(()=>withWorkspace(alpha.workspace.id,()=>Employee.updateOne({_id:employeeA},{$set:{workspaceId:beta.workspace.id}})),/ownership/);
    assert.deepEqual(await withWorkspace(alpha.workspace.id,()=>Employee.aggregate([{$match:{_id:new mongoose.Types.ObjectId(employeeB)}}])),[]);
    const claims=jwt.verify(a,process.env.JWT_SECRET,{issuer:'hcm-lite',audience:'hcm-api'});
    const wrong=jwt.sign({sub:claims.sub,sid:claims.sid,ver:claims.ver,workspaceId:beta.workspace.id},process.env.JWT_SECRET,{expiresIn:'1h',issuer:'hcm-lite',audience:'hcm-api'});
    assert.equal((await call('get','/auth/me',wrong)).status,401);
    assert.equal((await call('post','/auth/logout',a,{})).status,200);
    assert.equal((await call('get','/auth/me',a)).status,401);assert.equal((await call('get','/auth/me',b)).status,200);
  });
  await t.test('legacy migration preserves records, IDs, hashes and existing sessions, then permits duplicate emails in a new company',async()=>{
    await mongoose.disconnect();await mongoose.connect(repl.getUri('workspace_legacy_migration'));
    const adminId=new mongoose.Types.ObjectId(),employeeId=new mongoose.Types.ObjectId();
    const hash=await bcrypt.hash(password,12),createdAt=new Date('2026-01-01T00:00:00Z');
    const original={_id:'singleton',name:'Original company',policies:[{...policy.parse({}),effectiveDate:'0001-01-01'}],revision:4,lock:9};
    await Company.collection.insertOne(original);
    await User.collection.insertOne({_id:adminId,email:'admin@example.com',passwordHash:hash,role:'Admin',active:true,mustChangePassword:false,tokenVersion:7,createdAt});
    await Employee.collection.insertOne({_id:employeeId,code:'OLD001',email:'old@example.com',name:'Preserved employee',joiningDate:'2020-01-01',salaryHistory:[{effectiveDate:'2020-01-01',basicMinor:12345600}],employmentHistory:[{effectiveDate:'2020-01-01',status:'active'}],createdAt});
    await Announcement.collection.insertOne({title:'Original announcement',body:'Preserve this',createdAt});
    await Session.collection.insertOne({_id:'old-session',userId:adminId,expiresAt:new Date(Date.now()+3600000)});
    await User.collection.createIndex({email:1},{unique:true});await Employee.collection.createIndex({code:1},{unique:true});
    const before=await Employee.collection.findOne({_id:employeeId});
    await assert.rejects(()=>ensureIndexes(),/migration required/i);
    const result=await migrateWorkspaces({legacySlug:'original-company'});assert.equal(result.workspaceId,'singleton');
    const after=await Employee.collection.findOne({_id:employeeId});delete after.workspaceId;assert.deepEqual(after,before);
    assert.equal((await User.collection.findOne({_id:adminId})).passwordHash,hash);
    assert.equal((await Company.findById('singleton')).name,original.name);
    assert.equal((await Company.findById('singleton')).revision,4);
    const oldToken=jwt.sign({sub:String(adminId),sid:'old-session',ver:7},process.env.JWT_SECRET,{expiresIn:'1h',issuer:'hcm-lite',audience:'hcm-api'});
    assert.equal((await call('get','/auth/me',oldToken)).status,200);
    assert.equal((await signin('original-company')).user.workspace.id,'singleton');
    const again=await migrateWorkspaces({legacySlug:'ignored-on-repeat'});assert(Object.values(again.assigned).every(count=>count===0));
    await create('new-company');
    assert.equal(await Company.countDocuments(),2);
    assert.equal((await call('get','/employees',oldToken)).body.data.items[0]._id,String(employeeId));
    for(const model of tenantModels)assert(!(await model.collection.indexes()).some(index=>index.unique&&index.name!=='_id_'&&!('workspaceId'in index.key)));
  });
});
