-- Apply after the frontend supports gldd_driver_day.
alter policy staff_read_days on public.bjta_days using (gldd_private.has_business_role(business_id,array['business_admin','order_staff']));
alter policy staff_read_deliveries on public.bjta_deliveries using (gldd_private.has_day_role(day_id,array['business_admin','order_staff']));
alter policy staff_read_events on public.bjta_events using (gldd_private.has_day_role(day_id,array['business_admin','order_staff']));
alter policy business_product_read on public.gldd_products using (gldd_private.has_business_role(business_id,array['business_admin','order_staff']));
alter policy staff_reads_handoffs on public.gldd_handoffs using (gldd_private.has_day_role(day_id,array['business_admin','order_staff']) or (auth.uid() in(from_user,to_user,requested_by) and gldd_private.has_day_role(day_id,array['driver'])));
