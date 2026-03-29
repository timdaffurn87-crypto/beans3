-- 009_storage_policies.sql
--
-- Row-level security policies for Supabase Storage buckets.
-- The buckets (invoice-photos, recipe-photos) are created manually in the
-- Supabase dashboard. This migration adds the INSERT/SELECT policies so that
-- authenticated staff can upload and view files.

-- ── invoice-photos ────────────────────────────────────────────────────────────

-- Any authenticated user can upload invoice photos
create policy "Authenticated users can upload invoice photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'invoice-photos');

-- Any authenticated user can read invoice photos
create policy "Authenticated users can read invoice photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'invoice-photos');

-- Any authenticated user can update/replace their uploads
create policy "Authenticated users can update invoice photos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'invoice-photos');

-- ── recipe-photos ─────────────────────────────────────────────────────────────

-- Any authenticated user can upload recipe photos
create policy "Authenticated users can upload recipe photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'recipe-photos');

-- Any authenticated user can read recipe photos
create policy "Authenticated users can read recipe photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'recipe-photos');

-- Managers and owners can update/delete recipe photos
create policy "Managers can update recipe photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'recipe-photos'
    and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('manager', 'owner')
    )
  );

create policy "Managers can delete recipe photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'recipe-photos'
    and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role in ('manager', 'owner')
    )
  );
