import asyncio
import json
import subprocess
import sys
from pathlib import Path

# Ensure no console window ever flashes when Playwright spawns node.exe / browser drivers on Windows
if sys.platform == "win32":
    _orig_popen = subprocess.Popen

    class _NoWindowPopen(_orig_popen):  # type: ignore[misc]
        def __init__(self, *args, **kwargs):
            kwargs["creationflags"] = (
                kwargs.get("creationflags", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
            )
            super().__init__(*args, **kwargs)

    subprocess.Popen = _NoWindowPopen  # type: ignore[assignment]

# Add backend and local site-packages to sys.path
BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))
for extra_sp in [
    r"E:\docling\.venv\Lib\site-packages",
    r"E:\google_workspace_mcp\.venv\Lib\site-packages",
    r"E:\notebooklm-py\.venv\Lib\site-packages",
]:
    if Path(extra_sp).exists():
        sys.path.append(extra_sp)

from app.engine.fetcher import fetch_tier2_playwright_stealth


async def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing payload argument"}))
        return

    raw_arg = sys.argv[1]
    params = json.loads(raw_arg)
    res = await fetch_tier2_playwright_stealth(
        url=params["url"],
        scroll_times=int(params.get("scroll_times", 2)),
        cookie_header=params.get("cookie_header", ""),
        proxy_url=params.get("proxy_url") or None,
        use_cdp=bool(params.get("use_cdp", False)),
        cdp_url=params.get("cdp_url", "http://127.0.0.1:9222"),
        use_persistent_profile=bool(params.get("use_persistent_profile", False)),
        capsolver_key=params.get("capsolver_key", ""),
        twocaptcha_key=params.get("twocaptcha_key", ""),
        take_screenshot=bool(params.get("take_screenshot", True)),
    )
    print(json.dumps(res, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
