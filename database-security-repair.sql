-- Targeted repair based on inspected production metadata, 2026-10-04.
-- Does not change customer records or subscription pricing.
begin;
alter policy "Users can view profiles" on public.profiles
  using (id = auth.uid());
revoke insert, update on public.profiles from authenticated;
grant insert (id, full_name, email, phone, avatar_url, bio),
      update (id, full_name, email, phone, avatar_url, bio)
  on public.profiles to authenticated;
-- Notifications may only be marked read by their recipient through existing RLS.
revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;
-- These client roles never need table-wide destruction or trigger administration.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
-- Keep legacy viewing policy consistent with the enabled validation trigger.
alter policy "Users can request viewings" on public.viewing_requests
  with check (requester_id = auth.uid() and public.nf_has_access('seeker')
    and owner_id <> auth.uid() and exists (
      select 1 from public.properties p
      where p.id = viewing_requests.property_id
        and p.owner_id = viewing_requests.owner_id));
do $verify$
begin
  if has_column_privilege('authenticated','public.profiles','role','UPDATE')
    or has_column_privilege('authenticated','public.profiles','role','INSERT')
    or has_column_privilege('authenticated','public.profiles','verified_owner','UPDATE')
    or has_column_privilege('authenticated','public.profiles','verification_status','UPDATE')
    or has_column_privilege('authenticated','public.profiles','is_premium','UPDATE') then
    raise exception 'Protected profile fields remain writable';
  end if;
  if not has_column_privilege('authenticated','public.profiles','full_name','UPDATE')
    or not has_column_privilege('authenticated','public.profiles','phone','INSERT') then
    raise exception 'Normal profile editing must remain available';
  end if;
  if has_column_privilege('authenticated','public.notifications','body','UPDATE')
    or not has_column_privilege('authenticated','public.notifications','is_read','UPDATE') then
    raise exception 'Notification permissions are incorrect';
  end if;
end;
$verify$;
commit;
select 'Profile and notification protections verified' as result;
