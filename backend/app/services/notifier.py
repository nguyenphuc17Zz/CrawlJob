import json
import logging
from typing import Dict, List

import httpx

from ..models import JobPost
from ..security import validate_target_url

logger = logging.getLogger(__name__)


async def dispatch_new_jobs_notifications(
    new_jobs: List[JobPost],
    settings: Dict[str, str],
) -> str:
    """
    Send notification summary of newly crawled jobs via:
    1. Telegram Bot API (`telegram_bot_token` + `telegram_chat_id`)
    2. Discord Webhook (`discord_webhook_url`)
    3. Google Sheets / Custom Webhook (`sheets_webhook_url`)
    """
    if not new_jobs:
        return "No new jobs to notify."

    results: List[str] = []
    top_items = new_jobs[:8]

    # Build message body
    lines = [f"🚀 *CrawlJob Pipeline*: Phát hiện *{len(new_jobs)}* việc làm mới!\n"]
    for idx, j in enumerate(top_items, start=1):
        badge = "⭐ " if j.is_highlighted else ""
        lines.append(
            f"{idx}. {badge}*{j.title}*\n"
            f"   🏢 {j.company_name} | 💰 {j.salary_raw} | 📍 {j.location_city} ({j.work_mode})\n"
            f"   🔗 {j.url}"
        )
    if len(new_jobs) > len(top_items):
        lines.append(f"\n_...và {len(new_jobs) - len(top_items)} công việc khác trên Dashboard._")
    message_text = "\n".join(lines)

    async with httpx.AsyncClient(timeout=15.0) as client:
        # 1. Telegram Bot
        tg_token = (settings.get("telegram_bot_token") or "").strip()
        tg_chat = (settings.get("telegram_chat_id") or "").strip()
        if tg_token and tg_chat:
            try:
                tg_url = f"https://api.telegram.org/bot{tg_token}/sendMessage"
                resp = await client.post(
                    tg_url,
                    json={
                        "chat_id": tg_chat,
                        "text": message_text,
                        "disable_web_page_preview": True,
                    },
                )
                if resp.status_code == 200:
                    results.append("Telegram OK")
                else:
                    results.append(f"Telegram HTTP {resp.status_code}")
            except Exception as exc:
                results.append(f"Telegram Err ({exc})")

        # 2. Discord Webhook
        discord_url = (settings.get("discord_webhook_url") or "").strip()
        if discord_url:
            try:
                safe_discord = validate_target_url(discord_url)
                resp = await client.post(safe_discord, json={"content": message_text[:1950]})
                if resp.status_code in (200, 204):
                    results.append("Discord OK")
                else:
                    results.append(f"Discord HTTP {resp.status_code}")
            except Exception as exc:
                results.append(f"Discord Err ({exc})")

        # 3. Google Sheets / Custom Webhook
        sheets_url = (settings.get("sheets_webhook_url") or "").strip()
        if sheets_url:
            try:
                safe_sheets = validate_target_url(sheets_url)
                payload = {
                    "count": len(new_jobs),
                    "jobs": [
                        {
                            "title": j.title,
                            "company": j.company_name,
                            "salary": j.salary_raw,
                            "salary_vnd_million": j.salary_vnd_normalized,
                            "location": j.location_city,
                            "work_mode": j.work_mode,
                            "seniority": j.seniority,
                            "skills": json.loads(j.skills_json or "[]"),
                            "hr_email": j.hr_email,
                            "url": j.url,
                        }
                        for j in new_jobs[:50]
                    ],
                }
                resp = await client.post(safe_sheets, json=payload)
                if resp.status_code < 300:
                    results.append("Sheets Webhook OK")
                else:
                    results.append(f"Sheets HTTP {resp.status_code}")
            except Exception as exc:
                results.append(f"Sheets Err ({exc})")

    return ", ".join(results) if results else "No notification channels configured."
