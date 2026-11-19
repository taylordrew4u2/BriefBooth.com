import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=ts.createSourceFile('component.tsx',fs.readFileSync('components/recovery-google-connection.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const component=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='RecoveryGoogleConnection');
const code=ts.transpileModule(component.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText.replace(/^export /m,'');
const flush=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const nodes=value=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.props?.children)];
const text=value=>Array.isArray(value)?value.map(text).join(' '):value&&typeof value==='object'?text(value.props?.children):String(value??'');
function harness(recoveryApi,query=''){
 const state=[{enabled:true,connected:true,revision:0},'',false,0],effects=[],refs=[],navigated=[],replaced=[];let si=0,ri=0;
 const context={URL,AbortController,Error,callbackMessages:{cancelled:'Connection cancelled.'},recoveryApi,Button:'Button',
  React:{createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'fragment'},
  window:{location:{href:'https://briefbooth.com/studio/'+query,assign:url=>navigated.push(url)},history:{replaceState:(_a,_b,url)=>replaced.push(url)}},
  useState:initial=>{const i=si++;if(!(i in state))state[i]=initial;return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},
  useRef:initial=>{const i=ri++;return refs[i]??={current:initial};},useEffect:fn=>effects.push(fn),
 };
 const renderFn=vm.runInNewContext(code+';RecoveryGoogleConnection',context);
 function render(){si=0;ri=0;effects.length=0;return renderFn({token:'current-owner-session'});}
 const button=()=>nodes(render()).find(n=>n.type==='Button'&&text(n).includes('Reconnect Google'));
 return {state,effects,refs,navigated,replaced,render,button};
}
// The current owner session completes the staged grant, not a token or account
// supplied in the return URL. Only successful server completion shows success.
{
 const calls=[];const h=harness(async(path,options)=>{calls.push({path,options});return path==='google-status'?{enabled:true,connected:true,revision:1}:{connected:true,revision:1};},'?google=pending&token=untrusted');
 h.render();h.effects[1]();await flush();
 assert.deepEqual(calls.map(x=>x.path),['google-complete','google-status']);
 assert.ok(calls.every(x=>x.options.token==='current-owner-session'));
 assert.match(h.state[1],/Google is reconnected/);assert.equal(h.state[0].revision,1);
 assert.ok(h.replaced.every(x=>!x.includes('google=pending')));
}
{
 const paths=[];const h=harness(async path=>{paths.push(path);if(path==='google-complete')throw Error('Candidate account does not match.');return {enabled:true,connected:true,revision:0};},'?google=pending');h.state[0]=null;h.render();h.effects[1]();await flush();
 assert.doesNotMatch(h.state[1],/Google is reconnected/);assert.equal(h.replaced.length,0);
 assert.deepEqual(paths,['google-complete','google-status']);assert.match(h.state[1],/does not match/);assert.ok(h.button(),'Failed completion must leave reconnect available');
}
// An account unmount cannot show a late completion or navigate the next user's
// browser. Duplicate clicks create only one state/authorization attempt.
{
 const wait=deferred();let calls=0;
 const h=harness(async()=>{calls++;return wait.promise;});const cleanup=(()=>{h.render();return h.effects[0]();})();
 const button=h.button();const first=button.props.onClick(),second=button.props.onClick();assert.equal(calls,1);
 cleanup();wait.resolve({url:'https://accounts.google.com/o/oauth2/v2/auth?state=opaque'});await Promise.all([first,second]);
 assert.equal(h.navigated.length,0);
}
{
 const wait=deferred();const h=harness(()=>wait.promise,'?google=pending');h.render();const cleanup=h.effects[1]();cleanup();wait.resolve({connected:true,revision:1});await flush();
 assert.equal(h.state[1],'');assert.equal(h.replaced.length,0);
}
for(const url of ['https://evil.invalid/oauth','https://accounts.google.com.evil.invalid/o/oauth2/v2/auth','https://accounts.google.com/other','https://user@accounts.google.com/o/oauth2/v2/auth']){
 const h=harness(async()=>({url}));await h.button().props.onClick();assert.equal(h.navigated.length,0);assert.match(h.state[1],/invalid connection address/);
}
{
 const url='https://accounts.google.com/o/oauth2/v2/auth?state=opaque';const h=harness(async()=>({url}));await h.button().props.onClick();assert.deepEqual(h.navigated,[url]);
 h.state[0].enabled=false;assert.equal(h.button(),undefined);
}
console.log('PASS Google reconnect UI: verified-session completion, failed/stale results, duplicate-click lock, aborted navigation and destination validation');
