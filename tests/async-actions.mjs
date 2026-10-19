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
  return vm.runInNewContext(`${js.replace(/^export /gm, "")}; ${name}`,context);
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

// A refresh and approval share a synchronous lock, including rapid repeated clicks.
for (const first of ['refreshBookings','reviewRequest']) {
  let resolve;
  let calls=0;
  const request=()=>{calls++; return new Promise(r=>{resolve=r;});};
  const context={bookingAction:{current:false},setRefreshing(){},setBusy(){},setMessage(){},setNow(){},setBookings(){},uid:'owner',
    db:()=>({rpc:request,from:()=>({select:()=>({eq:()=>({order:request})})})})};
  const refresh=handler('app/studio/page.tsx','refreshBookings',context);
  const review=handler('app/studio/page.tsx','reviewRequest',context);
  const pending=first==='refreshBookings'?refresh():review('booking',true);
  await refresh(); await review('booking',false);
  assert.equal(calls,1,'Overlapping refresh/review must not start another request');
  resolve({data:first==='refreshBookings'?[]:'confirmed',error:null}); await pending;
  assert.equal(context.bookingAction.current,false,'The lock must release after success');
}
for(const outcome of ['reject','invalid','confirmed','declined']) {
  const busy=[],messages=[],updates=[];
  const context={bookingAction:{current:false},setBusy:v=>busy.push(v),setMessage:v=>messages.push(v),setNow(){},setBookings:v=>updates.push(v),
    db:()=>({rpc:async()=>{if(outcome==='reject') throw Error('offline'); return {data:outcome==='invalid'?null:outcome,error:null};}})};
  await handler('app/studio/page.tsx','reviewRequest',context)('booking',outcome!=='declined');
  assert.equal(context.bookingAction.current,false);
  assert.deepEqual(busy,[true,false]);
  assert.equal(updates.length,['confirmed','declined'].includes(outcome)?1:0);
  if(outcome==='invalid'||outcome==='reject') assert.match(messages.at(-1),/Couldn’t/);
}
console.log('PASS booking refresh/review exclusion, rapid actions, approval/decline, invalid response, and failure recovery');

const validToken='11111111-1111-4111-8111-111111111111';
for(const outcome of ['success','invalid','reject']) {
  const flags=[],messages=[],routes=[],requests=[];
  let resolve, reject;
  const context={submittingRequest:{current:false},busy:false,demo:false,service:{id:'service'},slot:'2026-11-01T15:00:00Z',intake:{name:'Client',email:'client@example.com'},meetingMode:'zoom',answers:{},bookingRequest:{current:null},
    crypto:{randomUUID:()=>validToken},URL,Error,
    setSubmitting:v=>flags.push(v),setMessage:v=>messages.push(v),
    window:{location:{origin:'https://briefbooth.com',assign:v=>routes.push(v)}},
    db:()=>({rpc:(_name,params)=>{requests.push(params);return new Promise((yes,no)=>{resolve=yes;reject=no;});}})};
  const submit=handler('components/booking-client.tsx','submit',context);
  const pending=submit(); await submit();
  assert.equal(requests.length,1,'Rapid booking clicks must only submit once');
  if(outcome==='reject') reject(Error('offline')); else resolve({data:outcome==='invalid'?null:validToken,error:null});
  await pending;
  assert.equal(context.submittingRequest.current,false);
  assert.deepEqual(flags,[true,false]);
  assert.equal(routes.length,outcome==='success'?1:0,'Invalid or failed booking must not redirect');
  if(outcome!=='success') {
    assert(messages.at(-1));
    const retry=submit(); resolve({data:validToken,error:null}); await retry;
    assert.equal(requests[0].p_request,requests[1].p_request,'Retry must reuse the same idempotency key');
  }
}
console.log('PASS client submission: rapid clicks, invalid response, network failure, and safe retry');
for(const selection of [{service:null,day:''},{service:{id:'service'},day:''}]) {
  const flags=[],slots=[],selected=[];
  await handler('components/booking-client.tsx','load',{...selection,live:true,setSlots:v=>slots.push(v),setSlot:v=>selected.push(v),setBusy:v=>flags.push(v)})();
  assert.deepEqual(flags,[false],'Clearing the date/service must release slot loading');
  assert.equal(slots[0].length,0); assert.deepEqual(selected,['']);
}
console.log('PASS clearing consultation/date resets stale slots and releases loading');
for (const outcome of ['success','reject']) {
  const requests=[], routes=[], messages=[];
  let resolve, reject;
  const context={submittingRequest:{current:false},busy:false,demo:false,service:{id:'service',amount_cents:500},slot:'2026-11-01T15:00:00Z',intake:{name:'Client',email:'client@example.com'},meetingMode:'zoom',answers:{},bookingRequest:{current:null},crypto:{randomUUID:()=>validToken},Error,
    setSubmitting:()=>{},setMessage:v=>messages.push(v),priceBreakdown:()=>({total:546}),stripeRedirect:url=>routes.push(url),
    paymentAction:(_action,args)=>{requests.push(args);return new Promise((yes,no)=>{resolve=yes;reject=no;});},db:()=>{throw Error('Paid booking bypassed checkout');}};
  const submit=handler('components/booking-client.tsx','submit',context);
  const pending=submit();await submit();assert.equal(requests.length,1);
  if(outcome==='reject')reject(Error('offline'));else resolve({url:'https://checkout.stripe.com/c/pay/test'});
  await pending;assert.equal(context.submittingRequest.current,false);assert.equal(requests[0].expected_total,546);
  assert.equal(routes.length,outcome==='success'?1:0);
  if(outcome==='reject'){const retry=submit();resolve({url:'https://checkout.stripe.com/c/pay/test'});await retry;assert.equal(requests[0].booking.p_request,requests[1].booking.p_request);}
}
const redirectRoutes=[];
const redirect=handler('lib/payments.ts','stripeRedirect',{URL,Error,window:{location:{assign:url=>redirectRoutes.push(url)}}});
for(const bad of [null,'javascript:alert(1)','https://evil.example/','https://stripe.com.evil.example/','https://user@checkout.stripe.com/'])assert.throws(()=>redirect(bad));
redirect('https://checkout.stripe.com/c/pay/example');assert.equal(redirectRoutes.length,1);
console.log('PASS paid checkout amount, rapid-click guard, retry identity and Stripe-only redirects');
