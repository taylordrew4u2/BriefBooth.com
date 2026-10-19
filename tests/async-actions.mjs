import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real event-handler functions with rejected/resolved backend calls.
// No browser credentials, production writes, or provider calls are involved.
function handler(file, name, context) {
  const source = ts.createSourceFile(file, fs.readFileSync(file,'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) { if(ts.isFunctionDeclaration(node) && node.name?.text === name) found=node; ts.forEachChild(node,visit); }
  visit(source); assert(found, `Missing handler ${name}`);
  const js=ts.transpileModule(found.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return vm.runInNewContext(`${js}; ${name}`,context);
}
const cases=[['components/manage-client.tsx','cancel'],['app/studio/page.tsx','addService'],['app/studio/page.tsx','saveHours'],['app/account/page.tsx','savePassword']];
for(const [file,name] of cases) {
  for(const reject of [true,false]) {
    const busy=[],messages=[],bookings=[],routes=[];
    const result={data:name==='cancel'?true:{id:'new'},error:null};
    const request=()=>reject?Promise.reject(new Error('network interrupted')):Promise.resolve(result);
    const context={
      db:()=>({rpc:request,auth:{updateUser:request},from:()=>({insert:()=>({select:()=>({single:request})})})}),
      setBusy:value=>busy.push(value),setMessage:value=>messages.push(value),
      setBooking:value=>bookings.push(value),setConfirm:()=>{},setTab:()=>{},
      setServices:()=>{},setAdding:()=>{},setSavedHours:()=>{},
      token:'test-token',booking:{status:'confirmed'},savedProfile:{slug:'demo'},uid:'owner',services:[],
      hours:[{enabled:true,weekday:1,start_time:'09:00',end_time:'17:00'}],
      router:{push:path=>routes.push(path)},
      FormData:class {get(key){return {password:'test-only-placeholder',title:'Consultation',description:'Test',duration:'30',meeting_modes:'zoom'}[key];}},
    };
    await handler(file,name,context)({preventDefault(){},currentTarget:{}});
    assert.deepEqual(busy,[true,false],`${name} must release busy after ${reject?'failure':'success'}`);
    if(reject) {
      assert(messages.at(-1).length>10,`${name} needs actionable feedback`);
      assert.equal(bookings.length,0,'Failure must not report cancelled');
      assert.equal(routes.length,0,'Failure must not navigate to success');
    } else if(name==='cancel') assert.equal(bookings[0].status,'cancelled');
    else if(name==='savePassword') assert.deepEqual(routes,['/studio']);
  }
}
console.log('PASS real cancel, add-consultation, availability, and recovery handlers: rejection releases busy, no false success, successful requests complete');

for (const name of ['saveTimezone','toggleService','savePaymentPreferences']) {
  for (const outcome of ['success','reject','missing']) {
    const busy=[],messages=[],writes=[],services=[];
    const context={
      profile:{timezone:'America/New_York',payment_methods:['Cash App'],payment_notes:'Ask first',published:false,slug:'unsaved-draft'},
      savedProfile:{slug:'live-profile'},uid:'owner',
      setBusy:value=>busy.push(value),setMessage:value=>messages.push(value),setTab:()=>{},setServices:value=>services.push(value),
      db:()=>({from:table=>({update:values=>{
        writes.push({table,values});
        const chain={eq:()=>chain,select:()=>chain,single:async()=>{
          if(outcome==='reject') throw new Error('offline');
          return {data:outcome==='missing'?null:{id:'saved'},error:outcome==='missing'?{message:'No row'}:null};
        }};return chain;
      }})}),
    };
    await handler('app/studio/page.tsx',name,context)(name==='toggleService'?{id:'service',active:true}:{preventDefault(){}});
    assert.deepEqual(busy,[true,false]);
    if(name==='savePaymentPreferences') assert.deepEqual(Object.keys(writes[0].values).sort(),['payment_methods','payment_notes'],'Payment save must not publish profile drafts');
    if(outcome!=='success') {
      assert.match(messages.at(-1),/Couldn’t/);
      assert.equal(services.length,0,'Failed visibility update must not change local state');
    }
  }
}
console.log('PASS scoped payment saves, timezone and visibility: success, offline, and missing-row responses');
for (const [result,expected] of [[{data:{connected:true},error:null},'connected'],[{data:{connected:false},error:null},'disconnected'],[{data:null,error:{message:'offline'}},'error'],[{data:{},error:null},'error']]) {
  const states=[];
  await handler('components/zoom-connection.tsx','loadStatus',{active:true,db:()=>({rpc:async()=>result}),setStatus:value=>states.push(value)})();
  assert.deepEqual(states,[expected]);
}
const states=[];
await handler('components/zoom-connection.tsx','loadStatus',{active:true,db:()=>({rpc:async()=>{throw new Error('offline');}}),setStatus:value=>states.push(value)})();
assert.deepEqual(states,['error']);
console.log('PASS Zoom connection distinguishes connected, disconnected, invalid response, and network errors');
