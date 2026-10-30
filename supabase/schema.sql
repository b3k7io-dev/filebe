-- RELEASE SAFETY: DEMO ONLY. This schema creates one global common room.
-- Every authenticated user of this project can read all messages and attachments.
-- Do not run for real users or confidential data; design room membership and Storage RLS first.
-- Выполнить один раз в SQL Editor нового Supabase-проекта.
-- ВНИМАНИЕ: общий канал. Каждый authenticated пользователь читает ВСЕ сообщения/вложения.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references auth.users(id) on delete cascade default auth.uid(),
  body text not null default '' check (length(body) <= 10000),
  attachment_path text,
  attachment_name text,
  attachment_size bigint check (attachment_size between 0 and 8388608),
  created_at timestamptz not null default now(),
  constraint message_not_empty check (length(trim(body)) > 0 or attachment_path is not null),
  constraint attachment_complete check (
    (attachment_path is null and attachment_name is null and attachment_size is null)
    or (attachment_path is not null and attachment_name is not null and attachment_size is not null)
  )
);
create index messages_created_at_idx on public.messages(created_at desc);
alter table public.messages enable row level security;
revoke all on public.messages from anon;
grant select, insert on public.messages to authenticated;
create policy "Signed in users read common room" on public.messages for select to authenticated using (true);
create policy "Users send as themselves" on public.messages for insert to authenticated
with check (sender = auth.uid() and (attachment_path is null or split_part(attachment_path, '/', 1) = auth.uid()::text));

insert into storage.buckets(id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 8388608);
create policy "Room members download attachments" on storage.objects for select to authenticated
using (bucket_id = 'attachments');
create policy "Users upload in own prefix" on storage.objects for insert to authenticated
with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users remove own uploads" on storage.objects for delete to authenticated
using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
-- UPDATE не выдан; чужое сообщение/вложение нельзя заменить.
-- До публичного production: квоты, антиспам, модерация, room_members + room-specific RLS.
