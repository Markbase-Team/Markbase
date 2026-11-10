drop policy if exists "public write projects" on public.projects;
create policy "public write projects" on public.projects
  for all using (true) with check (true);;
