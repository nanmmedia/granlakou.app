create or replace function gldd_private.save_scheduled_order(
  business uuid, order_date date, order_details jsonb
) returns public.bjta_deliveries
language plpgsql security definer set search_path='' as $$
declare
  workspace public.bjta_businesses;
  scheduled public.bjta_days;
  defaults jsonb;
begin
  if auth.uid() is null or not gldd_private.has_business_role(business,array['business_admin','order_staff']) then
    raise exception 'Order staff access required';
  end if;
  if order_date is null or order_date < (now() at time zone 'America/Indiana/Indianapolis')::date then
    raise exception 'Choose today or an upcoming date';
  end if;
  select * into workspace from public.bjta_businesses where id=business and active for update;
  if not found then raise exception 'Workspace unavailable'; end if;
  select * into scheduled from public.bjta_days where business_id=business and delivery_date=order_date
    order by archived, created_at desc limit 1 for update;
  if found and scheduled.archived then raise exception 'This day is closed. Choose another date'; end if;
  if scheduled.id is null then
    defaults := jsonb_build_object('drivers',1,'driver1','Route 1','driver2','Route 2',
      'maps',coalesce(workspace.settings->>'maps','apple'),
      'nearFee',coalesce(workspace.settings->'delivery_fee','5'::jsonb),
      'receiptName',coalesce(workspace.settings->>'full_name',workspace.name));
    scheduled := gldd_private.bjta_create_day(business,order_date,workspace.settings->>'kitchen',defaults);
  end if;
  return gldd_private.bjta_save_delivery(scheduled.id,order_details,null);
end $$;

create or replace function gldd_private.assign_remaining_stops(day uuid, replacement uuid, stops uuid[], first_stop uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  run public.bjta_days;
  changed integer;
begin
  if auth.uid() is null or not gldd_private.has_day_role(day,array['business_admin']) then
    raise exception 'Business Admin access required';
  end if;
  select * into run from public.bjta_days where id=day and not archived
    and delivery_date=(now() at time zone 'America/Indiana/Indianapolis')::date for update;
  if not found then raise exception 'Choose today’s open run'; end if;
  if replacement is null or not exists (
    select 1 from public.bjta_staff s join auth.users u on u.id=s.user_id
    where s.business_id=run.business_id and s.user_id=replacement and s.active
      and s.roles && array['business_admin','driver'] and u.email_confirmed_at is not null
  ) then raise exception 'Choose an active, confirmed driver'; end if;
  if exists(select 1 from public.bjta_deliveries where day_id=day and claimed_by=replacement
    and status in ('in_progress','delivered') and coalesce(details->>'orderType','delivery')='delivery'
    and coalesce(details->>'driver','1')='1') then
    raise exception 'Choose a different driver for the second route';
  end if;
  if nullif(run.settings->>'secondDriver','') is not null and run.settings->>'secondDriver'<>replacement::text then
    raise exception 'A second driver is already assigned. Use driver handoff to transfer their stops';
  end if;
  if coalesce(cardinality(stops),0)=0 or first_stop is null or not(first_stop=any(stops)) then raise exception 'Select at least one stop'; end if;
  update public.bjta_deliveries d
    set assigned_to=replacement,
        details=(d.details - array['routeOrder','routeLeg','estimatedArrival','lateEstimate']) || jsonb_build_object('driver',2,'routeOrder',case when d.id=first_stop and run.settings->>'secondDriverFirst' is null then -1 else 999 end)
    where d.id=any(stops) and d.day_id=day and d.status='ready' and d.assigned_to is null
      and coalesce(d.details->>'orderType','delivery')='delivery'
      and not exists(select 1 from public.gldd_handoffs h where h.status='pending' and d.id=any(h.delivery_ids));
  get diagnostics changed=row_count;
  if changed<>cardinality(stops) then raise exception 'Some stops are no longer available. Refresh and choose again'; end if;
  update public.bjta_days set settings=settings || jsonb_build_object('drivers',2,'secondDriver',replacement,'secondDriverFirst',coalesce(nullif(settings->>'secondDriverFirst',''),first_stop::text))
    where id=day;
  insert into public.bjta_events(day_id,action,details)
    values(day,'second_driver_assigned',jsonb_build_object('driver',replacement,'stops',changed));
end $$;

create or replace function public.gldd_save_scheduled_order(business uuid, order_date date, order_details jsonb)
returns public.bjta_deliveries language sql set search_path='' as $$
  select gldd_private.save_scheduled_order(business,order_date,order_details);
$$;
create or replace function public.gldd_assign_remaining_stops(day uuid,replacement uuid,stops uuid[],first_stop uuid)
returns void language sql set search_path='' as $$
  select gldd_private.assign_remaining_stops(day,replacement,stops,first_stop);
$$;
revoke all on function public.gldd_save_scheduled_order(uuid,date,jsonb),
  gldd_private.save_scheduled_order(uuid,date,jsonb),
  public.gldd_assign_remaining_stops(uuid,uuid,uuid[],uuid),
  gldd_private.assign_remaining_stops(uuid,uuid,uuid[],uuid) from public,anon;
grant execute on function public.gldd_save_scheduled_order(uuid,date,jsonb),
  gldd_private.save_scheduled_order(uuid,date,jsonb),
  public.gldd_assign_remaining_stops(uuid,uuid,uuid[],uuid),
  gldd_private.assign_remaining_stops(uuid,uuid,uuid[],uuid) to authenticated;
