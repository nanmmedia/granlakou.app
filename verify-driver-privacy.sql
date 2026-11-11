begin;
create temporary table privacy_test as select gen_random_uuid() as business,gen_random_uuid() as day,gen_random_uuid() as old_day,gen_random_uuid() as driver,gen_random_uuid() as other_driver,gen_random_uuid() as order_staff;
insert into auth.users(id,email,email_confirmed_at) select x,'privacy-rollback-'||x||'@example.invalid',now() from privacy_test t cross join lateral unnest(array[t.driver,t.other_driver,t.order_staff]) x;
insert into public.bjta_businesses(id,name) select business,'Privacy rollback fixture' from privacy_test;
insert into public.bjta_staff(business_id,user_id,display_name,roles,active) select business,x,'Fixture driver',array['driver'],true from privacy_test t cross join lateral unnest(array[t.driver,t.other_driver]) x;
insert into public.bjta_staff(business_id,user_id,display_name,roles,active) select business,order_staff,'Fixture multi-role',array['driver','order_staff'],true from privacy_test;
select set_config('request.jwt.claim.sub',driver::text,true) from privacy_test;
insert into public.bjta_days(id,business_id,delivery_date,kitchen_address,archived) select day,business,current_date,'Fixture kitchen',false from privacy_test union all select old_day,business,current_date-1,'Fixture kitchen',true from privacy_test;
insert into public.bjta_deliveries(day_id,details,status,claimed_by,paid,payment_method)
 select day,'{"name":"Unclaimed","address":"Fixture","price":777,"qty":1,"fee":555,"items":[{"name":"Fixture","qty":1,"price":777}]}'::jsonb,'ready',null::uuid,false,null::text from privacy_test
 union all select day,'{"name":"Own current","address":"Fixture","price":25,"qty":1,"fee":5}'::jsonb,'in_progress',driver,false,null from privacy_test
 union all select day,'{"name":"Hidden other current","address":"Fixture","price":900,"qty":1}'::jsonb,'in_progress',other_driver,false,null from privacy_test
 union all select day,'{"name":"Hidden other sale","address":"Fixture","price":800,"qty":1}'::jsonb,'delivered',other_driver,true,'Cash' from privacy_test
 union all select day,'{"name":"Own completed","address":"Fixture","price":20,"qty":1}'::jsonb,'delivered',driver,true,'Zelle' from privacy_test
 union all select old_day,'{"name":"Hidden history","address":"Fixture","price":9001,"qty":1}'::jsonb,'delivered',driver,true,'Cash' from privacy_test;
insert into public.bjta_events(day_id,actor_id,action) select day,driver,'own_current_action' from privacy_test union all select day,other_driver,'hidden_other_action' from privacy_test union all select old_day,driver,'hidden_historical_action' from privacy_test;
insert into public.gldd_products(business_id,name,unit_price) select business,'Hidden catalog',123 from privacy_test;
-- Tighten policies inside this rollback transaction to test before rollout.
-- Apply after the frontend supports gldd_driver_day.
alter policy staff_read_days on public.bjta_days using (gldd_private.has_business_role(business_id,array['business_admin','order_staff']));
alter policy staff_read_deliveries on public.bjta_deliveries using (gldd_private.has_day_role(day_id,array['business_admin','order_staff']));
alter policy staff_read_events on public.bjta_events using (gldd_private.has_day_role(day_id,array['business_admin','order_staff']));
alter policy business_product_read on public.gldd_products using (gldd_private.has_business_role(business_id,array['business_admin','order_staff']));
alter policy staff_reads_handoffs on public.gldd_handoffs using (gldd_private.has_day_role(day_id,array['business_admin','order_staff']) or (auth.uid() in(from_user,to_user,requested_by) and gldd_private.has_day_role(day_id,array['driver'])));
do $$declare payload jsonb;ready jsonb;begin select public.gldd_driver_day(business) into payload from privacy_test;if jsonb_array_length(payload->'days')<>1 or jsonb_array_length(payload->'rows')<>3 or jsonb_array_length(payload->'events')<>1 then raise exception 'Driver scope failed';end if;if payload::text like '%Hidden%' or payload::text like '%hidden_other_action%' or payload::text like '%hidden_historical_action%' then raise exception 'Other staff data leaked';end if;select x into ready from jsonb_array_elements(payload->'rows') x where x->'details'->>'name'='Unclaimed';if ready->'details' ? 'price' or ready->'details' ? 'fee' or ready->'details'->'items'->0 ? 'price' then raise exception 'Unclaimed amount leaked';end if;if not exists(select 1 from jsonb_array_elements(payload->'rows') x where x->'details'->>'name'='Own current' and x->'details'->>'price'='25') then raise exception 'Own collection amount missing';end if;end$$;
set local role authenticated;
do $$begin if exists(select 1 from public.bjta_days) or exists(select 1 from public.bjta_deliveries) or exists(select 1 from public.bjta_events) or exists(select 1 from public.gldd_products) then raise exception 'Driver raw-table data leaked';end if;end$$;
reset role;
select set_config('request.jwt.claim.sub',order_staff::text,true) from privacy_test;
set local role authenticated;
do $$begin if (select count(*) from public.bjta_days)<>2 or (select count(*) from public.bjta_deliveries)<>6 or (select count(*) from public.bjta_events)<>3 or (select count(*) from public.gldd_products)<>1 then raise exception 'Multi-role account lost full order access';end if;end$$;
reset role;
select 'PASS: driver active-day rows only, own activity only, own collection amounts available, unclaimed amounts redacted, raw tables blocked, multi-role order access preserved; all fixtures rolled back' as verification;
rollback;
