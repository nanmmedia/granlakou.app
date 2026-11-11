create table public.gldd_staff_events (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.bjta_businesses(id),
 user_id uuid not null references auth.users(id), actor_id uuid, action text not null,
 before_access jsonb, after_access jsonb, happened_at timestamptz not null default now()
);
alter table public.gldd_staff_events enable row level security;
revoke all on public.gldd_staff_events from anon, authenticated;
grant select on public.gldd_staff_events to authenticated;
create policy owner_reads_staff_events on public.gldd_staff_events for select to authenticated using ((select gldd_private.is_super_admin()));
create index gldd_staff_events_business_time on public.gldd_staff_events(business_id,happened_at desc);
create function gldd_private.audit_staff_access() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (old.display_name,old.roles,old.active) is not distinct from (new.display_name,new.roles,new.active) then return new; end if;
 insert into public.gldd_staff_events(business_id,user_id,actor_id,action,before_access,after_access)
 values(new.business_id,new.user_id,auth.uid(),case when tg_op='INSERT' then 'staff_added' when old.active and not new.active then 'access_revoked' when not old.active and new.active then 'access_restored' else 'staff_updated' end,
 case when tg_op='UPDATE' then jsonb_build_object('name',old.display_name,'roles',old.roles,'active',old.active) end,
 jsonb_build_object('name',new.display_name,'roles',new.roles,'active',new.active));
 return new;
end $$;
revoke all on function gldd_private.audit_staff_access() from public,anon,authenticated;
create trigger audit_staff_access after insert or update on public.bjta_staff for each row execute function gldd_private.audit_staff_access();
create function gldd_private.set_staff_status(business uuid,target_user uuid,expected_active boolean,enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare current_active boolean;
begin
 if not gldd_private.is_super_admin() then raise exception 'Super Admin access required'; end if;
 if exists(select 1 from gldd_private.app_owner where user_id=target_user) then raise exception 'Your Super Admin account is protected'; end if;
 if expected_active is null or enabled is null then raise exception 'Access status is required'; end if;
 select active into current_active from public.bjta_staff where business_id=business and user_id=target_user for update;
 if not found then raise exception 'Staff membership not found'; end if;
 if current_active is distinct from expected_active then raise exception 'Access changed. Refresh the staff list and try again'; end if;
 update public.bjta_staff set active=enabled where business_id=business and user_id=target_user;
end $$;
revoke all on function gldd_private.set_staff_status(uuid,uuid,boolean,boolean) from public,anon;
grant execute on function gldd_private.set_staff_status(uuid,uuid,boolean,boolean) to authenticated;
create function public.gldd_set_staff_status(business uuid,target_user uuid,expected_active boolean,enabled boolean) returns void language sql set search_path='' as $$select gldd_private.set_staff_status(business,target_user,expected_active,enabled);$$;
revoke all on function public.gldd_set_staff_status(uuid,uuid,boolean,boolean) from public,anon;
grant execute on function public.gldd_set_staff_status(uuid,uuid,boolean,boolean) to authenticated;
