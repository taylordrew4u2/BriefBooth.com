'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Logo} from '@/components/site-header';
import {db,configured} from '@/lib/supabase';
import styles from '../client/client.module.css';
export default function Logout(){
 const started=useRef(false);
 const [consultant,setConsultant]=useState(false);
 const [state,setState]=useState<'busy'|'done'|'error'>('busy');
 const signOut=useCallback(async()=>{
  setState('busy');
  setConsultant(new URLSearchParams(window.location.search).get('from')==='consultant');
  try {
   if(configured){const {error}=await db().auth.signOut({scope:'local'});if(error)throw error;}
   localStorage.removeItem('briefbooth_client_login');
   setState('done');
  }catch{setState('error');}
 },[]);
 useEffect(()=>{if(started.current)return;started.current=true;void signOut();},[signOut]);
 return <><header className="simple-header"><Logo/><Link href="/">Home ↗</Link></header><main id="main" className={styles.page}><div className={styles.heading}><div><h1>{state==='done'?'You’re signed out.':state==='error'?'Let’s try that again.':'Signing you out…'}</h1><p role="status">{state==='done'?(consultant?'Your booking page and client information are saved. Sign in again to manage your studio.':'Your bookings and answers are saved. Sign back in whenever you need them.'):state==='error'?'We couldn’t finish signing you out. Check your connection and try again.':'Closing your session on this browser.'}</p></div></div>{state==='done'?<><Link className={styles.action} href={consultant?"/account/":"/client/"}>{consultant?"Back to consultant sign-in":"Back to client sign-in"} →</Link><p><Link href="/">Return to BriefBooth home</Link></p></>:state==='error'?<button className={styles.action} onClick={()=>void signOut()}>Try signing out again</button>:null}</main></>;
}
