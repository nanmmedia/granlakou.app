'use strict';
// Only a successful server verification can display the thank-you state.
async function confirmInvitation({search,replaceUrl,createClient,config,show}){
 const params=new URLSearchParams(search),token=params.get('token_hash'),type=params.get('type');
 replaceUrl();
 if(!token||type!=='invite')return show(false,'This confirmation link is incomplete. Request a fresh invitation from your workspace administrator.');
 try{
  if(!config?.supabaseUrl||!config?.supabasePublishableKey)throw Error('Configuration unavailable');
  const client=await createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const {data,error}=await client.auth.verifyOtp({token_hash:token,type:'invite'});
  if(error||!data?.user?.email_confirmed_at||!data?.session)throw Error('Verification failed');
  show(true,'Your email is confirmed. You’re ready to continue to your delivery workspace.');
 }catch{show(false,'This link may have expired or already been used. If you confirmed your email before, sign in with a fresh email code. Otherwise, ask your administrator to resend your invitation.');}
}
if(typeof module!=='undefined')module.exports={confirmInvitation};
if(typeof document!=='undefined')confirmInvitation({
 search:location.search,replaceUrl:()=>history.replaceState(null,'',location.pathname),config:window.BJTA_CONFIG,
 createClient:async(...args)=>{const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.102.0/+esm');return createClient(...args);},
 show:(ok,message)=>{document.querySelector('#confirmationTitle').textContent=ok?'Thank you!':'Let’s get you signed in.';document.querySelector('#confirmationMessage').textContent=message;const link=document.querySelector('#confirmationContinue');link.hidden=false;link.textContent=ok?'Continue to my workspace →':'Go to sign-in →';}
});
