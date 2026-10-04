-- Controlled non-payment workflow checks. Always run the entire script.
-- No emails, storage objects or persistent customer records are created.
begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('nf.qa_owner',gen_random_uuid()::text,true),
       set_config('nf.qa_seeker',gen_random_uuid()::text,true),
       set_config('nf.qa_other',gen_random_uuid()::text,true),
       set_config('nf.qa_property',gen_random_uuid()::text,true);
insert into auth.users(id,email,created_at,raw_user_meta_data) values
(current_setting('nf.qa_owner')::uuid,'qa-owner@example.invalid',now(),'{}'),
(current_setting('nf.qa_seeker')::uuid,'qa-seeker@example.invalid',now(),'{}'),
(current_setting('nf.qa_other')::uuid,'qa-other@example.invalid',now(),'{}');
insert into public.properties(id,owner_id,title,location,city,price,listing_type,status)
values(current_setting('nf.qa_property')::uuid,current_setting('nf.qa_owner')::uuid,'QA property','Ikeja','Lagos',100000,'rent','active');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('nf.qa_seeker'))::text,true);
set local role authenticated;
do $$ begin
 insert into public.saved_properties(user_id,property_id) values(auth.uid(),current_setting('nf.qa_property')::uuid) on conflict(user_id,property_id) do nothing;
 insert into public.saved_properties(user_id,property_id) values(auth.uid(),current_setting('nf.qa_property')::uuid) on conflict(user_id,property_id) do nothing;
 if (select count(*) from public.saved_properties where property_id=current_setting('nf.qa_property')::uuid)<>1 then raise exception 'Favorite retry duplicated a save'; end if;
 insert into public.messages(sender_id,receiver_id,property_id,content,message) values(auth.uid(),current_setting('nf.qa_owner')::uuid,current_setting('nf.qa_property')::uuid,'QA hello','QA hello');
 insert into public.viewing_requests(property_id,requester_id,owner_id,viewing_date,viewing_time,status)
 values(current_setting('nf.qa_property')::uuid,auth.uid(),current_setting('nf.qa_owner')::uuid,current_date+1,'14:00','Requested');
 insert into public.support_messages(user_id,sender_type,content) values(auth.uid(),'user','QA help');
 begin
  insert into public.support_messages(user_id,sender_type,content) values(auth.uid(),'support','Forged reply');
  raise exception 'Support role escalation allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Another account must see none of the private fixture records.
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('nf.qa_other'))::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.saved_properties where property_id=current_setting('nf.qa_property')::uuid) then raise exception 'Saved list leaked'; end if;
 if exists(select 1 from public.messages where property_id=current_setting('nf.qa_property')::uuid) then raise exception 'Messages leaked'; end if;
 if exists(select 1 from public.viewing_requests where property_id=current_setting('nf.qa_property')::uuid) then raise exception 'Viewings leaked'; end if;
 if exists(select 1 from public.support_messages where user_id=current_setting('nf.qa_seeker')::uuid) then raise exception 'Support leaked'; end if;
 if exists(select 1 from public.notifications where property_id=current_setting('nf.qa_property')::uuid) then raise exception 'Notifications leaked'; end if;
 delete from public.saved_properties where property_id=current_setting('nf.qa_property')::uuid;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('nf.qa_owner'))::text,true);
set local role authenticated;
do $$ begin
 update public.messages set read_at=now() where property_id=current_setting('nf.qa_property')::uuid and receiver_id=auth.uid();
 if not exists(select 1 from public.messages where property_id=current_setting('nf.qa_property')::uuid and read_at is not null) then raise exception 'Read acknowledgement failed'; end if;
 begin
  update public.messages set content='Changed' where property_id=current_setting('nf.qa_property')::uuid;
  raise exception 'Message content could be changed';
 exception when raise_exception then if sqlerrm='Message content could be changed' then raise; end if; end;
 insert into public.messages(sender_id,receiver_id,property_id,content,message) values(auth.uid(),current_setting('nf.qa_seeker')::uuid,current_setting('nf.qa_property')::uuid,'QA reply','QA reply');
 update public.viewing_requests set status='Accepted' where property_id=current_setting('nf.qa_property')::uuid;
 if not exists(select 1 from public.viewing_requests where property_id=current_setting('nf.qa_property')::uuid and status='Accepted') then raise exception 'Viewing acceptance failed'; end if;
 update public.notifications set is_read=true where property_id=current_setting('nf.qa_property')::uuid and user_id=auth.uid();
 if not exists(select 1 from public.notifications where property_id=current_setting('nf.qa_property')::uuid and is_read) then raise exception 'Notification acknowledgement failed'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('nf.qa_seeker'))::text,true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.saved_properties where property_id=current_setting('nf.qa_property')::uuid)<>1 then raise exception 'Another account deleted the saved property'; end if;
 if (select count(*) from public.messages where property_id=current_setting('nf.qa_property')::uuid)<>2 then raise exception 'Conversation reply missing'; end if;
 update public.viewing_requests set status='Cancelled' where property_id=current_setting('nf.qa_property')::uuid;
 if not exists(select 1 from public.viewing_requests where property_id=current_setting('nf.qa_property')::uuid and status='Cancelled') then raise exception 'Viewing cancellation failed'; end if;
 delete from public.saved_properties where user_id=auth.uid() and property_id=current_setting('nf.qa_property')::uuid;
 if exists(select 1 from public.saved_properties where property_id=current_setting('nf.qa_property')::uuid) then raise exception 'Favorite removal failed'; end if;
end $$;
reset role;
rollback;
select 'PASS: three-account privacy, saved-property retry/removal, two-way messaging, read acknowledgements, viewing acceptance/cancellation, notifications and support permissions. All fixtures rolled back.' as result;
