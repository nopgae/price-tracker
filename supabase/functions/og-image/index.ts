// og-image: 상품 페이지 URL 을 받아 대표 이미지(og:image 등)와 제목을 돌려주는 Edge Function
// 요청:  POST { "url": "https://..." }
// 응답:  200 { "image": "https://...jpg" | null, "title": "..." | null, "finalUrl": "..." }
//        4xx/5xx { "error": "사유" }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_HTML = 1_500_000;   // head 만 있으면 되므로 1.5MB 까지만 읽음
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

// 내부망/메타데이터 주소로의 요청 차단 (SSRF 방지)
function isBlockedHost(host: string) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(":")) return true;  // IPv6 리터럴은 허용하지 않음
  return false;
}

function checkUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("올바른 URL이 아닙니다."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("http(s) 주소만 사용할 수 있습니다.");
  if (isBlockedHost(u.hostname)) throw new Error("이 주소는 사용할 수 없습니다.");
  return u;
}

async function fetchHtml(start: URL): Promise<{ html: string; finalUrl: URL }> {
  let url = start;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = checkUrl(new URL(res.headers.get("location")!, url).href);
      await res.body?.cancel();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(res.status === 403 || res.status === 429
        ? `사이트가 자동 접근을 막았습니다 (HTTP ${res.status}).`
        : `페이지를 불러오지 못했습니다 (HTTP ${res.status}).`);
    }
    const type = res.headers.get("content-type") || "";
    if (type.startsWith("image/")) {
      await res.body?.cancel();
      return { html: `<meta property="og:image" content="${url.href}">`, finalUrl: url };
    }

    // 본문을 조금씩 읽다가 </head> 를 만나거나 한도에 닿으면 중단
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const dec = new TextDecoder();
    let text = "";
    while (size < MAX_HTML) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      text += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(text)) break;
    }
    await reader.cancel().catch(() => {});
    return { html: text, finalUrl: url };
  }
  throw new Error("리디렉션이 너무 많습니다.");
}

function decodeEntities(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function attrs(tag: string) {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return out;
}

export function extract(html: string, base: URL) {
  const meta: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property || a.name || a.itemprop || "").toLowerCase();
    if (key && a.content && !(key in meta)) meta[key] = a.content.trim();
  }
  let linkImage = "";
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if ((a.rel || "").toLowerCase() === "image_src" && a.href) { linkImage = a.href; break; }
  }
  let ldImage = "";
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const hit = m[1].match(/"image"\s*:\s*(?:\[\s*)?(?:\{[^}]*?"url"\s*:\s*)?"([^"]+)"/);
    if (hit) { ldImage = hit[1].replace(/\\\//g, "/"); break; }
  }

  const candidates = [
    meta["og:image:secure_url"], meta["og:image"], meta["og:image:url"],
    meta["twitter:image"], meta["twitter:image:src"], meta["image"], linkImage, ldImage,
  ].filter(Boolean) as string[];

  let image: string | null = null;
  for (const c of candidates) {
    try {
      const u = new URL(c, base);
      if (u.protocol === "http:" || u.protocol === "https:") {
        if (u.protocol === "http:") u.protocol = "https:";   // 혼합 콘텐츠 방지
        image = u.href;
        break;
      }
    } catch { /* 다음 후보 */ }
  }

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (meta["og:title"] || meta["twitter:title"] || (titleTag ? decodeEntities(titleTag[1]) : "") || "")
    .replace(/\s+/g, " ").trim() || null;

  return { image, title };
}

// 코스트코 코리아는 페이지가 JS 로 그려져 og:image 가 없음 → 사이트가 쓰는 상품 JSON 에서 이미지 추출
async function costco(u: URL) {
  const code = u.pathname.match(/\/p\/(\d+)/)?.[1];
  if (!code) return null;
  const res = await fetch(`https://www.costco.co.kr/rest/v2/korea/products/${code}?fields=FULL&lang=ko&curr=KRW`, {
    headers: { ...BROWSER_HEADERS, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) { await res.body?.cancel(); return null; }
  const j = await res.json();
  const imgs: { format?: string; imageType?: string; url?: string }[] = j.images || [];
  const pick = imgs.find((i) => i.format === "product" && i.imageType === "PRIMARY")
    || imgs.find((i) => i.format === "product") || imgs.find((i) => i.url);
  return {
    image: pick?.url ? new URL(pick.url, "https://www.costco.co.kr").href : null,
    title: j.name || null,
  };
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST 요청만 받습니다." }, 405);

  let raw = "";
  try { raw = String((await req.json()).url || ""); } catch { /* 아래에서 처리 */ }
  if (!raw) return json({ error: "url 값이 필요합니다." }, 400);

  let target: URL;
  try { target = checkUrl(raw); } catch (e) { return json({ error: (e as Error).message }, 400); }

  try {
    if (/(^|\.)costco\.co\.kr$/.test(target.hostname)) {
      const hit = await costco(target).catch(() => null);
      if (hit?.image) return json({ ...hit, finalUrl: target.href });
    }
    const { html, finalUrl } = await fetchHtml(target);
    const { image, title } = extract(html, finalUrl);
    return json({ image, title, finalUrl: finalUrl.href });
  } catch (e) {
    const msg = (e as Error).name === "TimeoutError" ? "사이트 응답이 너무 느립니다." : (e as Error).message;
    return json({ error: msg }, 502);
  }
}

Deno.serve(handler);
