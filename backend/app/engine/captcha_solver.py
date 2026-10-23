import asyncio
import logging
import re
from typing import Any, Dict, Optional

import httpx

from ..security import validate_local_service_url

logger = logging.getLogger(__name__)


def detect_cloudflare_or_captcha(html: str, status_code: int) -> Dict[str, Any]:
    """
    Inspect response HTML and HTTP status to detect Cloudflare Turnstile, JS Challenge,
    reCAPTCHA, or hCaptcha blocks.
    """
    if not html:
        return {"blocked": status_code in (403, 503), "type": "empty_response", "sitekey": None}

    lower_html = html[:15000].lower()
    cf_markers = [
        "just a moment...",
        "cf-browser-verification",
        "cf-chl-bypass",
        "challenges.cloudflare.com/turnstile",
        "attention required! | cloudflare",
        "_cf_chl_opt",
        "verify you are human",
    ]
    is_cf = any(marker in lower_html for marker in cf_markers) and (
        status_code in (403, 503, 429) or len(html) < 25000
    )

    sitekey_match = re.search(r'data-sitekey=["\']([0-9a-zA-Z_-]{20,60})["\']', html)
    sitekey = sitekey_match.group(1) if sitekey_match else None

    if is_cf:
        return {"blocked": True, "type": "cloudflare_turnstile", "sitekey": sitekey}

    if "g-recaptcha" in lower_html and status_code in (403, 429, 503):
        return {"blocked": True, "type": "recaptcha_v2", "sitekey": sitekey}

    if "h-captcha" in lower_html and status_code in (403, 429, 503):
        return {"blocked": True, "type": "hcaptcha", "sitekey": sitekey}

    return {"blocked": False, "type": None, "sitekey": None}


async def solve_with_flaresolverr(
    target_url: str,
    flaresolverr_url: str = "http://127.0.0.1:8191/v1",
    proxy_url: Optional[str] = None,
    timeout_ms: int = 60000,
) -> Dict[str, Any]:
    """
    Solve Cloudflare Turnstile / IUAM challenge automatically via FlareSolverr service.
    Returns HTML, solved cookies, and User-Agent.
    """
    validated_endpoint = validate_local_service_url(flaresolverr_url)
    payload: Dict[str, Any] = {
        "cmd": "request.get",
        "url": target_url,
        "maxTimeout": timeout_ms,
    }
    if proxy_url:
        payload["proxy"] = {"url": proxy_url}

    async with httpx.AsyncClient(timeout=timeout_ms / 1000.0 + 10.0) as client:
        resp = await client.post(validated_endpoint, json=payload)
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") != "ok":
            raise RuntimeError(f"FlareSolverr error: {data.get('message', 'Unknown error')}")
        solution = data.get("solution", {})
        cookies_list = solution.get("cookies", [])
        cookie_header = "; ".join(f"{c.get('name')}={c.get('value')}" for c in cookies_list if c.get("name"))
        return {
            "html": solution.get("response", ""),
            "status_code": solution.get("status", 200),
            "user_agent": solution.get("userAgent", ""),
            "cookie_header": cookie_header,
            "cookies": cookies_list,
            "solver": "FlareSolverr",
        }


async def solve_token_with_capsolver(
    target_url: str,
    sitekey: str,
    api_key: str,
    captcha_type: str = "cloudflare_turnstile",
) -> Optional[str]:
    """
    Solve Turnstile / reCAPTCHA / hCaptcha token via CapSolver API (100% unattended).
    """
    if not api_key or not sitekey:
        return None

    task_type_map = {
        "cloudflare_turnstile": "AntiTurnstileTaskProxyLess",
        "recaptcha_v2": "ReCaptchaV2TaskProxyLess",
        "hcaptcha": "HCaptchaTaskProxyLess",
    }
    task_type = task_type_map.get(captcha_type, "AntiTurnstileTaskProxyLess")

    async with httpx.AsyncClient(timeout=30.0) as client:
        create_resp = await client.post(
            "https://api.capsolver.com/createTask",
            json={
                "clientKey": api_key,
                "task": {
                    "type": task_type,
                    "websiteURL": target_url,
                    "websiteKey": sitekey,
                },
            },
        )
        create_data = create_resp.json()
        task_id = create_data.get("taskId")
        if not task_id:
            logger.warning("CapSolver createTask failed: %s", create_data.get("errorDescription"))
            return None

        for _ in range(25):
            await asyncio.sleep(2.5)
            res_resp = await client.post(
                "https://api.capsolver.com/getTaskResult",
                json={"clientKey": api_key, "taskId": task_id},
            )
            res_data = res_resp.json()
            status_val = res_data.get("status")
            if status_val == "ready":
                solution = res_data.get("solution", {})
                return solution.get("token") or solution.get("gRecaptchaResponse")
            if status_val == "failed":
                break

    return None


async def solve_token_with_2captcha(
    target_url: str,
    sitekey: str,
    api_key: str,
    captcha_type: str = "cloudflare_turnstile",
) -> Optional[str]:
    """
    Solve Turnstile / reCAPTCHA / hCaptcha token via 2Captcha API (100% unattended).
    """
    if not api_key or not sitekey:
        return None

    method_map = {
        "cloudflare_turnstile": "turnstile",
        "recaptcha_v2": "userrecaptcha",
        "hcaptcha": "hcaptcha",
    }
    method = method_map.get(captcha_type, "turnstile")

    async with httpx.AsyncClient(timeout=30.0) as client:
        in_resp = await client.post(
            "https://2captcha.com/in.php",
            data={
                "key": api_key,
                "method": method,
                "sitekey": sitekey,
                "pageurl": target_url,
                "json": 1,
            },
        )
        in_data = in_resp.json()
        if in_data.get("status") != 1:
            return None
        req_id = in_data.get("request")

        for _ in range(25):
            await asyncio.sleep(4.0)
            res_resp = await client.get(
                "https://2captcha.com/res.php",
                params={"key": api_key, "action": "get", "id": req_id, "json": 1},
            )
            res_data = res_resp.json()
            if res_data.get("status") == 1:
                return res_data.get("request")
            if res_data.get("request") != "CAPCHA_NOT_READY":
                break

    return None
