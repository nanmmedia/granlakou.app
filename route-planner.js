'use strict';
var RoutePlanner=(()=>{
 const deadline=value=>/^\d{2}:\d{2}$/.test(value||'')?Number(value.slice(0,2))*3600+Number(value.slice(3))*60:null;
 function compareRemaining(a,b){const ar=Number.isFinite(a.routeOrder)&&a.routeOrder<999,br=Number.isFinite(b.routeOrder)&&b.routeOrder<999;if(ar||br)return(ar?a.routeOrder:999)-(br?b.routeOrder:999);return Number(b.priority)-Number(a.priority)||(a.deadline||'99:99').localeCompare(b.deadline||'99:99');}
 function planBatch(entries,durations,{start=0,end=0,departure=0,service=180,firstId=null}={}){
  if(!entries.length)return {route:[],arrivals:[],late:[],drive:0};
  const edge=(a,b)=>Number.isFinite(durations[a]?.[b])?durations[a][b]:Infinity;
  function evaluate(route){let at=start,clock=departure,drive=0,priorityWait=0,lateSeconds=0;const arrivals=[],late=[];for(const entry of route){const leg=edge(at,entry.i);drive+=leg;clock+=leg;arrivals.push(clock);const limit=deadline(entry.d.deadline);if(limit!==null&&clock+service>limit){late.push(entry);lateSeconds+=clock+service-limit;}if(entry.d.priority)priorityWait+=clock-departure;clock+=service;at=entry.i;}const beforeReturn=drive;drive+=edge(at,end);return {route,arrivals,late,drive,score:[late.length,lateSeconds,drive+beforeReturn*.15+priorityWait*.05]};}
  const better=(a,b)=>!b||a.score.some((v,i)=>v<b.score[i]&&a.score.slice(0,i).every((x,j)=>Math.abs(x-b.score[j])<.01));
  const first=entries.find(entry=>entry.d.id===firstId);const seeds=entries.filter(entry=>entry!==first).sort((a,b)=>(deadline(a.d.deadline)??Infinity)-(deadline(b.d.deadline)??Infinity)||Number(b.d.priority)-Number(a.d.priority)||edge(start,a.i)-edge(start,b.i));let best=evaluate(first?[first]:[]);if(!Number.isFinite(best.drive))throw Error('The first stop has no reachable road route.');
  for(const entry of seeds){let inserted=null;for(let pos=first?1:0;pos<=best.route.length;pos++){const route=[...best.route];route.splice(pos,0,entry);const candidate=evaluate(route);if(Number.isFinite(candidate.drive)&&better(candidate,inserted))inserted=candidate;}if(!inserted)throw Error('An address has no reachable road route.');best=inserted;}
  for(let round=0;round<8;round++){let improved=best;for(let a=first?1:0;a<best.route.length-1;a++)for(let b=a+1;b<best.route.length;b++){const route=[...best.route.slice(0,a),...best.route.slice(a,b+1).reverse(),...best.route.slice(b+1)],candidate=evaluate(route);if(Number.isFinite(candidate.drive)&&better(candidate,improved))improved=candidate;}if(improved===best)break;best=improved;}
  return best;
 }
 function startForRoute(deliveries,driver){const same=deliveries.filter(d=>Number(d.driver)===driver),latest=(list,key)=>list.sort((a,b)=>String(b[key]||'').localeCompare(String(a[key]||'')))[0];return latest(same.filter(d=>d.status==='in_progress'),'startedAt')||latest(same.filter(d=>d.status==='delivered'),'completedAt')||null;}
 function legs(route,distances,durations,start,origin){let from=start;return route.map(entry=>{const meters=distances[from]?.[entry.i],seconds=durations[from]?.[entry.i];if(!Number.isFinite(meters)||!Number.isFinite(seconds)||meters<0||seconds<0)throw Error('A route leg has no road estimate.');const leg={miles:meters/1609.344,seconds,kind:from===start?origin:'previous_stop'};from=entry.i;return leg;});}
 function secondDriverStart(candidates, deliveries, pointForAddress, kitchen) {
  const recent = deliveries.filter(d => d.orderType !== 'pickup' && Number(d.driver) === 1 &&
    ['in_progress', 'delivered'].includes(d.status)).sort((a, b) =>
      String(b.completedAt || b.startedAt || '').localeCompare(String(a.completedAt || a.startedAt || ''))).slice(0, 3);
  const anchors = recent.length ? recent.map(d => pointForAddress(d.address)).filter(Boolean) : [kitchen].filter(Boolean);
  if (!anchors.length) return null;
  let best = null, bestDistance = -1;
  for (const candidate of candidates) {
   const point = pointForAddress(candidate.address);
   if (!point) continue;
   const distance = Math.min(...anchors.map(anchor => Math.hypot(
     point.lat - anchor.lat, (point.lon - anchor.lon) * Math.cos(anchor.lat * Math.PI / 180))));
   if (distance > bestDistance) { best = candidate; bestDistance = distance; }
  }
  return best;
 }
 function clockLabel(seconds){const mins=Math.round(seconds/60),hours=Math.floor(mins/60)%24,m=mins%60;return `${hours%12||12}:${String(m).padStart(2,'0')} ${hours>=12?'PM':'AM'}${mins>=1440?' (next day)':''}`;}
 return {secondDriverStart,startForRoute,legs,planBatch,compareRemaining,clockLabel,deadline};
})();
if(typeof module!=='undefined')module.exports=RoutePlanner;
