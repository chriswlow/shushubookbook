-- Run this in your Supabase SQL Editor

-- Books table
create table books (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  author text,
  created_at timestamptz default now()
);

-- Quotes table
create table quotes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  book_id uuid references books(id) on delete cascade not null,
  text text not null,
  page_number integer,
  source text default 'manual', -- 'manual', 'upload', 'ai'
  created_at timestamptz default now()
);

-- User settings table
create table user_settings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  frequency text default 'daily', -- 'daily', 'weekly', 'monthly'
  delivery_email text,
  language text default 'en',
  paused boolean default false,
  last_sent_at timestamptz,
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table books enable row level security;
alter table quotes enable row level security;
alter table user_settings enable row level security;

-- RLS Policies: users can only see their own data
create policy "Users can manage their own books"
  on books for all using (auth.uid() = user_id);

create policy "Users can manage their own quotes"
  on quotes for all using (auth.uid() = user_id);

create policy "Users can manage their own settings"
  on user_settings for all using (auth.uid() = user_id);

-- Migration: run this if the table already exists
-- alter table user_settings add column if not exists paused boolean default false;
-- alter table user_settings add column if not exists recent_sent_quotes jsonb default '[]'::jsonb;
