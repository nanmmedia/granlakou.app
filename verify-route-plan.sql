begin;
create temporary table route_fixture as select gen_random_uuid() as business,gen_random_uuid() as day,gen_random_uuid() as a,gen_random_uuid() as b,gen_random_uuid() as driver,(select user_id from gldd_private.app_owner limit 1) as owner;
select set_config('request.jwt.claim.sub',owner::text,true) from route_fixture;
insert into public.bjta_businesses(id,name) select business,'Route rollback fixture' from route_fixture;
insert into public.bjta_days(id,business_id,delivery_date,kitchen_address) select day,business,current_date,'Example kitchen' from route_fixture;
insert into public.bjta_deliveries(id,day_id,details) select a,day,'{"name":"Fixture A","address":"Example A","phone":"original","priority":false,"deadline":"","location":{"lat":39.8,"lon":-86.2},"items":[{"name":"Example","qty":2,"price":10}]}'::jsonb from route_fixture union all select b,day,'{"name":"Fixture B","address":"Example B"}'::jsonb from route_fixture;
create temporary table route_payload as select jsonb_agg(jsonb_build_object('id',d.id,'expected',d.details,'routing',jsonb_build_object('driver',1,'routeOrder',case when d.id=f.a then 0 else 1 end,'routeLeg',jsonb_build_object('miles',1.2,'seconds',180,'kind','previous_stop'),'estimatedArrival','12:00 PM','lateEstimate',false))) as plan from public.bjta_deliveries d join route_fixture f on d.day_id=f.day;
-- Simulate an unrelated edit after the planner captured its input.
update public.bjta_deliveries set details=details||'{"phone":"updated","fee":7}'::jsonb where id=(select a from route_fixture);
select public.gldd_save_route_plan(day,(select plan from route_payload)) from route_fixture;
do $$begin if not exists(select 1 from public.bjta_deliveries where id=(select a from route_fixture) and details->>'phone'='updated' and details->>'fee'='7' and details#>>'{items,0,qty}'='2' and details#>>'{routeLeg,miles}'='1.2') then raise exception 'Route overwrote order fields';end if;end$$;
-- A stale second stop must roll back a change attempted on the first stop too.
update public.bjta_deliveries set details=details||'{"address":"Changed B"}'::jsonb where id=(select b from route_fixture);
update route_payload set plan=jsonb_set(plan,'{0,routing,routeOrder}','9');
do $$declare before_rows jsonb;after_rows jsonb;begin select jsonb_agg(to_jsonb(d) order by id) into before_rows from public.bjta_deliveries d where day_id=(select day from route_fixture);begin perform public.gldd_save_route_plan((select day from route_fixture),(select plan from route_payload));raise exception 'Stale plan accepted';exception when others then if sqlerrm not like '%Routing inputs changed%' then raise;end if;end;select jsonb_agg(to_jsonb(d) order by id) into after_rows from public.bjta_deliveries d where day_id=(select day from route_fixture);if before_rows<>after_rows then raise exception 'Partial route saved';end if;end$$;
select set_config('request.jwt.claim.sub',driver::text,true) from route_fixture;
do $$begin begin perform public.gldd_save_route_plan((select day from route_fixture),(select plan from route_payload));raise exception 'Driver planned route';exception when others then if sqlerrm not like '%Order access required%' then raise;end if;end;end$$;
select 'PASS: route-only merge preserves edits; stale plan rolls back every stop; access denied without order membership; rollback-only fixtures' as verification;
rollback;
