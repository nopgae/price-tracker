-- 상품 이미지 URL 컬럼 추가 (선택)
-- Supabase SQL Editor 에서 한 번 실행하세요. 실행 전에도 앱은 동작하며, 이미지 입력란만 숨겨집니다.
alter table public.products add column if not exists image_url text;
