import hashlib
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

USD_TO_VND_MILLION = 0.0254  # $1,000 USD ~= 25.4 Million VND

KNOWN_TECH_SKILLS = [
    "Python", "JavaScript", "TypeScript", "React", "Next.js", "Vue.js", "Angular", "Node.js",
    "FastAPI", "Django", "Flask", "Spring Boot", "Java", "C#", ".NET", "Golang", "Go", "Rust",
    "PHP", "Laravel", "Ruby on Rails", "C++", "Swift", "Kotlin", "Flutter", "React Native",
    "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch", "Kafka", "RabbitMQ",
    "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform", "CI/CD", "Jenkins", "GitLab",
    "Linux", "GraphQL", "REST API", "Microservices", "System Design", "Playwright", "Selenium",
    "PyTorch", "TensorFlow", "LLM", "RAG", "LangChain", "OpenAI", "Machine Learning", "Data Science",
    "Spark", "Airflow", "Snowflake", "Power BI", "Tableau", "Figma", "UI/UX", "Scrum", "Agile",
    "QA/QC", "Automation Test", "Manual Test", "DevOps", "DevSecOps", "Cybersecurity", "ERP", "SAP",
]


def compute_url_hash(url: str) -> str:
    return hashlib.sha256(url.strip().encode("utf-8")).hexdigest()


def compute_dedup_signature(company_name: str, title: str) -> str:
    """
    Create a normalized signature from (company_name + job_title) for cross-platform deduplication.
    """
    norm_co = re.sub(r"[^a-z0-9\u00C0-\u1EF9]+", "", (company_name or "").lower())
    norm_ti = re.sub(r"[^a-z0-9\u00C0-\u1EF9]+", "", (title or "").lower())
    raw = f"{norm_co}::{norm_ti}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def extract_domain(url: str) -> str:
    try:
        host = (urlparse(url).hostname or "unknown").lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return "unknown"


def normalize_salary(raw_salary: Optional[str]) -> Dict[str, Any]:
    """
    Normalize any salary string format into numeric min, max, currency ('VND' or 'USD'),
    and `salary_vnd_normalized` (in Millions VND / month) for accurate high-to-low sorting.
    Examples handled:
    - '$1,500 - $3,000' -> min=1500, max=3000, currency='USD', vnd_norm=76.2
    - 'Up to $2500' -> min=None, max=2500, currency='USD', vnd_norm=63.5
    - '20 - 35 triệu' / '20M - 35M VND' -> min=20, max=35, currency='VND', vnd_norm=35.0
    - '15,000,000 - 25,000,000 đ' -> min=15, max=25, currency='VND', vnd_norm=25.0
    - 'Thỏa thuận' / 'Negotiable' -> is_negotiable=True, vnd_norm=0.0
    """
    if not raw_salary or not str(raw_salary).strip():
        return {
            "salary_raw": "Thỏa thuận",
            "salary_min": None,
            "salary_max": None,
            "salary_currency": "VND",
            "salary_vnd_normalized": 0.0,
            "is_negotiable": True,
        }

    text = " ".join(str(raw_salary).split())
    lower = text.lower()

    neg_markers = ["thỏa thuận", "thoả thuận", "negotiable", "cạnh tranh", "competitive", "attractive"]
    if any(m in lower for m in neg_markers) and not re.search(r"\d", lower):
        return {
            "salary_raw": text,
            "salary_min": None,
            "salary_max": None,
            "salary_currency": "VND",
            "salary_vnd_normalized": 0.0,
            "is_negotiable": True,
        }

    is_usd = "$" in text or "usd" in lower
    currency = "USD" if is_usd else "VND"

    # Extract numbers (handling commas like 1,500 or 20.000.000)
    cleaned_num_text = re.sub(r"(\d)[,\.](\d{3})\b", r"\1\2", text)
    cleaned_num_text = re.sub(r"(\d)[,\.](\d{3})\b", r"\1\2", cleaned_num_text)
    numbers = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", cleaned_num_text)]

    if not numbers:
        return {
            "salary_raw": text,
            "salary_min": None,
            "salary_max": None,
            "salary_currency": currency,
            "salary_vnd_normalized": 0.0,
            "is_negotiable": True,
        }

    # Handle yearly USD salaries (e.g., $80,000 - $120,000 / year)
    if is_usd and max(numbers) >= 25000:
        numbers = [round(n / 12.0, 0) for n in numbers]

    # Handle raw VND in full digits (e.g., 20000000 -> 20.0 million)
    if not is_usd:
        normalized_nums = []
        for n in numbers:
            if n >= 1_000_000:
                normalized_nums.append(round(n / 1_000_000.0, 2))
            elif "k" in lower and n >= 500:
                normalized_nums.append(round(n / 1000.0, 2))
            else:
                normalized_nums.append(n)
        numbers = normalized_nums

    if len(numbers) >= 2:
        sal_min = min(numbers[0], numbers[1])
        sal_max = max(numbers[0], numbers[1])
    else:
        if any(p in lower for p in ["up to", "tới", "đến", "tối đa", "max"]):
            sal_min = None
            sal_max = numbers[0]
        elif any(p in lower for p in ["trên", "từ", "from", "min", "+"]):
            sal_min = numbers[0]
            sal_max = numbers[0]
        else:
            sal_min = numbers[0]
            sal_max = numbers[0]

    ref_val = sal_max if sal_max is not None else (sal_min or 0.0)
    vnd_norm = round(ref_val * (USD_TO_VND_MILLION if is_usd else 1.0), 2)

    return {
        "salary_raw": text,
        "salary_min": sal_min,
        "salary_max": sal_max,
        "salary_currency": currency,
        "salary_vnd_normalized": vnd_norm,
        "is_negotiable": False,
    }


def extract_skills_from_text(text: str, existing_skills: Optional[List[str]] = None) -> List[str]:
    found: List[str] = list(existing_skills or [])
    seen_lower = {s.lower() for s in found}
    if not text:
        return found[:15]

    for skill in KNOWN_TECH_SKILLS:
        if skill.lower() in seen_lower:
            continue
        pattern = r"(?<![a-zA-Z0-9])" + re.escape(skill) + r"(?![a-zA-Z0-9])"
        if re.search(pattern, text, re.IGNORECASE):
            found.append(skill)
            seen_lower.add(skill.lower())
            if len(found) >= 15:
                break
    return found


def infer_work_mode(text: str) -> str:
    lower = (text or "").lower()
    if "remote" in lower or "làm từ xa" in lower or "work from home" in lower or "wfh" in lower:
        if "hybrid" in lower or "linh hoạt" in lower:
            return "Hybrid"
        return "Remote"
    if "hybrid" in lower:
        return "Hybrid"
    return "Onsite"


def infer_seniority(title: str, text: str = "") -> str:
    combined = f"{title} {text[:300]}".lower()
    if any(k in combined for k in ["intern", "thực tập", "trainee"]):
        return "Intern"
    if any(k in combined for k in ["fresher", "mới tốt nghiệp", "entry level"]):
        return "Fresher"
    if any(k in combined for k in ["junior", "jr.", "jr "]):
        return "Junior"
    if any(k in combined for k in ["principal", "staff", "architect", "trưởng nhóm", "team lead", "tech lead", "lead"]):
        return "Lead"
    if any(k in combined for k in ["manager", "director", "head of", "giám đốc", "trưởng phòng", "cto", "vp"]):
        return "Manager"
    if any(k in combined for k in ["senior", "sr.", "sr ", "cao cấp", "chuyên gia"]):
        return "Senior"
    return "Mid-Level"


def extract_hr_and_company_contacts(text: str) -> Dict[str, Optional[str]]:
    """
    Extract HR Email, Phone number, HR Name, and Company Size from JD text if present.
    """
    if not text:
        return {"hr_email": None, "hr_phone": None, "hr_name": None, "company_size": None}

    # Email regex (filtering out common image/asset extensions)
    emails = re.findall(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10}", text)
    valid_emails = [
        e for e in emails
        if not e.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", "sentry.io", "example.com"))
    ]
    hr_email = valid_emails[0] if valid_emails else None

    # Vietnamese mobile / landline phone regex
    phone_match = re.search(
        r"((?:\+84|0)(?:3|5|7|8|9|2)[0-9]{1,2}[\s\.\-]?[0-9]{3,4}[\s\.\-]?[0-9]{3,4})\b",
        text,
    )
    hr_phone = phone_match.group(1).strip() if phone_match else None

    # HR Name pattern (e.g. "Ms. Lan", "Mr Minh", "Chị Hương")
    hr_name_match = re.search(
        r"\b((?:Ms|Mr|Mrs|Chị|Anh)\.?\s+[A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+)?)\b",
        text,
    )
    hr_name = hr_name_match.group(1).strip() if hr_name_match else None

    # Company size pattern (e.g., "50 - 150 nhân viên", "100-500 employees")
    size_match = re.search(
        r"(\d{1,5}\s*[-–]\s*\d{1,5}\s*(?:nhân viên|employees|people|nhân sự)|\d{2,5}\+\s*(?:nhân viên|employees))",
        text,
        re.IGNORECASE,
    )
    company_size = size_match.group(1).strip() if size_match else None

    return {
        "hr_email": hr_email,
        "hr_phone": hr_phone,
        "hr_name": hr_name,
        "company_size": company_size,
    }
