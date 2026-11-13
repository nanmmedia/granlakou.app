const {test}=require('node:test');const assert=require('node:assert/strict');const planner=require('./route-planner.js');
const matrix=positions=>positions.map(a=>positions.map(b=>Math.abs(a-b)*60));const entries=(cDeadline='01:00')=>[{i:1,d:{id:'priority',priority:true,deadline:'00:20'}},{i:2,d:{id:'nearby',priority:false,deadline:''}},{i:3,d:{id:'north',priority:true,deadline:cDeadline}}];
test('priority, nearby neighbor, then north when deadlines allow',()=>{const p=planner.planBatch(entries(),matrix([0,10,11,30]));assert.deepEqual(p.route.map(x=>x.d.id),['priority','nearby','north']);assert.equal(p.late.length,0);});
test('tight northern deadline takes precedence over nearby stop',()=>{const p=planner.planBatch(entries('00:36'),matrix([0,10,11,30]));assert.deepEqual(p.route.map(x=>x.d.id),['priority','north','nearby']);assert.equal(p.late.length,0);});
test('impossible deadline is flagged instead of promised',()=>{const p=planner.planBatch([{i:1,d:{id:'late',deadline:'00:05'}}],matrix([0,20]));assert.equal(p.late.length,1);});
test('planned proximity order survives priority sorting',()=>{const list=[{id:'north',priority:true,routeOrder:2},{id:'neighbor',priority:false,routeOrder:1},{id:'first',priority:true,routeOrder:0}];list.sort(planner.compareRemaining);assert.deepEqual(list.map(x=>x.id),['first','neighbor','north']);});
test('unreachable roads fail without a fabricated duration',()=>assert.throws(()=>planner.planBatch([{i:1,d:{}}],[[0,null],[null,0]]),/reachable/));
test('round-trip driving includes return to kitchen',()=>{const p=planner.planBatch([{i:1,d:{}}],matrix([0,10]));assert.equal(p.drive,1200);});
let geocodeAddress,censusCandidates;test('load alternate lookup',async()=>{({geocodeAddress,censusCandidates}=await import('./geocode.mjs'));});
const census={result:{addressMatches:[{matchedAddress:'1234 EXAMPLE TEST CT, INDIANAPOLIS, IN, 46214',coordinates:{x:-86.29,y:39.82}}]}};
test('range match preserves matching house number and marks accuracy',()=>{const r=censusCandidates(census,'1234 Example Test Ct Indianapolis IN 46214');assert.equal(r.length,1);assert.equal(r[0].accuracy,'address-range');assert.equal(censusCandidates(census,'1236 Example Test Ct Indianapolis IN 46214').length,0);});
test('out-of-area alternate result is rejected',()=>{assert.equal(censusCandidates({result:{addressMatches:[{matchedAddress:'1234 EXAMPLE TEST CT',coordinates:{x:1,y:1}}]}},'1234 Example Test Ct').length,0);});
function lookupFixture(roles=['order_staff']){let called=false;const deps={caller:()=>({auth:{getUser:async()=>({data:{user:{id:'STAFF'}}})},rpc:async()=>({data:{memberships:[{business_id:'BIZ',roles}]}})}),fetcher:async()=>{called=true;return {ok:true,json:async()=>census};}};return {deps,get called(){return called;}};}
function req(){return new Request('https://example.invalid',{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify({business:'BIZ',address:'1234 Example Test Ct Indianapolis IN 46214'})});}
test('order staff can use fixed alternate provider',async()=>{const f=lookupFixture();const r=await geocodeAddress(req(),f.deps);assert.equal(r.status,200);assert.equal((await r.json()).matches.length,1);});
test('driver cannot use order-entry lookup endpoint',async()=>{const f=lookupFixture(['driver']);assert.equal((await geocodeAddress(req(),f.deps)).status,403);assert.equal(f.called,false);});
test('unauthenticated lookup never contacts provider',async()=>{const f=lookupFixture();assert.equal((await geocodeAddress(new Request('https://example.invalid',{method:'POST'}),f.deps)).status,401);assert.equal(f.called,false);});
test('leg distances follow A to B to C, never reset to kitchen',()=>{const durations=matrix([0,10,11,30]),distances=durations.map(row=>row.map(x=>x*1609.344/60));const legs=planner.legs([{i:2},{i:3}],distances,durations,1,'current_stop');assert.deepEqual(legs.map(x=>Math.round(x.miles)),[1,19]);assert.deepEqual(legs.map(x=>x.kind),['current_stop','previous_stop']);});
test('replanning selects current then last completed stop for the same route',()=>{const stops=[{id:'done',driver:1,status:'delivered',completedAt:'2026-11-11T12:00:00Z'},{id:'old',driver:1,status:'delivered',completedAt:'2026-11-11T11:00:00Z'},{id:'other',driver:2,status:'in_progress'},{id:'active',driver:1,status:'in_progress'}];assert.equal(planner.startForRoute(stops,1).id,'active');assert.equal(planner.startForRoute(stops.filter(x=>x.id!=='active'),1).id,'done');assert.equal(planner.startForRoute([],1),null);});
test('missing leg estimate fails rather than displaying zero',()=>assert.throws(()=>planner.legs([{i:1}],[[0,null]],[[0,60]],0,'kitchen'),/no road estimate/));

test('second driver starts farthest from the first driver’s recent stops',()=>{
  const points={current:{lat:0,lon:0},recent:{lat:0,lon:5},nearRecent:{lat:0,lon:6},far:{lat:0,lon:-4}};
  const orders=[{address:'current',status:'in_progress',driver:1,startedAt:'2026-11-13T12:00:00Z'},{address:'recent',status:'delivered',driver:1,completedAt:'2026-11-13T11:00:00Z'}];
  const candidates=[{address:'nearRecent'},{address:'far'}];
  assert.equal(planner.secondDriverStart(candidates,orders,address=>points[address],null).address,'far');
});

test('replanning honors the second driver’s assigned first stop',()=>{
  const entries=[{i:1,d:{id:'near'}},{i:2,d:{id:'first'}}];
  assert.equal(planner.planBatch(entries,matrix([0,1,10]),{firstId:'first'}).route[0].d.id,'first');
});
