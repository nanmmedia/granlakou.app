create or replace function gldd_private.plan_order_day(business uuid, order_date date, day_settings jsonb, reminder text)
returns public.bjta_days language plpgsql security definer set search_path='' as $$
declare
  workspace public.bjta_businesses;
  result public.bjta_days;
  kitchen text;
begin
  if auth.uid() is null or not gldd_private.has_business_role(business,array['business_admin']) then
    raise exception 'Business Admin access required';
  end if;
  if length(coalesce(reminder,''))>500 then raise exception 'Keep the reminder under 501 characters'; end if;
  select * into workspace from public.bjta_businesses where id=business and active for update;
  if not found then raise exception 'Workspace unavailable'; end if;
  kitchen:=nullif(btrim(workspace.settings->>'kitchen'),'');
  result:=gldd_private.bjta_create_day(business,order_date,kitchen,coalesce(day_settings,'{}'::jsonb));
  update public.bjta_days
    set settings=settings||jsonb_build_object('planned',true,'planReminder',btrim(coalesce(reminder,'')))
    where id=result.id and not archived returning * into result;
  if not found then raise exception 'This day is closed'; end if;
  insert into public.bjta_events(day_id,action) values(result.id,'day_plan_saved');
  return result;
end $$;
create or replace function public.gldd_plan_order_day(business uuid, order_date date, day_settings jsonb, reminder text)
returns public.bjta_days language sql set search_path='' as $$
  select gldd_private.plan_order_day(business,order_date,day_settings,reminder);
$$;
revoke all on function public.gldd_plan_order_day(uuid,date,jsonb,text),gldd_private.plan_order_day(uuid,date,jsonb,text) from public,anon;
grant execute on function public.gldd_plan_order_day(uuid,date,jsonb,text),gldd_private.plan_order_day(uuid,date,jsonb,text) to authenticated;
