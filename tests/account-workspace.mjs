import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {observeAccountSession} from '../lib/account-session.ts';
import {recoveryOwnerId,isRecoveryOwnerWorkspace} from '../lib/account-routing.ts';

const flush=()=>new Promise(setImmediate);
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

// Exercise real identity verification across old-token responses, logout, token
// refresh and account switching. Cached session identity is never authoritative.
{
 const seen=[],checks=[];let callback,cached={access_token:'token-a',user:{id:'a'}},unsubscribed=false;
 const stop=observeAccountSession({getSession:async()=>({data:{session:cached}}),getUser:token=>{const check=deferred();checks.push({token,...check});return check.promise;},onAuthStateChange:fn=>{callback=fn;return {data:{subscription:{unsubscribe(){unsubscribed=true;}}}};}},session=>seen.push(session));
 await flush();assert.equal(checks[0].token,'token-a');
 cached={access_token:'token-b',user:{id:'b'}};callback('SIGNED_IN');assert.equal(seen.at(-1).userId,null);assert.equal(seen.at(-1).accessToken,'');await tick();
 checks[0].resolve({data:{user:{id:'a',email:'a@example.invalid'}}});await flush();assert.equal(seen.at(-1).userId,null);
 checks[1].resolve({data:{user:{id:'b',email:'b@example.invalid'}}});await flush();assert.equal(seen.at(-1).userId,'b');assert.equal(seen.at(-1).accessToken,'token-b');
 callback('TOKEN_REFRESHED');await tick();callback('SIGNED_OUT');assert.equal(seen.at(-1).accessToken,'');checks[2].resolve({data:{user:{id:'b',email:'b@example.invalid'}}});await flush();assert.equal(seen.at(-1).userId,null);
 cached={access_token:'mismatch',user:{id:'claimed'}};callback('SIGNED_IN');await tick();checks[3].resolve({data:{user:{id:'actual'}}});await flush();assert.equal(seen.at(-1).userId,null,'Mismatched verified token cannot enter another account');
 stop();const count=seen.length;callback('SIGNED_IN');assert.equal(seen.length,count);assert.equal(unsubscribed,true);
}

function findFunction(file,name,within){const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node;ts.forEachChild(node,visit);}visit(within?source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===within):source);assert(found,`Missing ${name}`);return {source,node:found};}
function executeFunction(file,name,context,within){const {source,node}=findFunction(file,name,within);const code=ts.transpileModule(node.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText.replace(/^export /m,'');return vm.runInNewContext(`${code};${name}`,context);}
const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'fragment'};
const treeNodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(treeNodes):[node,...treeNodes(node.props?.children)];
const content=node=>Array.isArray(node)?node.map(content).join(' '):node&&typeof node==='object'?content(node.props?.children):String(node??'');

// Run the real Studio selection. The owner mounts session-backed D1 controls,
// while other identities retain their existing tenant-isolated Studio loader.
{
 const state={checked:true,userId:recoveryOwnerId};const context={React,configured:true,useState:()=>[state,()=>{}],useEffect:()=>{},isRecoveryOwnerWorkspace,RecoveryReview:'RecoveryReview',LegacyStudio:'LegacyStudio'};
 const route=executeFunction('app/studio/page.tsx','StudioIntent',context);
 assert.equal(route().type,'RecoveryReview');state.userId='other-consultant';assert.equal(route().type,'LegacyStudio');state.checked=false;assert.match(content(route()),/Checking your account/);
}

function clientHarness(overrides={}){
 const state=[[],null,true,false,'','',0,null],effects=[],refs=[];let stateIndex=0,refIndex=0;
 const context={React,Link:'Link',Button:'Button',IntakeEditor:'IntakeEditor',AbortController,Map,Date,
  labels:{confirmed:'Confirmed',cancelled:'Cancelled',pending_approval:'Awaiting approval'},date:value=>value,
  useState:value=>{const index=stateIndex++;if(!(index in state))state[index]=value;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];},
  useRef:value=>{const index=refIndex++;return refs[index]??=( {current:value} );},useEffect:effect=>effects.push(effect),...overrides};
 const component=executeFunction('components/account-bookings.tsx','ClientBookings',context);
 function render(){stateIndex=0;refIndex=0;effects.length=0;return component({token:'verified-session',email:'verified@example.invalid'});}
 return {state,effects,context,render,refs};
}
// Actual parallel load combines both sources, retains correct management links,
// and discards late rows after account unmount. No recovery capability is needed.
{
 const current=deferred(),legacy=deferred();let requestOptions;
 const h=clientHarness({recoveryApi:(path,options)=>{assert.equal(path,'client-bookings');requestOptions=options;return current.promise;},db:()=>({rpc:()=>({abortSignal:()=>legacy.promise})})});
 h.render();const cleanup=h.effects[1]();await flush();
 current.resolve({bookings:[{id:'new',title:'Current',status:'confirmed',starts_at:'2099-01-01',meeting_url:'https://meet.google.com/abc-defg-hij'}],next_cursor:'next'});legacy.resolve({data:[{id:'old',title:'Earlier',status:'confirmed',starts_at:'2098-01-01',manage_token:'legacy-token'}]});await flush();
 assert.equal(requestOptions.token,'verified-session');assert.equal(h.state[0].length,2);assert.equal(h.state[1],'next');assert.equal(h.state[2],false);
 const nodes=treeNodes(h.render());assert.ok(nodes.some(node=>node.props?.href==='/manage/legacy-token/'));assert.ok(nodes.some(node=>node.props?.href==='https://meet.google.com/abc-defg-hij'));assert.ok(!nodes.some(node=>String(node.props?.href||'').includes('#token=')));assert.match(content(h.render()),/Cancel booking/);cleanup();
 const delayed=deferred();const stale=clientHarness({recoveryApi:()=>delayed.promise,db:()=>({rpc:()=>({abortSignal:async()=>({data:[]})})})});stale.render();const stop=stale.effects[1]();stop();delayed.resolve({bookings:[{id:'previous-user'}],next_cursor:null});await flush();assert.equal(stale.state[0].length,0,'Unmounted old account cannot display late bookings');
 const partial=clientHarness({recoveryApi:async()=>{throw Error('Unavailable');},db:()=>({rpc:()=>({abortSignal:async()=>({data:[{id:'old',title:'Earlier'}]})})})});partial.render();partial.effects[1]();await flush();assert.equal(partial.state[0][0].source,'supabase');assert.match(partial.state[4],/Current 4u Digital bookings could not be loaded/);
}
// Run the actual client cancellation handler, checking session authorization and
// source isolation when legacy and recovery rows happen to share an identifier.
{
 const rows=[{id:'same',source:'recovery',status:'confirmed'},{id:'same',source:'supabase',status:'confirmed'}];let body,notice;
 const context={AbortController,token:'verified-session',lock:{current:false},action:{current:null},setBusy:()=>{},setError:()=>{},setNotice:value=>{notice=value;},setConfirm:()=>{},setBookings:fn=>{rows.splice(0,rows.length,...fn(rows));},recoveryApi:async(path,options)=>{assert.equal(path,'cancel');assert.equal(options.token,'verified-session');body=options.body;return {booking:{id:'same',status:'cancelled'}};}};
 await executeFunction('components/account-bookings.tsx','cancel',context)('same');assert.equal(body.bookingId,'same');assert.equal(rows[0].status,'cancelled');assert.equal(rows[1].status,'confirmed');assert.equal(notice,'Your booking is cancelled.');
}
// Execute the real settings form submission: CAS revision and only editable
// public fields are sent; identity, credentials and legacy settings are absent.
{
 const values=new Map(Object.entries({name:'4u Digital',headline:'Consultations',bio:'About',timezone:'America/New_York','svc-title':'Consultation','svc-description':'Description','svc-duration':'30','svc-active':'on','day-1':'on','start-1':'09:00','end-1':'17:00',notice_hours:'2',horizon_days:'30',buffer_minutes:'15'}));let body,saved,notice;
 const settings={revision:7,config:{services:[{id:'svc'}]}};
 const context={FormData:class{get(key){return values.get(key);}has(key){return values.has(key);}},settings,saving:false,token:'verified-owner',days:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],AbortController,action:{current:null},setSaving:()=>{},setError:()=>{},setNotice:value=>{notice=value;},setSettings:value=>{saved=value;},recoveryApi:async(path,options)=>{assert.equal(path,'owner-config');assert.equal(options.token,'verified-owner');body=options.body;return {config:{},revision:8,calendar:{configured:true}};}};
 await executeFunction('components/recovery-owner-settings.tsx','save',context)({preventDefault(){},currentTarget:{}});
 assert.equal(body.revision,7);assert.equal(body.profile.name,'4u Digital');assert.deepEqual(Object.keys(body.profile).sort(),['bio','headline','name','timezone']);assert.equal(body.services[0].id,'svc');assert.equal(body.availability.length,1);assert.equal(body.availability[0].weekday,1);assert.equal(saved.revision,8);assert.match(notice,/Existing appointments are unchanged/);assert.ok(!JSON.stringify(body).includes('secret'));
}
// A public form carries the configuration it displayed. A stale response clears
// availability and requires a deliberate reload, while retry identity survives
// a revision-only change so an ambiguous earlier save cannot create a duplicate.
{
 const values=new Map(Object.entries({name:'Client',email:'client@example.invalid',notes:'Project'})),calls=[];let result;
 const context={FormData:class{get(key){return values.get(key);}},crypto,config:{revision:7},configConflict:false,slot:'2099-01-01T15:00:00Z',serviceId:'service',projectQuestion:null,submitLock:{current:false},request:{current:null},setSubmitting:()=>{},setError:()=>{},setResult:value=>{result=value;},setConfigConflict:value=>{context.configConflict=value;},setSlot:value=>{context.slot=value;},setSlots:()=>{},setChecking:()=>{},message:error=>error.message,
  api:async(path,options)=>{assert.equal(path,'book');calls.push(options.body);if(calls.length===1)throw Object.assign(Error('Reload booking details'),{code:'config_changed'});return {token:'saved',status:'pending_approval'};}};
 const submit=executeFunction('components/recovery-client.tsx','submit',context,'RecoveryBooking');await submit({preventDefault(){},currentTarget:{}});
 assert.equal(calls.length,1);assert.equal(calls[0].configRevision,7);assert.equal(context.configConflict,true);assert.equal(context.slot,'');assert.equal(result,undefined);
 context.config.revision=8;context.configConflict=false;context.slot='2099-01-01T15:00:00Z';await submit({preventDefault(){},currentTarget:{}});
 assert.equal(calls[1].configRevision,8);assert.equal(calls[1].requestId,calls[0].requestId);assert.equal(result.status,'pending_approval');
}
console.log('PASS unified account workspace: verified-session races, owner routing, combined source-correct history, late-response isolation, session cancellation, revisioned settings and stale public forms');
