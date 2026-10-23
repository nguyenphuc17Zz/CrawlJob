import logging
import os
import secrets
from pathlib import Path

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
SCREENSHOTS_DIR = DATA_DIR / "screenshots"
EXPORTS_DIR = DATA_DIR / "exports"
CHROME_PROFILE_DIR = DATA_DIR / "chrome_profile"

for directory in (DATA_DIR, SCREENSHOTS_DIR, EXPORTS_DIR, CHROME_PROFILE_DIR):
    directory.mkdir(parents=True, exist_ok=True)


def get_app_secret() -> str:
    """Resolve secret key securely: Environment -> Local secret file -> Ephemeral CSPRNG."""
    env_secret = os.getenv("CRAWLJOB_SECRET_KEY")
    if env_secret and len(env_secret.strip()) >= 32:
        return env_secret.strip()

    secret_file = DATA_DIR / ".app_secret"
    if secret_file.exists():
        try:
            stored = secret_file.read_text(encoding="utf-8").strip()
            if len(stored) >= 32:
                return stored
        except OSError:
            pass

    logger.warning(
        "Generating ephemeral secret key. Instance-isolated! "
        "Set CRAWLJOB_SECRET_KEY in production (TODO(security): integrate KMS for prod)."
    )
    generated = secrets.token_hex(32)
    try:
        secret_file.write_text(generated, encoding="utf-8")
    except OSError:
        pass
    return generated


APP_SECRET_KEY = get_app_secret()
HOST = "127.0.0.1"
PORT = int(os.getenv("CRAWLJOB_PORT", "8000"))
DATABASE_URL = f"sqlite:///{(DATA_DIR / 'crawljob.db').as_posix()}"

ALLOWED_ORIGINS = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
]
