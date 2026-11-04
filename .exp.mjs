import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,'')];}));
const sb=createClient(env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
const out={};
for(let from=0;;from+=1000){const {data,error}=await sb.from('wf_docs').select('col,id,data').range(from,from+999);if(error)throw error;data.forEach(r=>{(out[r.col]=out[r.col]||{})[r.id]=r.data;});if(data.length<1000)break;}
delete out._backup; for(const k of Object.keys(out)) if(k.startsWith('_')) delete out[k];
fs.writeFileSync('.data-live-export.json',JSON.stringify(out));console.log(Object.fromEntries(Object.entries(out).map(([k,v])=>[k,Object.keys(v).length])));
