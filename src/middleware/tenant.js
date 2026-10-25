import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from '../utils/errors.js';

export const tenantContext = new AsyncLocalStorage();
export const withWorkspace = (workspaceId, operation) => tenantContext.run({ workspaceId }, async () => await operation());
export function workspaceId() {
  const id = tenantContext.getStore()?.workspaceId;
  if (typeof id !== 'string' || !id) throw new AppError(401, 'Workspace context is required');
  return id;
}

// Defense in depth for every business model. HTTP context is established only
// after verifying the signed session and its database owner, never from headers.
export function tenantSchema(schema) {
  schema.add({ workspaceId: { type: String, required: true, immutable: true, index: true } });
  schema.pre('validate', function () {
    const id = workspaceId();
    if (this.workspaceId && this.workspaceId !== id) throw new AppError(403, 'Workspace access denied');
    this.workspaceId = id;
  });
  schema.pre('save', function () {
    if (this.workspaceId !== workspaceId()) throw new AppError(403, 'Workspace access denied');
  });
  schema.pre(/^(find|count|distinct|update|delete|replace)/, function () {
    const id = workspaceId();
    const filter = this.getFilter();
    this.setQuery({ $and: [filter, { workspaceId: id }] });
    const update = this.getUpdate?.();
    if (update) {
      if (Array.isArray(update)) throw new AppError(422, 'Update pipelines are not supported');
      if (update.workspaceId || update.$set?.workspaceId || update.$unset?.workspaceId || update.$rename?.workspaceId) throw new AppError(403, 'Workspace ownership cannot be changed');
      if (this.op.startsWith('replace') || this.op === 'findOneAndReplace') this.setUpdate({ ...update, workspaceId: id });
      else if (this.getOptions().upsert) this.setUpdate({ ...update, $setOnInsert: { ...update.$setOnInsert, workspaceId: id } });
    }
  });
  schema.pre('estimatedDocumentCount', function () { throw new AppError(403, 'Use a workspace-scoped count'); });
  schema.pre('aggregate', function () {
    if (this.pipeline().some(stage => ['$lookup', '$unionWith', '$graphLookup', '$out', '$merge'].some(key => key in stage))) throw new AppError(403, 'Cross-collection aggregation is not supported');
    this.pipeline().unshift({ $match: { workspaceId: workspaceId() } });
  });
  schema.pre('insertMany', function (next, docs) {
    try {
      const id = workspaceId();
      for (const doc of docs) {
        if (doc.workspaceId && doc.workspaceId !== id) throw new AppError(403, 'Workspace access denied');
        doc.workspaceId = id;
      }
      next();
    } catch (error) { next(error); }
  });
  // Application writes use scoped create/save/query operations, not raw bulk APIs.
  schema.pre('bulkWrite', function () { throw new AppError(403, 'Use workspace-scoped document operations'); });
}

