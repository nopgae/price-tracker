-- 상품 이미지: 사진 업로드(Supabase Storage) + 기존 상품의 이미지 변경 허용
-- Supabase SQL Editor 에서 한 번 실행하세요.

-- 1) 공개 이미지 버킷 (파일당 5MB, 이미지 형식만)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- 2) 업로드 허용 (공개 버킷이라 읽기 정책은 필요 없음)
create policy "upload product images" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'product-images');

-- 3) products 는 image_url 컬럼만 수정 가능 (이름·가격 등은 계속 수정 불가)
alter table public.products add column if not exists image_url text;
revoke update on public.products from anon, authenticated;
grant update (image_url) on public.products to anon, authenticated;
create policy "change product image" on public.products
  for update to anon, authenticated
  using (true) with check (true);
