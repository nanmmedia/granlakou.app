create function gldd_private.record_message_prepared(delivery uuid,template text,channel text) returns void language plpgsql security definer set search_path='' as $$
declare d public.bjta_deliveries; day_archived boolean; management boolean; label text;
begin
 if not gldd_private.has_delivery_role(delivery,array['business_admin','order_staff','driver']) then raise exception 'Staff access required';end if;
 if template is null or template not in ('delay','on_way','reschedule','delivered') or channel is null or channel not in ('whatsapp','sms','copy') then raise exception 'Choose a message template and channel';end if;
 select * into d from public.bjta_deliveries where id=delivery;
 select archived into day_archived from public.bjta_days where id=d.day_id;
 management:=gldd_private.has_delivery_role(delivery,array['business_admin','order_staff']);
 if not management and (day_archived or not (d.claimed_by is not distinct from auth.uid() or d.assigned_to is not distinct from auth.uid() or (d.status='ready' and d.assigned_to is null) or exists(select 1 from public.gldd_handoffs h where h.status='pending' and delivery=any(h.delivery_ids) and auth.uid() in(h.from_user,h.to_user,h.requested_by)))) then raise exception 'This order is outside your delivery access';end if;
 if template='delivered' and d.status<>'delivered' then raise exception 'Complete the delivery before preparing its delivered message';end if;
 if template='on_way' and d.status<>'in_progress' then raise exception 'Start the delivery before preparing an on-the-way message';end if;
 if template in ('delay','reschedule') and d.status not in ('ready','in_progress','waiting') then raise exception 'Choose an unfinished delivery for this message';end if;
 label:=case template when 'delay' then 'Delay' when 'on_way' then 'On-the-way' when 'reschedule' then 'Reschedule' else 'Delivered' end;
 insert into public.bjta_events(day_id,delivery_id,action,details) values(d.day_id,d.id,'customer_message_prepared',jsonb_build_object('template',template,'channel',channel,'sent',false,'reason',label||' message prepared for '||channel||'; sending not verified'));
end $$;
create function public.gldd_record_message_prepared(delivery uuid,template text,channel text) returns void language sql set search_path='' as $$select gldd_private.record_message_prepared(delivery,template,channel);$$;
revoke all on function public.gldd_record_message_prepared(uuid,text,text),gldd_private.record_message_prepared(uuid,text,text) from public,anon;
grant execute on function public.gldd_record_message_prepared(uuid,text,text),gldd_private.record_message_prepared(uuid,text,text) to authenticated;
