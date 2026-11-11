create table public.gldd_handoffs (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.bjta_businesses(id),
 day_id uuid not null references public.bjta_days(id), from_user uuid not null references auth.users(id),
 to_user uuid not null references auth.users(id), requested_by uuid not null references auth.users(id),
 delivery_ids uuid[] not null, reason text not null, meeting_point text not null,
 status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
 stop_snapshot jsonb not null, created_at timestamptz not null default now(), decided_at timestamptz, decided_by uuid,
 check(from_user<>to_user), check(cardinality(delivery_ids) between 1 and 100)
);
alter table public.gldd_handoffs enable row level security;
revoke all on public.gldd_handoffs from public,anon,authenticated;
grant select on public.gldd_handoffs to authenticated;
create policy staff_reads_handoffs on public.gldd_handoffs for select to authenticated using (gldd_private.has_day_role(day_id,array['business_admin','driver','order_staff']));
create index gldd_handoffs_business_created on public.gldd_handoffs(business_id,created_at desc);
create index gldd_handoffs_pending_stops on public.gldd_handoffs using gin(delivery_ids) where status='pending';
alter table public.bjta_deliveries add column assigned_to uuid references auth.users(id);
create index bjta_deliveries_assigned_to on public.bjta_deliveries(assigned_to) where assigned_to is not null;

create function gldd_private.guard_handoff_delivery() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.gldd_handoffs h where h.status='pending' and h.delivery_ids @> array[old.id]) then
  raise exception 'This delivery is paused for handoff. Accept, decline or cancel the handoff first';
 end if;
 if new.status='in_progress' and new.assigned_to is not null and new.claimed_by is distinct from new.assigned_to then
  raise exception 'This delivery is assigned to another driver';
 end if;
 return new;
end $$;
revoke all on function gldd_private.guard_handoff_delivery() from public,anon,authenticated;
create trigger guard_handoff_delivery before update on public.bjta_deliveries for each row execute function gldd_private.guard_handoff_delivery();

create function gldd_private.handoff_people(business uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not gldd_private.has_business_role(business,array['business_admin','driver','order_staff']) then raise exception 'Staff access required';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',s.user_id,'name',s.display_name,'eligible',s.active and u.email_confirmed_at is not null and s.roles && array['business_admin','driver']) order by lower(s.display_name)) from public.bjta_staff s join auth.users u on u.id=s.user_id where s.business_id=business),'[]'::jsonb);
end $$;
create function gldd_private.request_handoff(day uuid,source_driver uuid,replacement uuid,stops uuid[],issue text,meeting text) returns uuid language plpgsql security definer set search_path='' as $$
declare b uuid; h uuid; manager boolean; snapshot jsonb;
begin
 if not gldd_private.has_day_role(day,array['business_admin','driver']) then raise exception 'Driver or Business Admin access required';end if;
 select business_id into b from public.bjta_days where id=day and not archived for update;
 if not found then raise exception 'Active delivery day required';end if;
 manager:=gldd_private.has_day_role(day,array['business_admin']);
 if source_driver is null or replacement is null or source_driver=replacement then raise exception 'Choose two different drivers';end if;
 if not manager and source_driver<>auth.uid() then raise exception 'Drivers can only hand off their own deliveries';end if;
 if not exists(select 1 from public.bjta_staff where business_id=b and user_id=source_driver) then raise exception 'Source driver not found in this workspace';end if;
 if not exists(select 1 from public.bjta_staff s join auth.users u on u.id=s.user_id where s.business_id=b and s.user_id=replacement and s.active and s.roles && array['business_admin','driver'] and u.email_confirmed_at is not null) then raise exception 'Replacement must be an active driver with a confirmed email';end if;
 if stops is null or cardinality(stops) not between 1 and 100 or array_position(stops,null) is not null or cardinality(stops)<>(select count(distinct x) from unnest(stops) x) then raise exception 'Choose 1 to 100 different deliveries';end if;
 if coalesce(length(trim(issue)),0) not between 1 and 500 or coalesce(length(trim(meeting)),0) not between 1 and 300 then raise exception 'Add a reason and where to collect the food';end if;
 perform 1 from public.bjta_deliveries where id=any(stops) order by id for update;
 if (select count(*) from public.bjta_deliveries d where d.id=any(stops) and d.day_id=day and
   ((d.status='in_progress' and d.claimed_by=source_driver) or (d.status='ready' and (d.assigned_to=source_driver or (manager and d.assigned_to is null)))))<>cardinality(stops) then raise exception 'Some stops changed or belong to another driver. Refresh the list';end if;
 if exists(select 1 from public.gldd_handoffs where status='pending' and delivery_ids && stops) then raise exception 'A selected stop already has a pending handoff';end if;
 select jsonb_agg(jsonb_build_object('id',id,'status',status,'claimed_by',claimed_by,'assigned_to',assigned_to,'started_at',started_at)) into snapshot from public.bjta_deliveries where id=any(stops);
 insert into public.gldd_handoffs(business_id,day_id,from_user,to_user,requested_by,delivery_ids,reason,meeting_point,stop_snapshot)
 values(b,day,source_driver,replacement,auth.uid(),stops,trim(issue),trim(meeting),snapshot) returning id into h;
 insert into public.bjta_events(day_id,delivery_id,action,details) select day,x,'handoff_requested',jsonb_build_object('handoff_id',h,'from_user',source_driver,'to_user',replacement,'reason',trim(issue)) from unnest(stops) x;
 return h;
end $$;
create function gldd_private.decide_handoff(handoff uuid,decision text,food_received boolean) returns void language plpgsql security definer set search_path='' as $$
declare h public.gldd_handoffs; manager boolean; active_day uuid;
begin
 select * into h from public.gldd_handoffs where id=handoff;
 if not found or not gldd_private.has_day_role(h.day_id,array['business_admin','driver']) then raise exception 'Handoff access required';end if;
 select id into active_day from public.bjta_days where id=h.day_id and not archived for update;
 if active_day is null then raise exception 'Active delivery day required';end if;
 select * into h from public.gldd_handoffs where id=handoff for update;
 if h.status<>'pending' then raise exception 'This handoff has already been handled. Refresh the list';end if;
 manager:=gldd_private.has_day_role(h.day_id,array['business_admin']);
 if decision in ('accepted','declined') then
  if auth.uid()<>h.to_user then raise exception 'Only the replacement driver can accept or decline';end if;
 elsif decision='cancelled' then
  if auth.uid()<>h.from_user and auth.uid()<>h.requested_by and not manager then raise exception 'Only the sender or a Business Admin can cancel';end if;
 else raise exception 'Invalid handoff decision';end if;
 if decision='accepted' then
  if food_received is distinct from true then raise exception 'Confirm you have received the food';end if;
  if not exists(select 1 from public.bjta_staff s join auth.users u on u.id=s.user_id where s.business_id=h.business_id and s.user_id=auth.uid() and s.active and s.roles && array['business_admin','driver'] and u.email_confirmed_at is not null) then raise exception 'Active confirmed driver required';end if;
 end if;
 perform 1 from public.bjta_deliveries where id=any(h.delivery_ids) order by id for update;
 if (select count(*) from public.bjta_deliveries where id=any(h.delivery_ids) and day_id=h.day_id and status in ('ready','in_progress'))<>cardinality(h.delivery_ids) then raise exception 'A delivery changed. Ask a Business Admin to review the handoff';end if;
 update public.gldd_handoffs set status=decision,decided_at=now(),decided_by=auth.uid() where id=handoff;
 if decision='accepted' then
  update public.bjta_deliveries set status='ready',assigned_to=h.to_user,claimed_by=null,started_at=null where id=any(h.delivery_ids);
 end if;
 insert into public.bjta_events(day_id,delivery_id,action,details) select h.day_id,x,'handoff_'||decision,jsonb_build_object('handoff_id',h.id,'from_user',h.from_user,'to_user',h.to_user,'food_received',decision='accepted') from unnest(h.delivery_ids) x;
end $$;
create function public.gldd_handoff_people(business uuid) returns jsonb language sql set search_path='' as $$select gldd_private.handoff_people(business);$$;
create function public.gldd_request_handoff(day uuid,source_driver uuid,replacement uuid,stops uuid[],issue text,meeting text) returns uuid language sql set search_path='' as $$select gldd_private.request_handoff(day,source_driver,replacement,stops,issue,meeting);$$;
create function public.gldd_decide_handoff(handoff uuid,decision text,food_received boolean default false) returns void language sql set search_path='' as $$select gldd_private.decide_handoff(handoff,decision,food_received);$$;
revoke all on function gldd_private.handoff_people(uuid),gldd_private.request_handoff(uuid,uuid,uuid,uuid[],text,text),gldd_private.decide_handoff(uuid,text,boolean),public.gldd_handoff_people(uuid),public.gldd_request_handoff(uuid,uuid,uuid,uuid[],text,text),public.gldd_decide_handoff(uuid,text,boolean) from public,anon;
grant execute on function gldd_private.handoff_people(uuid),gldd_private.request_handoff(uuid,uuid,uuid,uuid[],text,text),gldd_private.decide_handoff(uuid,text,boolean),public.gldd_handoff_people(uuid),public.gldd_request_handoff(uuid,uuid,uuid,uuid[],text,text),public.gldd_decide_handoff(uuid,text,boolean) to authenticated;
