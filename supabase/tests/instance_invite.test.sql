-- The invite code is the API's alone: the server reads and rotates it with the
-- secret key; the browser keys cannot see it, or the join link would be
-- readable by anyone holding the publishable key every page carries.
begin;
select plan(6);

select is(has_table_privilege('anon', 'public.instance_settings', 'SELECT'), false,
  'anon cannot read the invite code');
select is(has_table_privilege('authenticated', 'public.instance_settings', 'SELECT'), false,
  'authenticated cannot read the invite code');
select is(has_table_privilege('authenticated', 'public.instance_settings', 'UPDATE'), false,
  'authenticated cannot rotate the invite code');
select is(has_table_privilege('service_role', 'public.instance_settings', 'SELECT'), true,
  'service_role reads the invite code (the API serves it to members)');
select is(has_table_privilege('service_role', 'public.instance_settings', 'INSERT'), true,
  'service_role creates the row on first use');
select is(has_table_privilege('service_role', 'public.instance_settings', 'UPDATE'), true,
  'service_role rotates the invite code');

select * from finish();
rollback;
