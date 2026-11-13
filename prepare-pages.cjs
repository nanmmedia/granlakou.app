// Copy only public browser assets. Never publish the project directory wholesale.
const fs=require('node:fs');const path=require('node:path');
const root=__dirname,out=path.join(root,'pages');
fs.mkdirSync(out,{recursive:true});
const assets=['index.html','confirmed.html','confirm.js','style.css','config.js','app.js','contact-fields.js','workspace-ui.js','day-summary.js','customer-messages.js','workflow.js','shared.js','handoff.js','route-planner.js','address-tools.js','auth.js','navigation-ui.js','order-days.js','receipt-pdf.js','_headers','robots.txt'];
for(const name of assets)fs.copyFileSync(path.join(root,name),path.join(out,name));
for(const name of fs.readdirSync(out)){if(!assets.includes(name))throw Error('Unexpected public asset: '+name);}
console.log('Cloudflare Pages files ready in pages/');