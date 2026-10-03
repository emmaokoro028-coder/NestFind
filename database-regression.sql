-- Run after both repairs inside a single transaction ending with ROLLBACK.
-- Synthetic fixtures never persist and no emails or real payments are sent.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('nf.test_owner',gen_random_uuid()::text,true),
       set_config('nf.test_fresh',gen_random_uuid()::text,true),
       set_config('nf.test_expired',gen_random_uuid()::text,true);
insert into auth.users(id,email,created_at,raw_user_meta_data)
values (current_setting('nf.test_owner')::uuid,'nestfind-owner@example.invalid',now()-interval '10 days','{}'),
       (current_setting('nf.test_fresh')::uuid,'nestfind-fresh@example.invalid',now()-interval '2 days','{}'),
       (current_setting('nf.test_expired')::uuid,'nestfind-expired@example.invalid',now()-interval '4 days','{}');
insert into public.properties(id,owner_id,title,location,city,price,listing_type,status)
values ('ffffffff-0000-4000-8000-000000000001',current_setting('nf.test_owner')::uuid,'Test property','Ikeja','Lagos',100000,'rent','active');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('nf.test_fresh'))::text,true);
set local role authenticated;
do $$ begin
 if public.nf_message_access_until() <> now()+interval '1 day' then raise exception 'Three-day trial duration is wrong'; end if;
 begin
  update public.profiles set role='admin' where id=auth.uid();
  raise exception 'Self-admin escalation was allowed';
 exception when insufficient_privilege then null; end;
 update public.profiles set full_name='Safe profile edit' where id=auth.uid();
 if exists(select 1 from public.profiles where id<>auth.uid()) then raise exception 'Private profiles leaked'; end if;
 begin
  insert into public.properties(owner_id,title,location,city,price,listing_type)
  values(auth.uid(),'Bypass','Lagos','Lagos',100,'rent');
  raise exception 'Unpaid direct listing was allowed';
 exception when insufficient_privilege then null; end;
 insert into public.messages(sender_id,receiver_id,property_id,content,message)
 values(auth.uid(),current_setting('nf.test_owner')::uuid,'ffffffff-0000-4000-8000-000000000001','Hello','Hello');
 insert into public.viewing_requests(property_id,requester_id,owner_id,viewing_date,viewing_time,status)
 values('ffffffff-0000-4000-8000-000000000001',auth.uid(),current_setting('nf.test_owner')::uuid,current_date+1,'14:00','Requested');
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('nf.test_expired'))::text,true);
set local role authenticated;
do $$ begin
 if public.nf_message_access_until()>now() then raise exception 'Expired trial still active'; end if;
 begin
  insert into public.messages(sender_id,receiver_id,property_id,content,message)
  values(auth.uid(),current_setting('nf.test_owner')::uuid,'ffffffff-0000-4000-8000-000000000001','Blocked','Blocked');
  raise exception 'Expired trial message was allowed';
 exception when raise_exception then
  if sqlerrm='Expired trial message was allowed' then raise; end if;
 end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.nf_record_verified_payment('nf-regression-message',current_setting('nf.test_expired')::uuid,'messaging',null,200000);
select public.nf_record_verified_payment('nf-regression-message',current_setting('nf.test_expired')::uuid,'messaging',null,200000);
select public.nf_record_verified_payment('nf-regression-listing',current_setting('nf.test_expired')::uuid,'listing',null,1000000);
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('nf.test_expired'))::text,true);
set local role authenticated;
do $$ declare first_id uuid; second_id uuid; payload jsonb; begin
 if public.nf_message_access_until() is distinct from 'infinity'::timestamptz then raise exception 'Permanent messaging not activated'; end if;
 if (select count(*) from public.nf_payment_receipts where reference='nf-regression-message')<>1 then raise exception 'Duplicate payment activation'; end if;
 begin
  perform public.nf_record_verified_payment('forged',auth.uid(),'messaging',null,200000);
  raise exception 'Client forged a payment';
 exception when insufficient_privilege then null; end;
 insert into public.messages(sender_id,receiver_id,property_id,content,message)
 values(auth.uid(),current_setting('nf.test_owner')::uuid,'ffffffff-0000-4000-8000-000000000001','Paid unlock','Paid unlock');
 payload='{"title":"Paid test property","listing_type":"Rent","location":"Ikeja","city":"Lagos","price":100000,"price_period":"year","description":"A legitimate test description","photos":["https://example.invalid/photo.jpg"]}';
 select id into first_id from public.publish_property_with_payment('nf-regression-listing',payload);
 select id into second_id from public.publish_property_with_payment('nf-regression-listing',payload);
 if first_id is null or first_id<>second_id then raise exception 'Publication retry duplicated a listing'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('nf.test_owner'))::text,true);
set local role authenticated;
do $$ begin
 update public.messages set read_at=now() where receiver_id=auth.uid();
 update public.viewing_requests set status='Accepted' where owner_id=auth.uid();
 if not exists(select 1 from public.viewing_requests where owner_id=auth.uid() and status='Accepted') then raise exception 'Owner acceptance failed'; end if;
end $$;
reset role;
rollback;
select 'PASS: 3-day trial, expired-trial denial, permanent unlock, payment replay, paid publication replay, profile privacy, admin protection, viewing and read receipts; fixtures rolled back' as result;
