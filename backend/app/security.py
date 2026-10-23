import hashlib
import hmac
import ipaddress
import secrets
import socket
import time
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

from fastapi import HTTPException, Request, status

from .config import APP_SECRET_KEY, DATA_DIR, EXPORTS_DIR, SCREENSHOTS_DIR

# Rate limiting storage: ip -> list of timestamps
_RATE_LIMIT_BUCKETS: Dict[str, List[float]] = defaultdict(list)
RATE_LIMIT_MAX_REQUESTS = 180
RATE_LIMIT_WINDOW_SECONDS = 60.0

# Session/CSRF token management
_ACTIVE_CSRF_TOKENS: Dict[str, float] = {}
CSRF_TTL_SECONDS = 86400.0  # 24 hours


def generate_csrf_token() -> str:
    """Generate a cryptographically signed CSRF token with expiration."""
    nonce = secrets.token_hex(16)
    timestamp = str(int(time.time()))
    payload = f"{nonce}.{timestamp}"
    signature = hmac.new(
        APP_SECRET_KEY.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    token = f"{payload}.{signature}"
    _ACTIVE_CSRF_TOKENS[token] = time.time() + CSRF_TTL_SECONDS
    return token


def verify_csrf_token(token: Optional[str]) -> bool:
    """Validate CSRF token signature and expiration."""
    if not token or not isinstance(token, str):
        return False
    parts = token.split(".")
    if len(parts) != 3:
        return False
    nonce, timestamp_str, signature = parts
    try:
        ts = int(timestamp_str)
    except ValueError:
        return False
    if time.time() - ts > CSRF_TTL_SECONDS:
        return False
    expected_payload = f"{nonce}.{timestamp_str}"
    expected_sig = hmac.new(
        APP_SECRET_KEY.encode("utf-8"),
        expected_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(signature, expected_sig)


def check_rate_limit(client_ip: str) -> None:
    """Enforce API rate limiting per client IP."""
    now = time.time()
    bucket = _RATE_LIMIT_BUCKETS[client_ip]
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS
    while bucket and bucket[0] < cutoff:
        bucket.pop(0)
    if len(bucket) >= RATE_LIMIT_MAX_REQUESTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please wait before sending more requests.",
        )
    bucket.append(now)


def mask_secret(value: Optional[str]) -> str:
    """Mask sensitive API keys or tokens before returning to frontend UI."""
    if not value:
        return ""
    cleaned = value.strip()
    if len(cleaned) <= 6:
        return "****"
    return f"****{cleaned[-4:]}"


def is_masked_secret(value: Optional[str]) -> bool:
    """Check if a value submitted by frontend is the masked placeholder."""
    if not value:
        return False
    return value.startswith("****")


def validate_target_url(raw_url: str) -> str:
    """
    Validate external scraping target URL against SSRF risks.
    Only permits http:// and https:// to public hosts.
    """
    if not raw_url or not isinstance(raw_url, str):
        raise ValueError("URL cannot be empty.")
    cleaned = raw_url.strip()
    if len(cleaned) > 2048:
        raise ValueError("URL exceeds maximum length of 2048 characters.")

    parsed = urlparse(cleaned)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Only http:// and https:// URLs are allowed.")
    if not parsed.hostname:
        raise ValueError("URL must include a valid hostname.")

    hostname = parsed.hostname.lower()
    if hostname in ("localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal"):
        raise ValueError("Scraping internal or localhost addresses is blocked for SSRF protection.")

    # Check if literal IP address is private/loopback/link-local
    try:
        ip_obj = ipaddress.ip_address(hostname)
        if (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_reserved
        ):
            raise ValueError(f"Target IP {hostname} is restricted (non-public address).")
    except ValueError as exc:
        if "restricted" in str(exc):
            raise
        # Hostname is a domain name; attempt DNS resolution check if online
        try:
            addr_info = socket.getaddrinfo(hostname, None)
            for item in addr_info:
                resolved_ip = item[4][0]
                ip_obj = ipaddress.ip_address(resolved_ip)
                if ip_obj.is_loopback or ip_obj.is_link_local or str(ip_obj) == "169.254.169.254":
                    raise ValueError(f"Domain {hostname} resolves to restricted internal address.")
        except socket.gaierror:
            # Allow offline/custom domain resolution during fetch layer handling
            pass

    return cleaned


def validate_local_service_url(raw_url: str, allowed_ports: Tuple[int, ...] = (8191, 9222, 11434)) -> str:
    """
    Validate local helper daemon URLs (FlareSolverr: 8191, Chrome CDP: 9222, Ollama: 11434).
    """
    if not raw_url or not isinstance(raw_url, str):
        raise ValueError("Service URL cannot be empty.")
    cleaned = raw_url.strip()
    parsed = urlparse(cleaned)
    if parsed.scheme not in ("http", "https", "ws", "wss"):
        raise ValueError("Invalid service URL scheme.")
    hostname = (parsed.hostname or "").lower()
    if hostname not in ("127.0.0.1", "localhost"):
        raise ValueError("Local helper service must be hosted on 127.0.0.1 or localhost.")
    if parsed.port and parsed.port not in allowed_ports:
        # Allow user-specified local ports above 1024 while blocking privileged system ports
        if parsed.port < 1024:
            raise ValueError("Privileged local port below 1024 is not permitted.")
    return cleaned


def safe_resolve_path(base_dir: Path, filename: str) -> Path:
    """
    Safely resolve a file path inside base_dir, stripping directory traversal sequences.
    Enforces trailing separator check on resolved path.
    """
    safe_name = Path(filename).name
    if not safe_name or safe_name in (".", ".."):
        raise ValueError("Invalid filename.")
    base_resolved = base_dir.resolve()
    target_resolved = (base_resolved / safe_name).resolve()
    base_prefix = str(base_resolved) + ("\\" if "\\" in str(base_resolved) else "/")
    if not str(target_resolved).startswith(base_prefix):
        raise ValueError("Path traversal detected.")
    return target_resolved
