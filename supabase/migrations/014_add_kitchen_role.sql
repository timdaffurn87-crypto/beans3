-- Migration: add 'kitchen' as a valid role in the profiles table
-- The existing check constraint only allows barista/manager/owner.
-- We drop and recreate it to include kitchen.

alter table profiles
  drop constraint if exists profiles_role_check;

alter table profiles
  add constraint profiles_role_check
  check (role in ('barista', 'kitchen', 'manager', 'owner'));
