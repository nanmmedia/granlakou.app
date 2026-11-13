-- Save only route fields, atomically, after rechecking the routing inputs.
create or replace function gldd_private.save_route_plan(day uuid, plan jsonb) returns void language plpgsql security definer set search_path='' as $$
declare kitchen text; item jsonb; row_data public.bjta_deliveries; expected jsonb; routing jsonb;
begin
 if auth.uid() is null or not gldd_private.has_day_role(day,array['business_admin','order_staff']) then raise exception 'Order access required';end if;
 select kitchen_address into kitchen from public.bjta_days where id=day and not archived for update;
 if not found then raise exception 'Active delivery day required';end if;
 if jsonb_typeof(plan) is distinct from 'array' or jsonb_array_length(plan) not between 1 and 39 then raise exception 'Invalid route plan';end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(plan) x)<>jsonb_array_length(plan) then raise exception 'Duplicate route stops';end if;
 perform 1 from public.bjta_deliveries d where d.day_id=day and d.id in(select (x->>'id')::uuid from jsonb_array_elements(plan) x) order by d.id for update;
 for item in select value from jsonb_array_elements(plan) loop
  if item ? 'kitchen' and item->>'kitchen' is distinct from kitchen then raise exception 'Kitchen changed; plan again'; end if;
  select * into row_data from public.bjta_deliveries d where d.id=(item->>'id')::uuid and d.day_id=day;
  if not found or row_data.status<>'ready' or row_data.details->>'orderType'='pickup' then raise exception 'A route stop was started, completed, or removed';end if;
  expected=item->'expected';routing=item->'routing';
  if row_data.details->'address' is distinct from expected->'address' or row_data.details->'priority' is distinct from expected->'priority' or row_data.details->'deadline' is distinct from expected->'deadline' or row_data.details->'location' is distinct from expected->'location' then raise exception 'Routing inputs changed; plan again';end if;
  if coalesce((routing->>'driver')::int,0) not in(1,2) or coalesce((routing->>'routeOrder')::int,-1)<0 or coalesce((routing#>>'{routeLeg,miles}')::numeric,-1)<0 or coalesce((routing#>>'{routeLeg,seconds}')::numeric,-1)<0 then raise exception 'Invalid route estimates';end if;
  update public.bjta_deliveries set details=details||jsonb_build_object('driver',routing->'driver','routeOrder',routing->'routeOrder','routeLeg',routing->'routeLeg','estimatedArrival',routing->'estimatedArrival','lateEstimate',routing->'lateEstimate','mileage',routing->'mileage') where id=row_data.id;
 end loop;
 insert into public.bjta_events(day_id,action,details) values(day,'route_planned',jsonb_build_object('stops',jsonb_array_length(plan)));
end $$;
create or replace function public.gldd_save_route_plan(day uuid, plan jsonb) returns void language sql set search_path='' as $$select gldd_private.save_route_plan(day,plan);$$;
revoke all on function public.gldd_save_route_plan(uuid,jsonb),gldd_private.save_route_plan(uuid,jsonb) from public,anon;
grant execute on function public.gldd_save_route_plan(uuid,jsonb),gldd_private.save_route_plan(uuid,jsonb) to authenticated;
