import asyncio
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from ..config import CHROME_PROFILE_DIR, SCREENSHOTS_DIR
from ..security import validate_local_service_url, validate_target_url
from .captcha_solver import (
    detect_cloudflare_or_captcha,
    solve_token_with_2captcha,
    solve_token_with_capsolver,
    solve_with_flaresolverr,
)

logger = logging.getLogger(__name__)

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Sec-Ch-Ua": '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Upgrade-Insecure-Requests": "1",
}

STEALTH_INIT_SCRIPT = """
(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = window.chrome || { runtime: {}, loadTimes: () => {}, csi: () => {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
    const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (originalQuery) {
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : originalQuery(parameters)
        );
    }
})();
"""


async def fetch_tier1_fast_tls(
    url: str,
    cookie_header: Optional[str] = None,
    proxy_url: Optional[str] = None,
    timeout_sec: float = 20.0,
) -> Dict[str, Any]:
    """
    Tier 1: Fast HTTP fetch with Chrome TLS JA3/JA4 impersonation via curl_cffi
    (with graceful fallback to httpx if curl_cffi is unavailable).
    """
    headers = dict(DEFAULT_HEADERS)
    if cookie_header:
        headers["Cookie"] = cookie_header

    # Attempt curl_cffi impersonation first
    try:
        from curl_cffi.requests import AsyncSession

        async with AsyncSession(
            impersonate="chrome124",
            proxies={"http": proxy_url, "https": proxy_url} if proxy_url else None,
            timeout=timeout_sec,
            verify=True,
        ) as session:
            resp = await session.get(url, headers=headers, allow_redirects=True)
            return {
                "html": resp.text or "",
                "status_code": resp.status_code,
                "final_url": str(resp.url),
                "tier_used": "Tier 1: curl_cffi (Chrome TLS Impersonation)",
                "xhr_payloads": [],
                "screenshot_filename": None,
            }
    except Exception as exc:
        logger.debug("curl_cffi fallback to httpx for %s: %s", url, exc)

    # Fallback to httpx
    async with httpx.AsyncClient(
        headers=headers,
        proxy=proxy_url if proxy_url else None,
        follow_redirects=True,
        timeout=timeout_sec,
    ) as client:
        resp = await client.get(url)
        return {
            "html": resp.text or "",
            "status_code": resp.status_code,
            "final_url": str(resp.url),
            "tier_used": "Tier 1: Fast HTTPX Client",
            "xhr_payloads": [],
            "screenshot_filename": None,
        }


async def fetch_tier2_playwright_stealth(
    url: str,
    scroll_times: int = 3,
    cookie_header: Optional[str] = None,
    proxy_url: Optional[str] = None,
    use_cdp: bool = False,
    cdp_url: str = "http://127.0.0.1:9222",
    use_persistent_profile: bool = False,
    capsolver_key: Optional[str] = None,
    twocaptcha_key: Optional[str] = None,
    take_screenshot: bool = True,
) -> Dict[str, Any]:
    """
    Tier 2: Playwright Stealth Headless Browser / Chrome CDP / Persistent Profile
    + Network XHR/GraphQL JSON Sniffer + Infinite Scroll + Auto Captcha Token Injection + Screenshot.
    """
    from playwright.async_api import async_playwright

    captured_xhr: List[Dict[str, Any]] = []
    screenshot_name: Optional[str] = None

    async with async_playwright() as p:
        browser = None
        context = None

        try:
            if use_cdp and cdp_url:
                safe_cdp = validate_local_service_url(cdp_url)
                browser = await p.chromium.connect_over_cdp(safe_cdp)
                context = browser.contexts[0] if browser.contexts else await browser.new_context()
                tier_label = "Tier 2b: Real Chrome CDP Session"
            elif use_persistent_profile:
                launch_kwargs: Dict[str, Any] = {
                    "user_data_dir": str(CHROME_PROFILE_DIR),
                    "headless": True,
                    "viewport": {"width": 1440, "height": 900},
                    "user_agent": DEFAULT_HEADERS["User-Agent"],
                    "args": ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
                }
                if proxy_url:
                    launch_kwargs["proxy"] = {"server": proxy_url}
                context = await p.chromium.launch_persistent_context(**launch_kwargs)
                tier_label = "Tier 2b: Persistent Chrome Profile"
            else:
                launch_args = ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
                proxy_cfg = {"server": proxy_url} if proxy_url else None
                browser = await p.chromium.launch(headless=True, args=launch_args, proxy=proxy_cfg)
                context = await browser.new_context(
                    viewport={"width": 1440, "height": 900},
                    user_agent=DEFAULT_HEADERS["User-Agent"],
                    locale="vi-VN",
                )
                tier_label = "Tier 2: Playwright Stealth + XHR Sniffer"

            await context.add_init_script(STEALTH_INIT_SCRIPT)

            if cookie_header:
                extra_headers = {"Cookie": cookie_header}
                await context.set_extra_http_headers(extra_headers)

            page = await context.new_page()

            # Attach Network XHR/Fetch/GraphQL Interceptor
            async def _on_response(response):
                try:
                    rtype = response.request.resource_type
                    ctype = (response.headers.get("content-type") or "").lower()
                    if rtype in ("xhr", "fetch") and "json" in ctype and response.status == 200:
                        body_bytes = await response.body()
                        if 100 < len(body_bytes) < 2_500_000:
                            parsed_json = json.loads(body_bytes.decode("utf-8", errors="ignore"))
                            captured_xhr.append(
                                {
                                    "url": response.url,
                                    "data": parsed_json,
                                }
                            )
                except Exception:
                    pass

            page.on("response", _on_response)

            resp = await page.goto(url, wait_until="domcontentloaded", timeout=35000)
            status_code = resp.status if resp else 200
            await page.wait_for_timeout(1800)

            html_content = await page.content()
            cf_check = detect_cloudflare_or_captcha(html_content, status_code)

            # If blocked by Turnstile/Captcha and API solver keys are configured, solve & inject automatically
            if cf_check["blocked"] and cf_check.get("sitekey"):
                sitekey = cf_check["sitekey"]
                ctype = cf_check["type"] or "cloudflare_turnstile"
                solved_token = None
                if capsolver_key:
                    solved_token = await solve_token_with_capsolver(url, sitekey, capsolver_key, ctype)
                if not solved_token and twocaptcha_key:
                    solved_token = await solve_token_with_2captcha(url, sitekey, twocaptcha_key, ctype)

                if solved_token:
                    await page.evaluate(
                        """(token) => {
                            const inputs = document.querySelectorAll(
                                '[name="cf-turnstile-response"], [name="g-recaptcha-response"], [name="h-captcha-response"]'
                            );
                            inputs.forEach(el => { el.value = token; });
                            const form = document.querySelector('form');
                            if (form) form.submit();
                        }""",
                        solved_token,
                    )
                    await page.wait_for_timeout(3500)
                    html_content = await page.content()
                    tier_label += " + Auto Captcha Token Solved"

            # Perform Infinite Scroll & "Load More" button clicks
            for _ in range(max(0, scroll_times)):
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await page.wait_for_timeout(900)
                # Try clicking common non-navigational "Load more / Xem thêm" buttons
                try:
                    load_more = page.locator(
                        "button:has-text('Xem thêm'), button:has-text('Load more'), button:has-text('Show more')"
                    ).first
                    if await load_more.is_visible(timeout=400):
                        await load_more.click(timeout=1000)
                        await page.wait_for_timeout(900)
                except Exception:
                    pass

            html_content = await page.content()
            final_url = page.url

            if take_screenshot:
                screenshot_name = f"run_{int(time.time())}_{uuid.uuid4().hex[:6]}.png"
                screenshot_path: Path = SCREENSHOTS_DIR / screenshot_name
                try:
                    await page.screenshot(path=str(screenshot_path), full_page=False)
                except Exception as sc_err:
                    logger.debug("Screenshot capture skipped: %s", sc_err)
                    screenshot_name = None

            return {
                "html": html_content,
                "status_code": status_code,
                "final_url": final_url,
                "tier_used": tier_label,
                "xhr_payloads": captured_xhr[:25],
                "screenshot_filename": screenshot_name,
            }
        finally:
            if context and not use_cdp:
                try:
                    await context.close()
                except Exception:
                    pass
            if browser and not use_cdp:
                try:
                    await browser.close()
                except Exception:
                    pass


async def smart_multi_tier_fetch(
    raw_url: str,
    bypass_mode: str = "auto",
    scroll_times: int = 2,
    settings: Optional[Dict[str, str]] = None,
    proxy_url: Optional[str] = None,
    take_screenshot: bool = True,
) -> Dict[str, Any]:
    """
    Orchestrate the 4-Tier Unattended Bypass Engine:
    - Validates URL against SSRF
    - Executes requested tier or Auto-Cascade:
      Tier 1 (curl_cffi) -> Check Cloudflare/SPA -> Tier 2 (Playwright Stealth + XHR Sniffer)
      -> Tier 3 (FlareSolverr / CapSolver / 2Captcha / Chrome CDP)
    """
    target_url = validate_target_url(raw_url)
    cfg = settings or {}
    cookie_header = cfg.get("custom_cookie_header", "")
    flaresolverr_url = cfg.get("flaresolverr_url", "")
    cdp_url = cfg.get("chrome_cdp_url", "")
    capsolver_key = cfg.get("capsolver_api_key", "")
    twocaptcha_key = cfg.get("twocaptcha_api_key", "")

    logs: List[str] = [f"[Fetcher] Target validated: {target_url} (Mode: {bypass_mode})"]

    # Explicit FlareSolverr mode
    if bypass_mode == "flaresolverr" and flaresolverr_url:
        try:
            res = await solve_with_flaresolverr(target_url, flaresolverr_url, proxy_url)
            logs.append("[Fetcher] Solved via FlareSolverr successfully.")
            return {
                "html": res["html"],
                "status_code": res["status_code"],
                "final_url": target_url,
                "tier_used": "Tier 3: FlareSolverr Challenge Solver",
                "xhr_payloads": [],
                "screenshot_filename": None,
                "logs": logs,
            }
        except Exception as exc:
            logs.append(f"[Fetcher] FlareSolverr failed ({exc}), falling back to Cascade.")

    # Explicit Chrome CDP mode
    if bypass_mode == "chrome_cdp":
        try:
            res = await fetch_tier2_playwright_stealth(
                target_url,
                scroll_times=scroll_times,
                cookie_header=cookie_header,
                proxy_url=proxy_url,
                use_cdp=bool(cdp_url),
                cdp_url=cdp_url or "http://127.0.0.1:9222",
                use_persistent_profile=not bool(cdp_url),
                capsolver_key=capsolver_key,
                twocaptcha_key=twocaptcha_key,
                take_screenshot=take_screenshot,
            )
            res["logs"] = logs + [f"[Fetcher] Completed via {res['tier_used']}."]
            return res
        except Exception as exc:
            logs.append(f"[Fetcher] Chrome CDP/Profile failed ({exc}), falling back to Tier 1.")

    # Explicit Stealth Browser mode
    if bypass_mode == "stealth_browser":
        try:
            res = await fetch_tier2_playwright_stealth(
                target_url,
                scroll_times=scroll_times,
                cookie_header=cookie_header,
                proxy_url=proxy_url,
                capsolver_key=capsolver_key,
                twocaptcha_key=twocaptcha_key,
                take_screenshot=take_screenshot,
            )
            res["logs"] = logs + [f"[Fetcher] Completed via {res['tier_used']}."]
            return res
        except Exception as exc:
            logs.append(f"[Fetcher] Playwright Stealth failed ({exc}), falling back to Tier 1 Fast TLS.")

    # Tier 1: Fast TLS Impersonation (Default first step in 'auto' and 'fast_tls')
    tier1_res: Optional[Dict[str, Any]] = None
    try:
        tier1_res = await fetch_tier1_fast_tls(target_url, cookie_header=cookie_header, proxy_url=proxy_url)
        html_t1 = tier1_res.get("html", "")
        status_t1 = tier1_res.get("status_code", 200)
        cf_info = detect_cloudflare_or_captcha(html_t1, status_t1)

        # Check if Tier 1 succeeded and isn't an empty SPA shell or Cloudflare block
        is_thin_spa = len(html_t1.strip()) < 3500 or (
            '<div id="root"></div>' in html_t1 and "__NEXT_DATA__" not in html_t1
        )
        if not cf_info["blocked"] and not is_thin_spa and status_t1 < 400:
            logs.append(
                f"[Fetcher] {tier1_res['tier_used']} succeeded (HTTP {status_t1}, {len(html_t1)} chars)."
            )
            if bypass_mode == "fast_tls":
                tier1_res["logs"] = logs
                return tier1_res
            # In auto mode, if user wants screenshot or scroll > 0 and Playwright is available, try enriching
            if not take_screenshot and scroll_times == 0:
                tier1_res["logs"] = logs
                return tier1_res
        else:
            reason = cf_info["type"] if cf_info["blocked"] else f"SPA/Status {status_t1}"
            logs.append(f"[Fetcher] Tier 1 detected protection or dynamic SPA ({reason}). Escalating to Tier 2...")
    except Exception as t1_err:
        logs.append(f"[Fetcher] Tier 1 error ({t1_err}). Escalating to Tier 2...")

    if bypass_mode == "fast_tls" and tier1_res:
        tier1_res["logs"] = logs
        return tier1_res

    # Tier 2: Playwright Stealth + Network XHR Sniffer + Auto Captcha Solver
    try:
        tier2_res = await fetch_tier2_playwright_stealth(
            target_url,
            scroll_times=scroll_times,
            cookie_header=cookie_header,
            proxy_url=proxy_url,
            capsolver_key=capsolver_key,
            twocaptcha_key=twocaptcha_key,
            take_screenshot=take_screenshot,
        )
        cf_t2 = detect_cloudflare_or_captcha(tier2_res.get("html", ""), tier2_res.get("status_code", 200))
        if not cf_t2["blocked"]:
            logs.append(
                f"[Fetcher] {tier2_res['tier_used']} succeeded "
                f"(captured {len(tier2_res.get('xhr_payloads', []))} XHR JSON payloads)."
            )
            tier2_res["logs"] = logs
            return tier2_res
        logs.append(f"[Fetcher] Tier 2 still encountered challenge ({cf_t2['type']}). Escalating to Tier 3...")
    except Exception as t2_err:
        logs.append(f"[Fetcher] Tier 2 Playwright unavailable or failed ({t2_err}).")

    # Tier 3: FlareSolverr fallback if configured
    if flaresolverr_url:
        try:
            fs_res = await solve_with_flaresolverr(target_url, flaresolverr_url, proxy_url)
            logs.append("[Fetcher] Tier 3 FlareSolverr bypassed challenge successfully.")
            return {
                "html": fs_res["html"],
                "status_code": fs_res["status_code"],
                "final_url": target_url,
                "tier_used": "Tier 3: FlareSolverr Unattended Bypass",
                "xhr_payloads": [],
                "screenshot_filename": None,
                "logs": logs,
            }
        except Exception as fs_err:
            logs.append(f"[Fetcher] Tier 3 FlareSolverr failed ({fs_err}).")

    # Return Tier 1 result if we have it
    if tier1_res and tier1_res.get("html"):
        logs.append("[Fetcher] Returning best available response from Tier 1.")
        tier1_res["logs"] = logs
        return tier1_res

    raise RuntimeError(f"All fetch tiers failed for {target_url}. Logs: {' | '.join(logs)}")
