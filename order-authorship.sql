-- Show the order taker's name without exposing account emails or roles.
create or replace function gldd_private.order_authors(business uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not gldd_private.has_business_role(business,array['business_admin','order_staff']) then raise exception 'Order access required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('order_id',d.id,'name',
  case when nullif(trim(s.display_name),'') is null or position('@' in s.display_name)>0 or lower(trim(s.display_name)) in ('super admin','business admin','order staff','driver','staff') then 'Staff member' else trim(s.display_name) end))
 from public.bjta_deliveries d join public.bjta_days day on day.id=d.day_id
 left join public.bjta_staff s on s.business_id=day.business_id and s.user_id=d.created_by
 where day.business_id=business and coalesce((day.settings->>'cancelledDay')::boolean,false)=false),'[]'::jsonb);
end $$;
create or replace function public.gldd_order_authors(business uuid) returns jsonb language sql stable set search_path='' as $$select gldd_private.order_authors(business);$$;
revoke all on function public.gldd_order_authors(uuid),gldd_private.order_authors(uuid) from public,anon;
grant execute on function public.gldd_order_authors(uuid),gldd_private.order_authors(uuid) to authenticated;

-- Cancellation preserves the order and activity, and never rewrites a payment.
create or replace function gldd_private.cancel_delivery(delivery uuid, reason text)
returns public.bjta_deliveries language plpgsql security definer set search_path='' as $$
declare result public.bjta_deliveries; day uuid;
begin
 if not gldd_private.has_delivery_role(delivery,array['business_admin','order_staff']) then raise exception 'Order staff access required';end if;
 if reason is null or length(trim(reason)) not between 1 and 500 then raise exception 'A cancellation reason is required';end if;
 select day_id into day from public.bjta_deliveries where id=delivery;
 perform 1 from public.bjta_days where id=day and not archived for update;
 if not found then raise exception 'Active order day required';end if;
 select * into result from public.bjta_deliveries where id=delivery for update;
 if result.status not in ('ready','in_progress') then raise exception 'Completed or cancelled orders cannot be cancelled';end if;
 if result.paid or nullif(result.payment_method,'') is not null then raise exception 'Review the recorded payment before cancelling this order';end if;
 if exists(select 1 from public.gldd_handoffs h where h.status='pending' and delivery=any(h.delivery_ids)) then raise exception 'Resolve the pending handoff before cancelling this order';end if;
 update public.bjta_deliveries set status='cancelled' where id=delivery returning * into result;
 insert into public.bjta_events(day_id,delivery_id,action,details) values(day,delivery,'delivery_cancelled',jsonb_build_object('reason',trim(reason)));
 return result;
end $$;
