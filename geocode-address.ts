import {createClient} from 'npm:@supabase/supabase-js@2.102.0';
import {geocodeAddress} from './geocode.mjs';
const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!;
Deno.serve((req:Request)=>geocodeAddress(req,{caller:(authorization:string)=>createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})}));
