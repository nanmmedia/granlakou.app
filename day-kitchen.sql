create or replace function gldd_private.use_workspace_kitchen(day uuid, expected_kitchen text)
returns void language plpgsql security definer set search_path='' as $$
declare
  run public.bjta_days;
  kitchen text;
begin
  if auth.uid() is null or not gldd_private.has_day_role(day,array['business_admin']) then
    raise exception 'Business Admin access required';
  end if;
  select * into run from public.bjta_days where id=day and not archived
    and delivery_date >= (now() at time zone 'America/Indiana/Indianapolis')::date for update;
  if not found then raise exception 'Choose an open order day'; end if;
  if run.kitchen_address is distinct from expected_kitchen then
    raise exception 'The kitchen changed. Refresh and try again';
  end if;
  select nullif(btrim(settings->>'kitchen'),'') into kitchen
    from public.bjta_businesses where id=run.business_id and active;
  if kitchen is null then raise exception 'Set a default kitchen in Business settings first'; end if;
  if kitchen=run.kitchen_address then return; end if;
  if exists(select 1 from public.bjta_deliveries where day_id=day
    and status in ('in_progress','delivered') and coalesce(details->>'orderType','delivery')='delivery') then
    raise exception 'The kitchen is locked once a delivery has started';
  end if;
  update public.bjta_deliveries
    set details=details - array['routeOrder','routeLeg','estimatedArrival','lateEstimate','mileage']
    where day_id=day and status='ready' and coalesce(details->>'orderType','delivery')='delivery';
  update public.bjta_days set kitchen_address=kitchen,settings=settings-'kitchenLocation' where id=day;
  insert into public.bjta_events(day_id,action) values(day,'workspace_kitchen_applied');
end $$;

create or replace function public.gldd_use_workspace_kitchen(day uuid,expected_kitchen text)
returns void language sql set search_path='' as $$
  select gldd_private.use_workspace_kitchen(day,expected_kitchen);
$$;
revoke all on function public.gldd_use_workspace_kitchen(uuid,text),
  gldd_private.use_workspace_kitchen(uuid,text) from public,anon;
grant execute on function public.gldd_use_workspace_kitchen(uuid,text),
  gldd_private.use_workspace_kitchen(uuid,text) to authenticated;
