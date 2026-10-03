-- Read-only metadata inspection for the next database repair stage.
-- Does not select customer rows, secrets, messages or account records.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

select tablename, rowsecurity
from pg_tables where schemaname = 'public'
order by tablename;

select table_name, constraint_name, constraint_type
from information_schema.table_constraints
where table_schema = 'public'
order by table_name, constraint_name;
