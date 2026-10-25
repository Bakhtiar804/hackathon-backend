import { test as nodeTest } from 'node:test';
import { withWorkspace } from '../src/middleware/tenant.js';
export function test(name, options, operation) {
  if(typeof options==='function'){operation=options;options={};}
  return nodeTest(name,options,t=>withWorkspace('singleton',()=>operation(t)));
}
