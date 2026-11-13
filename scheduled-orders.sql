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
 select * into result from public.bjta_days where business_id=business and delivery_date=day_date and not archived order by created_at desc limit 1;
 if found then return result; end if;
 if nullif(trim(kitchen),'') is null then raise exception 'Kitchen address required'; end if;
 insert into public.bjta_days(business_id,delivery_date,kitchen_address,settings) values(business,day_date,kitchen,day_settings) returning * into result;
 insert into public.bjta_events(day_id,action) values(result.id,'day_created');
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION gldd_private.bjta_save_delivery(day uuid, delivery_details jsonb, delivery uuid DEFAULT NULL::uuid)
 RETURNS bjta_deliveries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result public.bjta_deliveries;
begin
 if not gldd_private.has_day_role(day,array['business_admin','order_staff']) then raise exception 'Staff access required'; end if;
 perform 1 from public.bjta_days where id=day and not archived and delivery_date>=(now() at time zone 'America/Indiana/Indianapolis')::date for update;
 if not found then raise exception 'Active delivery day required'; end if;
 if coalesce(delivery_details->>'orderType','delivery') not in ('delivery','pickup') then raise exception 'Choose Delivery or Pickup'; end if;
 if delivery_details->>'orderType'='pickup' then
  delivery_details := (delivery_details - array['driver','location','mileage','routeOrder','routeLeg','estimatedArrival','lateEstimate','deadline','priority','unit','addressParts']) || '{"address":"","fee":0}'::jsonb;
 end if;
 if coalesce(length(trim(delivery_details->>'name')),0)=0 or (coalesce(delivery_details->>'orderType','delivery')='delivery' and coalesce(length(trim(delivery_details->>'address')),0)=0) then raise exception 'Customer name and address required'; end if;
 if delivery is null then
  insert into public.bjta_deliveries(day_id,details) values(day,delivery_details) returning * into result;
 else
  update public.bjta_deliveries set details=delivery_details where id=delivery and day_id=day and status='ready' and (coalesce(delivery_details->>'orderType','delivery')<>'pickup' or assigned_to is null) returning * into result;
  if not found then raise exception 'Only unstarted deliveries can be edited'; end if;
 end if;
 insert into public.bjta_events(day_id,delivery_id,action) values(day,result.id,'delivery_saved');
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION gldd_private.bjta_start_delivery(delivery uuid)
 RETURNS bjta_deliveries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result public.bjta_deliveries; day uuid;
begin
 if not gldd_private.has_delivery_role(delivery,array['business_admin','driver']) then raise exception 'Staff access required'; end if;
 select day_id into day from public.bjta_deliveries where id=delivery;
 perform 1 from public.bjta_days where id=day and not archived and delivery_date=(now() at time zone 'America/Indiana/Indianapolis')::date for update;
 if not found then raise exception 'Active delivery day required'; end if;
 update public.bjta_deliveries set status='in_progress',claimed_by=auth.uid(),started_at=now()
 where id=delivery and status='ready' and coalesce(details->>'orderType','delivery')='delivery' returning * into result;
 if not found then raise exception 'Delivery was already started or completed'; end if;
 insert into public.bjta_events(day_id,delivery_id,action) values(result.day_id,result.id,'delivery_started');
 return result;
end $function$
;

create or replace function gldd_private.complete_pickup(delivery uuid, method text)
returns public.bjta_deliveries language plpgsql security definer set search_path='' as $$
declare result public.bjta_deliveries; order_day uuid;
begin
 if auth.uid() is null or not gldd_private.has_delivery_role(delivery,array['business_admin','order_staff']) then raise exception 'Order staff access required'; end if;
 if method is null or method not in ('Cash','Zelle','Cash App') then raise exception 'Choose a payment method'; end if;
 select day_id into order_day from public.bjta_deliveries where id=delivery;
 perform 1 from public.bjta_days where id=order_day and not archived and delivery_date=(now() at time zone 'America/Indiana/Indianapolis')::date for update;
 if not found then raise exception 'Pickups can be completed on their scheduled day'; end if;
 update public.bjta_deliveries set status='delivered',claimed_by=auth.uid(),completed_at=now(),paid=true,payment_method=method
 where id=delivery and status='ready' and details->>'orderType'='pickup' returning * into result;
 if not found then raise exception 'This order is no longer awaiting pickup'; end if;
 insert into public.bjta_events(day_id,delivery_id,action,details) values(result.day_id,result.id,'pickup_completed',jsonb_build_object('payment_method',method));
 return result;
end $$;
create or replace function public.gldd_complete_pickup(delivery uuid, method text)
returns public.bjta_deliveries language sql set search_path='' as $$select gldd_private.complete_pickup(delivery,method);$$;
revoke all on function public.gldd_complete_pickup(uuid,text),gldd_private.complete_pickup(uuid,text) from public,anon;
grant execute on function public.gldd_complete_pickup(uuid,text),gldd_private.complete_pickup(uuid,text) to authenticated;

