import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real event-handler functions with rejected/resolved backend calls.
// No browser credentials, production writes, or provider calls are involved.
function handler(file, name, context) {
  const source = ts.createSourceFile(file, fs.readFileSync(file,'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if(ts.isFunctionDeclaration(node) && node.name?.text === name) found=node;
    if(ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === 'useCallback') {
      const callback=node.initializer.arguments[0];
      if(callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) found=callback;
    }
    ts.forEachChild(node,visit);
  }
  visit(source); assert(found, `Missing handler ${name}`);
  const definition=ts.isFunctionDeclaration(found)?found.getText(source):`const ${name} = ${found.getText(source)};`;
  const js=ts.transpileModule(definition,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return vm.runInNewContext(`${js.replace(/^export /gm, "")}; ${name}`,context);
}
const cases=[['components/manage-client.tsx','cancel'],['app/studio/page.tsx','addService'],['app/studio/page.tsx','saveHours'],['app/account/page.tsx','savePassword']];
for(const [file,name] of cases) {
  for(const reject of [true,false]) {
    const busy=[],messages=[],bookings=[],routes=[];
    const result={data:name==='cancel'?true:{id:'new'},error:null};
    const request=()=>reject?Promise.reject(new Error('network interrupted')):Promise.resolve(result);
    const context={
      db:()=>({rpc:rpcName=>rpcName==='account_role'?Promise.resolve({data:'consultant',error:null}):request(),auth:{updateUser:request},from:()=>({insert:()=>({select:()=>({single:request})})})}),
      setBusy:value=>busy.push(value),setMessage:value=>messages.push(value),
      setBooking:value=>bookings.push(value),setConfirm:()=>{},setTab:()=>{},
      setServices:()=>{},setAdding:()=>{},setSavedHours:()=>{},editing:null,setEditing:()=>{},
      token:'test-token',booking:{status:'confirmed'},savedProfile:{slug:'demo'},uid:'owner',services:[],
      hours:[{enabled:true,weekday:1,start_time:'09:00',end_time:'17:00'}],
      router:{push:path=>routes.push(path),replace:path=>routes.push(path)},
      localStorage:{getItem:()=>null,removeItem:()=>{}},
      URLSearchParams,window:{location:{search:''}},
      FormData:class {get(key){return {password:'test-only-placeholder',title:'Consultation',description:'Test',duration:'30',meeting_modes:'zoom'}[key];}},
    };
    if(name==='savePassword') context.routeAccount=handler(file,'routeAccount',context);
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

// Recovery must use the real account-role callback rather than assuming every
// verified account is a consultant. A recent client-booth intent also stays client-side.
for(const outcome of ['consultant','client','client-intent','role-error','role-reject']) {
  const busy=[],messages=[],routes=[],roleCalls=[],storageRemovals=[];
  const context={
    db:()=>({auth:{updateUser:async()=>({error:null})},rpc:async name=>{
      roleCalls.push(name);
      if(outcome==='role-reject') throw new Error('network interrupted');
      return outcome==='role-error'?{data:null,error:{message:'Role lookup failed'}}:{data:outcome==='client'?'client':'consultant',error:null};
    }}),
    setBusy:value=>busy.push(value),setMessage:value=>messages.push(value),
    router:{replace:path=>routes.push(path)},
    URLSearchParams,window:{location:{search:''}},
    localStorage:{getItem:key=>key==='briefbooth_client_login' && outcome==='client-intent'?String(Date.now()):null,removeItem:key=>storageRemovals.push(key)},
    FormData:class {get(){return 'test-only-placeholder';}},
  };
  context.routeAccount=handler('app/account/page.tsx','routeAccount',context);
  await handler('app/account/page.tsx','savePassword',context)({preventDefault(){},currentTarget:{}});
  assert.deepEqual(busy,[true,false],`${outcome} recovery must release its busy state`);
  assert.deepEqual(roleCalls,['account_role'],'Recovery checks the immutable backend account role after saving');
  if(outcome.startsWith('role-')) {
    assert.deepEqual(routes,[],'A failed account-role lookup must not guess a successful destination');
    assert(messages.at(-1).length>10,'Account routing failures need actionable feedback');
    assert.deepEqual(storageRemovals,[],'A failed lookup preserves the client-booth sign-in intent');
  } else {
    assert.deepEqual(routes,[outcome==='consultant'?'/studio':'/client']);
    assert.deepEqual(storageRemovals,['briefbooth_client_login'],'Successful routing consumes the one-time client-booth intent');
  }
}
console.log('PASS recovery routing follows verified account roles and client intent; failed role lookups do not redirect');


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
  const context={profile:null,visit:{current:null},submittingRequest:{current:false},busy:false,demo:false,service:{id:'service'},slot:'2026-11-01T15:00:00Z',intake:{name:'Client',email:'client@example.com'},meetingMode:'zoom',answers:{},bookingRequest:{current:null},
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
  const context={profile:null,visit:{current:null},submittingRequest:{current:false},busy:false,demo:false,service:{id:'service',amount_cents:500},slot:'2026-11-01T15:00:00Z',intake:{name:'Client',email:'client@example.com'},meetingMode:'zoom',answers:{},bookingRequest:{current:null},crypto:{randomUUID:()=>validToken},Error,
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

// Base UI defaults to type=button; forms need explicit native submit semantics.
for (const [file,label] of [['components/reschedule-booking.tsx','Request new time'],['components/booking-operations.tsx','Save outcome & notes']]) {
  const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let button;
  function visit(node) {
    if(ts.isJsxElement(node)&&node.children.some(child=>ts.isJsxText(child)&&child.text.trim()===label)) button=node.openingElement;
    ts.forEachChild(node,visit);
  }
  visit(source);
  assert(button,`Missing ${label} button`);
  const type=button.attributes.properties.find(attr=>ts.isJsxAttribute(attr)&&attr.name.text==='type');
  assert.equal(type?.initializer?.text,'submit',`${label} must trigger the form handler`);
}
console.log('PASS rescheduling and appointment notes retain native form submission');

// Run the actual owner-review refresh effect after an action. A background read
// may fail independently of a successful mutation, or succeed after a rejection.
function reviewRefresh(context) {
  const file='components/recovery-client.tsx';
  const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const component=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='RecoveryReview');
  const effect=component.body.statements.find(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(source)==='useEffect'&&node.expression.arguments[1]?.getText(source)==='[token, refresh]');
  assert(effect,'Missing owner-review refresh effect');
  const js=ts.transpileModule(`const refreshEffect=${effect.expression.arguments[0].getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return vm.runInNewContext(`${js};refreshEffect`,context)();
}
function reviewContext(api) {
  const original={id:'booking',status:'confirmed',starts_at:'2026-11-16T15:00:00Z',ends_at:'2026-11-16T15:30:00Z',client_email:'client@example.com',meet_url:'https://meet.google.com/abc-defg-hij',email_pending:true,email_failed:true};
  const state={bookings:[original,{id:'other',status:'pending_approval'}],error:'',actionError:'',busy:false,loaded:true,refresh:0,notice:''};
  const context={api,token:'test-only-owner-key',lock:{current:false},visiblePages:{current:1},AbortController,
    message:error=>error.message,notificationStatus:()=> 'Notification status',
    setBookings:value=>{state.bookings=typeof value==='function'?value(state.bookings):value;},
    setError:value=>{state.error=value;},setActionError:value=>{state.actionError=value;},
    setBusy:value=>{state.busy=value;},setLoaded:value=>{state.loaded=value;},
    setNextCursor:()=>{},setDeclineId:()=>{},
    setNotificationNotice:value=>{state.notice=value;},
    setRefresh:value=>{state.refresh=typeof value==='function'?value(state.refresh):value;},
  };
  return {state,context,original};
}
for(const result of ['pending','confirmed']) {
  const startsAt='2026-11-17T16:00:00Z';
  const operationId='test-reschedule-operation';
  const response={booking:{id:'booking',status:'confirmed',starts_at:result==='pending'?'2026-11-16T15:00:00Z':startsAt,ends_at:result==='pending'?'2026-11-16T15:30:00Z':'2026-11-17T16:30:00Z',meet_url:'https://meet.google.com/abc-defg-hij',reschedule:result==='pending'?{operation_id:operationId,starts_at:startsAt,ends_at:'2026-11-17T16:30:00Z',state:'applying'}:null},...(result==='confirmed'?{email_pending:false,email_failed:false,email_queued:false,email_uncertain:false}:{})};
  const {state,context}=reviewContext(async path=>{if(path==='reschedule')return response;throw Error('Request refresh is unavailable');});
  assert.equal(await handler('components/recovery-client.tsx','reschedule',context)('booking',startsAt,operationId),true);
  assert.equal(state.bookings[0].starts_at,response.booking.starts_at,'Known mutation results appear before a follow-up read');
  assert.equal(state.bookings[0].client_email,'client@example.com','The client-safe mutation response must preserve owner-only email data');
  assert.equal(state.bookings[1].id,'other','Updating one booking preserves other requests');
  assert.equal(state.bookings[0].email_pending,result==='pending','Omitted delivery flags are preserved; explicit false clears stale flags');
  assert.equal(state.bookings[0].email_failed,result==='pending');
  const cleanup=reviewRefresh(context);await new Promise(setImmediate);cleanup();
  assert.equal(state.error,'Request refresh is unavailable');
  assert.equal(state.bookings[0].reschedule?.operation_id,result==='pending'?operationId:undefined,'A failed read must preserve the pending operation so it can be finished');
  assert.equal(state.bookings[0].starts_at,response.booking.starts_at,'A failed read must not revert a confirmed new time');
  assert.equal(state.bookings[0].meet_url,response.booking.meet_url,'The existing Meet link is retained');
  assert.equal(state.busy,false);assert.equal(context.lock.current,false);
}
for(const failure of ['That time is no longer available','Google could not finish the time change']) {
  const {state,context,original}=reviewContext(async path=>{if(path==='reschedule')throw Error(failure);return {bookings:[original],next_cursor:null};});
  assert.equal(await handler('components/recovery-client.tsx','reschedule',context)('booking','2026-11-17T16:00:00Z','test-operation'),false);
  const cleanup=reviewRefresh(context);await new Promise(setImmediate);cleanup();
  assert.equal(state.actionError,failure,'A successful refresh must not erase the rejected action explanation');
  assert.equal(state.error,'');assert.equal(state.loaded,true);
  assert.equal(state.bookings[0].starts_at,original.starts_at,'A rejected move must leave the original time unchanged');
  assert.equal(state.busy,false);assert.equal(context.lock.current,false);
}
console.log('PASS owner rescheduling: pending/confirmed mutation survives failed refresh, owner contact and email flags are preserved, rejection feedback survives successful refresh');
