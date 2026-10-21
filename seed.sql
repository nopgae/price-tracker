-- 샘플 데이터 (선택): Supabase SQL Editor 에서 schema.sql 다음에 실행하세요.
-- 상품 5개 + 상품마다 최근 30일간 가격 기록을 만듭니다.

with p as (
  insert into public.products (name, store, url, target_price) values
    ('제주 삼다수 2L x 12병',          '쿠팡',     'https://www.coupang.com/',   9900),
    ('커클랜드 시그니처 아몬드 1.36kg', '코스트코', 'https://www.costco.co.kr/',  21000),
    ('에어팟 프로 2세대 (USB-C)',       '네이버',   'https://shopping.naver.com/', 279000),
    ('로지텍 MX Master 3S',            '11번가',   'https://www.11st.co.kr/',    115000),
    ('다이슨 V12 디텍트 슬림',          '기타',     null,                         799000)
  returning id, name
)
insert into public.price_logs (product_id, price, logged_at)
select p.id, v.price, now() - make_interval(days => v.days_ago)
from p
join (values
  -- 삼다수: 최근가가 목표가 이하 → "목표가 도달"
  ('제주 삼다수 2L x 12병', 11900, 28), ('제주 삼다수 2L x 12병', 11500, 21),
  ('제주 삼다수 2L x 12병', 10900, 14), ('제주 삼다수 2L x 12병', 11200, 7),
  ('제주 삼다수 2L x 12병',  9800, 1),
  -- 아몬드: 오르내림
  ('커클랜드 시그니처 아몬드 1.36kg', 23990, 27), ('커클랜드 시그니처 아몬드 1.36kg', 22990, 18),
  ('커클랜드 시그니처 아몬드 1.36kg', 24490, 9),  ('커클랜드 시그니처 아몬드 1.36kg', 23490, 2),
  -- 에어팟: 하락 중이지만 목표가 미도달
  ('에어팟 프로 2세대 (USB-C)', 359000, 30), ('에어팟 프로 2세대 (USB-C)', 339000, 22),
  ('에어팟 프로 2세대 (USB-C)', 319000, 15), ('에어팟 프로 2세대 (USB-C)', 329000, 8),
  ('에어팟 프로 2세대 (USB-C)', 299000, 3),  ('에어팟 프로 2세대 (USB-C)', 289000, 0),
  -- 마우스: 목표가 도달
  ('로지텍 MX Master 3S', 139000, 20), ('로지텍 MX Master 3S', 125000, 10),
  ('로지텍 MX Master 3S', 112900, 1),
  -- 청소기: 기록 1개
  ('다이슨 V12 디텍트 슬림', 899000, 5)
) as v(name, price, days_ago) on v.name = p.name;
