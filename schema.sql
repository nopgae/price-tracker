-- 상품 가격 트래커 스키마
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run 하세요.

create table public.products (
  id           bigint generated always as identity primary key,
  name         text not null,
  store        text not null,
  url          text,
  target_price integer check (target_price > 0),
  image_url    text,
  created_at   timestamptz not null default now()
);

create table public.price_logs (
  id         bigint generated always as identity primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  price      integer not null check (price > 0),
  logged_at  timestamptz not null default now()
);

create index on public.price_logs (product_id, logged_at desc);

alter table public.products   enable row level security;
alter table public.price_logs enable row level security;

create policy "read products"  on public.products   for select to anon, authenticated using (true);
create policy "add products"   on public.products   for insert to anon, authenticated with check (true);
create policy "read logs"      on public.price_logs for select to anon, authenticated using (true);
create policy "add logs"       on public.price_logs for insert to anon, authenticated with check (true);
