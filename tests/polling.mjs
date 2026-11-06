import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const output=ts.transpileModule(fs.readFileSync('lib/polling.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const timers=new Map();let id=0;
const context={exports:{},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key)};
vm.runInNewContext(output,context);
const {pollSequentially}=context.exports;
let resolve,reject,calls=0;const results=[],errors=[];
const stop=pollSequentially(()=>{calls++;return new Promise((yes,no)=>{resolve=yes;reject=no;});},v=>results.push(v),e=>errors.push(e));
assert.equal(calls,1);assert.equal(timers.size,0,'Do not schedule another request until this one settles');
resolve('confirmed');await new Promise(setImmediate);
assert.deepEqual(results,['confirmed']);assert.equal(timers.size,1);
const next=timers.values().next().value;timers.clear();next();
reject(new Error('offline'));await new Promise(setImmediate);
assert.equal(errors.length,1);assert.equal(timers.size,1,'Retry after a failure');
const retry=timers.values().next().value;timers.clear();retry();stop();resolve('stale');await new Promise(setImmediate);
assert.deepEqual(results,['confirmed'],'Ignore an in-flight result after cancellation/unmount');assert.equal(timers.size,0);
console.log('PASS serial polling, failure recovery, cleanup, and stale-response suppression');

const listeners = new Set();
const delays = [];
const page = {
  hidden: true,
  addEventListener: (_, listener) => listeners.add(listener),
  removeEventListener: (_, listener) => listeners.delete(listener),
};
const background = {
  exports: {}, document: page,
  setTimeout: (fn, delay) => { delays.push(delay); timers.set(++id, fn); return id; },
  clearTimeout: key => timers.delete(key),
};
vm.runInNewContext(output, background);
let backgroundCalls = 0;
let fail = true;
const cleanup = background.exports.pollSequentially(async () => {
  backgroundCalls++;
  if (fail) throw new Error('service restricted');
  return 'ready';
}, () => {}, () => {});
assert.equal(backgroundCalls, 0, 'Hidden tabs do not fetch');
page.hidden = false;
for (const listener of listeners) listener();
await new Promise(setImmediate);
assert.equal(backgroundCalls, 1);
assert.equal(delays.at(-1), 60000, 'Failures back off');
let scheduled = timers.values().next().value; timers.clear(); scheduled();
await new Promise(setImmediate);
assert.equal(delays.at(-1), 120000, 'Repeated failures increase retry delay');
page.hidden = true;
for (const listener of listeners) listener();
assert.equal(timers.size, 0, 'Backgrounding cancels scheduled requests');
fail = false; page.hidden = false;
for (const listener of listeners) listener();
await new Promise(setImmediate);
assert.equal(delays.at(-1), 30000, 'Success restores normal refresh interval');
cleanup();
assert.equal(listeners.size, 0);
assert.equal(timers.size, 0);
console.log('PASS hidden-tab suspension, foreground recovery, error backoff and listener cleanup');
