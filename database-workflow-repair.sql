-- Requesters may cancel their own active viewings. Existing restrictive policies
-- and nf_guard_viewing still enforce identity, immutable details and transitions.
begin;
drop policy if exists "Requesters can cancel own viewings" on public.viewing_requests;
create policy "Requesters can cancel own viewings" on public.viewing_requests
for update to authenticated
using (requester_id=auth.uid() and status in ('Requested','Pending','Accepted'))
with check (requester_id=auth.uid() and status='Cancelled');
commit;
