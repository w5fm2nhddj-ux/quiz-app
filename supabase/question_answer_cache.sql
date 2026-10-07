-- Run this in Supabase Dashboard > SQL Editor for the target project.
create table if not exists public.question_answer_cache (
  id uuid primary key default gen_random_uuid(),
  question_hash text not null unique check (question_hash ~ '^[0-9a-f]{64}$'),
  question_text text not null,
  options jsonb not null default '[]'::jsonb,
  question_type text not null check (question_type in ('single', 'multiple', 'true_false', 'fill', 'short_answer')),
  answer jsonb not null,
  explanation text not null default '',
  knowledge_points text[] not null default '{}'::text[],
  option_explanations jsonb not null default '[]'::jsonb,
  related_questions jsonb not null default '[]'::jsonb,
  answer_source text not null check (answer_source in ('original', 'ai', 'manual')),
  ai_model text,
  usage_count bigint not null default 0 check (usage_count >= 0),
  subject text,
  confidence numeric(4, 3),
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists question_answer_cache_subject_idx
  on public.question_answer_cache (subject);

alter table public.question_answer_cache enable row level security;
revoke all on table public.question_answer_cache from anon, authenticated;
grant all on table public.question_answer_cache to service_role;

-- Atomic usage increment, so concurrent cache hits cannot overwrite each other's count.
create or replace function public.increment_question_cache_usage(p_question_hash text)
returns setof public.question_answer_cache
language sql
security definer
set search_path = public
as $$
  update public.question_answer_cache
  set usage_count = usage_count + 1,
      updated_at = now()
  where question_hash = p_question_hash
  returning *;
$$;

revoke all on function public.increment_question_cache_usage(text) from public, anon, authenticated;
grant execute on function public.increment_question_cache_usage(text) to service_role;
