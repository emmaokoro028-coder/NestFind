-- NestFind: three-day messaging trial, one-time unlock and paid publication.
-- All changes are transactional. Existing customer records are retained.
begin;
create table if not exists public.nf_payment_receipts (
 reference text primary key,
 user_id uuid not null references auth.users(id),
 purpose text not null check (purpose in ('messaging','listing','premium')),
 plan text,
 amount_kobo bigint not null check (amount_kobo > 0),
 currency text not null default 'NGN' check (currency = 'NGN'),
 created_at timestamptz not null default now(),
 expires_at timestamptz,
 used_property_id uuid,
 check ((purpose='messaging' and amount_kobo=200000 and plan is null and expires_at is null)
     or (purpose='listing' and amount_kobo=1000000 and plan is null and expires_at is null)
     or (purpose='premium' and expires_at is not null and
       ((plan='monthly' and amount_kobo=1000000) or (plan='yearly' and amount_kobo=12000000))))
);
alter table public.nf_payment_receipts enable row level security;
revoke all on public.nf_payment_receipts from anon, authenticated;
grant select on public.nf_payment_receipts to authenticated;
grant all on public.nf_payment_receipts to service_role;
create policy "Read own verified receipts" on public.nf_payment_receipts
 for select to authenticated using (user_id = auth.uid());

create or replace function public.nf_message_access_until() returns timestamptz
language sql stable security definer set search_path=public,pg_temp as $$
 select case when exists(select 1 from public.nf_payment_receipts
   where user_id=auth.uid() and purpose='messaging') then 'infinity'::timestamptz
 else (select created_at + interval '3 days' from auth.users where id=auth.uid()) end;
$$;
revoke all on function public.nf_message_access_until() from public, anon;
grant execute on function public.nf_message_access_until() to authenticated;

create or replace function public.nf_record_verified_payment(
 p_reference text,p_user_id uuid,p_purpose text,p_plan text,p_amount_kobo bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare receipt public.nf_payment_receipts%rowtype; valid_amount bigint; expiry timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server only'; end if;
 if p_reference is null or length(p_reference) not between 1 and 200 or p_user_id is null then raise exception 'Invalid payment'; end if;
 valid_amount=case p_purpose when 'messaging' then 200000 when 'listing' then 1000000
 when 'premium' then case p_plan when 'monthly' then 1000000 when 'yearly' then 12000000 end end;
 if valid_amount is null or p_amount_kobo is distinct from valid_amount or
 (p_purpose<>'premium' and p_plan is not null) then raise exception 'Invalid payment price or plan'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||p_purpose,0));
 select * into receipt from public.nf_payment_receipts where reference=p_reference for update;
 if found then
   if receipt.user_id is distinct from p_user_id or receipt.purpose is distinct from p_purpose
     or receipt.plan is distinct from p_plan or receipt.amount_kobo is distinct from p_amount_kobo then
     raise exception 'Payment reference already belongs to another purchase';
   end if;
   return jsonb_build_object('verified',true,'reference',receipt.reference,'expires_at',receipt.expires_at);
 end if;
 if p_purpose='premium' then
   select greatest(now(),coalesce(max(expires_at),now())) +
     make_interval(days=>case p_plan when 'yearly' then 365 else 30 end)
   into expiry from public.nf_payment_receipts where user_id=p_user_id and purpose='premium';
 end if;
 insert into public.nf_payment_receipts(reference,user_id,purpose,plan,amount_kobo,expires_at)
 values(p_reference,p_user_id,p_purpose,p_plan,p_amount_kobo,expiry);
 return jsonb_build_object('verified',true,'reference',p_reference,'expires_at',expiry);
end; $$;
revoke all on function public.nf_record_verified_payment(text,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.nf_record_verified_payment(text,uuid,text,text,bigint) to service_role;
CREATE OR REPLACE FUNCTION public.nf_can_message(p_property uuid, p_receiver uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare owner uuid;
begin
 if auth.uid() is null or p_receiver is null or p_receiver=auth.uid() then return false; end if;
 select owner_id into owner from public.properties where id=p_property;
 if owner is null then return false; end if;
 if owner=auth.uid() then
   return coalesce(public.nf_message_access_until()>now(),false) and exists(select 1 from public.messages where property_id=p_property and sender_id=p_receiver and receiver_id=auth.uid());
 end if;
 return owner=p_receiver and coalesce(public.nf_message_access_until()>now(),false);
end; $function$
;
CREATE OR REPLACE FUNCTION public.nf_guard_viewing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if auth.role()='service_role' then return new; end if;
 if tg_op='INSERT' then
  if auth.uid() is null or new.requester_id is distinct from auth.uid() or not exists(select 1 from public.properties p where p.id=new.property_id and p.owner_id=new.owner_id and p.owner_id<>auth.uid()) then raise exception 'A valid property owner is required'; end if;
  if new.viewing_date is null or new.viewing_time is null or new.viewing_date<current_date or new.status is distinct from 'Requested' then raise exception 'Choose a future viewing date'; end if;
 else
  if (to_jsonb(new)-'status'-'updated_at') is distinct from (to_jsonb(old)-'status'-'updated_at') then raise exception 'Viewing details cannot be reassigned'; end if;
  if not ((auth.uid()=old.owner_id and new.status in ('Accepted','Declined') and old.status in ('Requested','Pending')) or (auth.uid()=old.requester_id and new.status='Cancelled' and old.status in ('Requested','Pending','Accepted'))) then raise exception 'Invalid viewing status change'; end if;
 end if;
 return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.nf_guard_property()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if auth.role()='service_role' then return new; end if;
 if auth.uid() is null or new.owner_id<>auth.uid() then raise exception 'You must own this property'; end if;
 if tg_op='UPDATE' and (new.owner_id is distinct from old.owner_id or new.is_verified is distinct from old.is_verified or new.is_featured is distinct from old.is_featured or (to_jsonb(new)->>'verification_status') is distinct from (to_jsonb(old)->>'verification_status')) then raise exception 'Only the service can change ownership or verification'; end if;
 if tg_op='INSERT' and (coalesce(new.is_verified,false) or coalesce(new.is_featured,false)) then raise exception 'Verification is managed by NestFind'; end if;
 if new.price<=0 or length(trim(new.title))<3 or length(trim(new.location))<2 or length(trim(new.city))<2 then raise exception 'Complete valid property details'; end if;
 return new;
end; $function$
;

-- Direct client insertion cannot bypass the per-listing payment check.
revoke insert on public.properties from anon,authenticated;
revoke all on function public.nf_publish_property(jsonb,uuid) from public,anon,authenticated;
-- Old subscription-only policy is superseded by the same owner validation as the trigger.
alter policy "Users can request viewings" on public.viewing_requests with check (
 requester_id=auth.uid() and owner_id<>auth.uid() and exists(
 select 1 from public.properties p where p.id=viewing_requests.property_id and p.owner_id=viewing_requests.owner_id));

-- Retain restrictive owner checks while removing the obsolete monthly-plan gate.
alter policy nf_viewing_insert_guard on public.viewing_requests with check (
 requester_id=auth.uid() and owner_id<>auth.uid() and exists(
 select 1 from public.properties p where p.id=viewing_requests.property_id and p.owner_id=viewing_requests.owner_id));
alter policy nf_property_update_guard on public.properties
 using (owner_id=auth.uid()) with check (owner_id=auth.uid());

create or replace function public.publish_property_with_payment(p_reference text,p_property jsonb)
returns public.properties language plpgsql security definer set search_path=public,pg_temp as $$
declare receipt public.nf_payment_receipts%rowtype; result public.properties%rowtype;
 offer text; period text; photos text[];
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select * into receipt from public.nf_payment_receipts where reference=p_reference for update;
 if not found or receipt.user_id is distinct from auth.uid() or receipt.purpose<>'listing'
   or receipt.amount_kobo<>1000000 then raise exception 'A verified listing payment is required'; end if;
 if receipt.used_property_id is not null then
   select * into result from public.properties where id=receipt.used_property_id;
   if not found then raise exception 'This payment was already used for a deleted listing'; end if;
   return result;
 end if;
 offer=lower(coalesce(p_property->>'offer_type',p_property->>'listing_type'));
 offer=case offer when 'hotel' then 'stay' when 'sale' then 'buy' else offer end;
 period=p_property->>'price_period';
 if offer is null or offer not in ('rent','buy','stay') then raise exception 'Choose rent, buy or stay'; end if;
 if period is null or (offer='buy' and period<>'sale') or (offer='rent' and period not in ('year','month'))
   or (offer='stay' and period not in ('day','night')) then raise exception 'Invalid price period'; end if;
 if coalesce(length(btrim(p_property->>'title')),0)<3 or coalesce(length(btrim(p_property->>'location')),0)<2
   or coalesce(length(btrim(p_property->>'city')),0)<2 or coalesce((p_property->>'price')::numeric,0)<=0
   or (p_property->>'price')::numeric='NaN'::numeric then raise exception 'Complete valid property details'; end if;
 photos=array(select jsonb_array_elements_text(coalesce(p_property->'photos','[]'::jsonb)));
 if cardinality(photos) not between 1 and 20 or exists(select 1 from unnest(photos) url where url !~ '^https://[^/[:space:]]+')
 then raise exception 'Add between 1 and 20 HTTPS property photos'; end if;
 if coalesce((p_property->>'bedrooms')::int,0)<0 or coalesce((p_property->>'bathrooms')::int,0)<0
   or coalesce((p_property->>'parking')::int,0)<0 then raise exception 'Invalid room count'; end if;
 if length(coalesce(p_property->>'description',''))<10 then raise exception 'Add a property description'; end if;
 if coalesce(p_property->>'video_url','')<>'' and (p_property->>'video_url') !~ '^https://[^/[:space:]]+'
 then raise exception 'Invalid property video'; end if;
 insert into public.properties(owner_id,title,listing_type,property_type,location,city,price,price_period,
 bedrooms,bathrooms,parking,description,photos,video_url,amenities,is_verified,is_featured,status,offer_type)
 values(auth.uid(),p_property->>'title',case when offer='stay' then 'hotel' else offer end,
 p_property->>'property_type',p_property->>'location',p_property->>'city',(p_property->>'price')::numeric,period,
 coalesce((p_property->>'bedrooms')::int,0),coalesce((p_property->>'bathrooms')::int,0),coalesce((p_property->>'parking')::int,0),
 p_property->>'description',photos,coalesce(p_property->>'video_url',''),
 array(select jsonb_array_elements_text(coalesce(p_property->'amenities','[]'::jsonb))),false,false,'active',offer)
 returning * into result;
 update public.nf_payment_receipts set used_property_id=result.id where reference=p_reference;
 return result;
end; $$;
revoke all on function public.publish_property_with_payment(text,jsonb) from public,anon;
grant execute on function public.publish_property_with_payment(text,jsonb) to authenticated;
commit;
select 'Three-day trial and verified payment functions installed' as result;
