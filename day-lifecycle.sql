CREATE OR REPLACE FUNCTION gldd_private.bjta_create_day(business uuid, day_date date, kitchen text, day_settings jsonb DEFAULT '{}'::jsonb)
 RETURNS bjta_days
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result public.bjta_days;
begin
 if not gldd_private.has_business_role(business,array['business_admin','order_staff']) then raise exception 'Staff access required'; end if;
 if day_date is null or day_date < (now() at time zone 'America/Indiana/Indianapolis')::date then raise exception 'Choose today or an upcoming date'; end if;
 perform 1 from public.bjta_businesses where id=business for update;
 select * into result from public.bjta_days where business_id=business and delivery_date=day_date  and not coalesce(settings->>'cancelledDay'='true',false) order by archived, created_at desc limit 1;
 if found then
  if result.archived then raise exception 'This day is closed. Choose another date'; end if;
  return result;
 end if;
 if nullif(trim(kitchen),'') is null then raise exception 'Kitchen address required'; end if;
 insert into public.bjta_days(business_id,delivery_date,kitchen_address,settings) values(business,day_date,kitchen,coalesce(day_settings,'{}'::jsonb)-'cancelledDay') returning * into result;
 insert into public.bjta_events(day_id,action) values(result.id,'day_created');
 return result;
end $function$
;
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
  select * into scheduled from public.bjta_days where business_id=business and delivery_date=order_date and not coalesce(settings->>'cancelledDay'='true',false)
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

create or replace function gldd_private.cancel_order_day(day uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  selected_day public.bjta_days;
begin
  if auth.uid() is null or not gldd_private.has_day_role(day,array['business_admin']) then
    raise exception 'Business Admin access required';
  end if;
  select * into selected_day from public.bjta_days where id=day and not archived
    and delivery_date >= (now() at time zone 'America/Indiana/Indianapolis')::date for update;
  if not found then raise exception 'Only today or an upcoming open day can be cancelled'; end if;
  perform 1 from public.bjta_deliveries where day_id=day order by id for update;
  if exists(select 1 from public.bjta_deliveries where day_id=day
    and (paid or payment_method is not null or status in ('in_progress','delivered'))) then
    raise exception 'This day has started orders or recorded payments. Resolve those orders and use Close Day.';
  end if;
  if exists(select 1 from public.gldd_handoffs where day_id=day and status='pending') then
    raise exception 'Resolve pending driver handoffs first';
  end if;
  update public.bjta_days set archived=true, settings=settings||'{"cancelledDay":true}'::jsonb where id=day;
  insert into public.bjta_events(day_id,action) values(day,'day_cancelled');
end $$;

create or replace function public.gldd_cancel_order_day(day uuid)
returns void language sql set search_path='' as $$
  select gldd_private.cancel_order_day(day);
$$;
revoke all on function public.gldd_cancel_order_day(uuid), gldd_private.cancel_order_day(uuid) from public,anon;
grant execute on function public.gldd_cancel_order_day(uuid), gldd_private.cancel_order_day(uuid) to authenticated;
