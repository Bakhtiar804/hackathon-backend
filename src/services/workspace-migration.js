import mongoose from 'mongoose';
import { Company, tenantModels, ensureIndexes } from '../models/index.js';
import { workspaceSlug as slugSchema } from '../validators/index.js';

// Offline, explicit migration. Never called by HTTP routes or ordinary startup.
export async function migrateWorkspaces({ legacySlug = 'legacy' } = {}) {
  legacySlug=slugSchema.parse(legacySlug);
  const companies=await Company.collection.find({}).toArray();
  const unassigned=[];
  for(const model of tenantModels) if(await model.collection.findOne({workspaceId:null},{projection:{_id:1}})) unassigned.push(model);
  let legacy=companies.find(c=>c._id==='singleton') || (companies.length===1?companies[0]:null);
  if(unassigned.length && !legacy) throw new Error('Cannot safely assign unscoped records: select/review their company manually before migration. No records changed.');
  const missingSlug=companies.filter(c=>!c.slug);
  if(missingSlug.length>1) throw new Error('Multiple companies lack workspace addresses; review assignments manually. No records changed.');
  if(missingSlug.length===1) {
    legacy=missingSlug[0];
    if(companies.some(c=>c._id!==legacy._id && c.slug===legacySlug)) throw new Error('The requested legacy workspace address is already in use. No records changed.');
  }
  const counts={};
  await mongoose.connection.transaction(async session=> {
    if(legacy && !legacy.slug) await Company.collection.updateOne({_id:legacy._id,slug:null},{$set:{slug:legacySlug}},{session});
    if(legacy) for(const model of tenantModels) {
      const result=await model.collection.updateMany({workspaceId:null},{$set:{workspaceId:String(legacy._id)}},{session});
      counts[model.modelName]=result.modifiedCount;
    }
  });
  // Add replacement constraints before removing old global uniqueness. Application
  // traffic must be quiesced while running this command, including old releases.
  await Promise.all([Company.createIndexes(), ...tenantModels.map(model=>model.createIndexes())]);
  const dropped=[];
  for(const model of tenantModels) {
    const indexes=await model.collection.indexes();
    for(const index of indexes) if(index.unique && index.name!=='_id_' && !('workspaceId' in index.key)) {
      await model.collection.dropIndex(index.name);
      dropped.push(`${model.modelName}.${index.name}`);
    }
  }
  await ensureIndexes();
  return {workspaceId:legacy?String(legacy._id):null,workspaceSlug:legacy?.slug || (legacy?legacySlug:null),assigned:counts,replacedIndexes:dropped};
}
