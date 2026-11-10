-- Who was invited is the API's alone: the server keeps the list with the
-- secret key; the browser keys cannot read it.
begin;
select plan(5);

select is(has_table_privilege('anon', 'public.instance_invites', 'SELECT'), false,
  'anon cannot read the invite list');
select is(has_table_privilege('authenticated', 'public.instance_invites', 'SELECT'), false,
  'authenticated cannot read the invite list');
select is(has_table_privilege('authenticated', 'public.instance_invites', 'INSERT'), false,
  'authenticated cannot invite around the API');
select is(has_table_privilege('service_role', 'public.instance_invites', 'INSERT'), true,
  'service_role adds an invited address');
select is(has_table_privilege('service_role', 'public.instance_invites', 'DELETE'), true,
  'service_role withdraws an invite');

select * from finish();
rollback;
