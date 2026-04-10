from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

try:
    from docx import Document as DocxDocument
except ModuleNotFoundError:
    DocxDocument = None

try:
    from pypdf import PdfReader
except ModuleNotFoundError:
    PdfReader = None

from app.ai_settings import (
    DEFAULT_CHAT_MODEL,
    DEFAULT_CHAT_MAX_OUTPUT_TOKENS,
    UnitedLaneChatProviderError,
    build_unitedlane_chat_headers,
    coerce_openrouter_message_text,
    get_openrouter_client,
    normalize_chat_image_data_url,
)

DATA_URL_PATTERN = re.compile(r"^data:(?P<mime>[^;]+);base64,(?P<data>[A-Za-z0-9+/=\s]+)$")
SUPPORTED_TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".log"}
SUPPORTED_IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
BUCKETS = {"approved", "review", "bad"}
DOCUMENT_TYPES = {
    "inspection",
    "license",
    "insurance",
    "incident",
    "training",
    "policy",
    "maintenance",
    "medical",
    "other",
}
DOCUMENT_REVIEW_SYSTEM_PROMPT = """You are Safety Team for United Lane.

Classify uploaded safety documents into exactly one bucket:
- approved: document appears usable, complete enough, and not obviously risky.
- review: document may be usable but needs human review because it is incomplete, unclear, partially missing, inconsistent, or uncertain.
- bad: document appears unsafe, clearly expired, invalid, missing critical information, or should not be accepted.

You must return only valid JSON with this exact shape:
{
  "bucket": "approved" | "review" | "bad",
  "document_type": "inspection" | "license" | "insurance" | "incident" | "training" | "policy" | "maintenance" | "medical" | "other",
  "summary": "short summary",
  "issues": ["issue 1", "issue 2"],
  "recommended_action": "short next action"
}

Rules:
- Be practical and conservative.
- If you are unsure, use review.
- Use bad only for clear major risk or major failure.
- Keep summary short.
- Keep issues list short, maximum 4 items.
- Do not add markdown or commentary outside JSON.
"""
MAX_DOCUMENT_DATA_URL_LENGTH = 14_000_000
MAX_DOCUMENT_TEXT_LENGTH = 16_000
MAX_DOCUMENT_EXCERPT_LENGTH = 2_000


@dataclass
class SafetyDocumentAnalysis:
    bucket: str
    document_type: str
    summary: str
    issues: list[str]
    recommended_action: str
    excerpt: str


class SafetyDocumentError(ValueError):
    pass


def parse_document_data_url(data_url: str) -> tuple[str, bytes]:
    normalized = (data_url or "").strip()
    if not normalized:
        raise SafetyDocumentError("Document file is missing.")
    if len(normalized) > MAX_DOCUMENT_DATA_URL_LENGTH:
        raise SafetyDocumentError("Document is too large.")

    match = DATA_URL_PATTERN.match(normalized)
    if not match:
        raise SafetyDocumentError("Document must be sent as a base64 data URL.")

    mime_type = match.group("mime").lower()
    try:
        payload = base64.b64decode(match.group("data"), validate=True)
    except Exception as exc:
        raise SafetyDocumentError("Document data could not be decoded.") from exc
    return mime_type, payload


def normalize_document_text(text: str) -> str:
    normalized = "\n".join(line.strip() for line in (text or "").splitlines())
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def decode_text_payload(file_bytes: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return file_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise SafetyDocumentError("Text document could not be decoded.")


def extract_pdf_text(file_bytes: bytes) -> str:
    if PdfReader is None:
        raise SafetyDocumentError("PDF support is not installed on the backend.")
    reader = PdfReader(BytesIO(file_bytes))
    return "\n\n".join((page.extract_text() or "") for page in reader.pages)


def extract_docx_text(file_bytes: bytes) -> str:
    if DocxDocument is None:
        raise SafetyDocumentError("DOCX support is not installed on the backend.")
    document = DocxDocument(BytesIO(file_bytes))
    parts = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
    return "\n".join(parts)


def extract_document_text(file_name: str, mime_type: str, file_bytes: bytes) -> tuple[str, str]:
    extension = Path(file_name or "document").suffix.lower()

    if mime_type in SUPPORTED_IMAGE_MIME_TYPES:
        return "", normalize_chat_image_data_url(f"data:{mime_type};base64,{base64.b64encode(file_bytes).decode('ascii')}")

    if mime_type == "application/pdf" or extension == ".pdf":
        return normalize_document_text(extract_pdf_text(file_bytes)), ""

    if mime_type in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    } or extension == ".docx":
        return normalize_document_text(extract_docx_text(file_bytes)), ""

    if mime_type.startswith("text/") or extension in SUPPORTED_TEXT_EXTENSIONS:
        return normalize_document_text(decode_text_payload(file_bytes)), ""

    raise SafetyDocumentError("Supported files: PDF, DOCX, TXT, MD, CSV, JSON, PNG, JPG, WEBP, GIF.")


def truncate_document_text(text: str) -> str:
    if len(text) <= MAX_DOCUMENT_TEXT_LENGTH:
        return text
    return text[:MAX_DOCUMENT_TEXT_LENGTH].rstrip() + "\n\n[Document truncated for AI review]"


def guess_document_type(file_name: str, text: str) -> str:
    haystack = f"{file_name}\n{text}".lower()
    if any(keyword in haystack for keyword in ("inspection", "dvir", "pre-trip", "post-trip")):
        return "inspection"
    if any(keyword in haystack for keyword in ("license", "cdl", "permit")):
        return "license"
    if any(keyword in haystack for keyword in ("insurance", "policy number", "insured")):
        return "insurance"
    if any(keyword in haystack for keyword in ("incident", "accident", "claim")):
        return "incident"
    if any(keyword in haystack for keyword in ("training", "certificate", "course")):
        return "training"
    if any(keyword in haystack for keyword in ("policy", "procedure", "sop")):
        return "policy"
    if any(keyword in haystack for keyword in ("maintenance", "repair", "service")):
        return "maintenance"
    if any(keyword in haystack for keyword in ("medical", "exam", "dot physical")):
        return "medical"
    return "other"


def extract_json_object(content: str) -> dict[str, object]:
    text = (content or "").strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise SafetyDocumentError("AI response did not return JSON.")
    parsed = json.loads(text[start : end + 1])
    if not isinstance(parsed, dict):
        raise SafetyDocumentError("AI response JSON is invalid.")
    return parsed


def normalize_analysis_result(result: dict[str, object], file_name: str, source_text: str) -> SafetyDocumentAnalysis:
    bucket = str(result.get("bucket") or "review").strip().lower()
    if bucket not in BUCKETS:
        bucket = "review"

    document_type = str(result.get("document_type") or guess_document_type(file_name, source_text)).strip().lower()
    if document_type not in DOCUMENT_TYPES:
        document_type = guess_document_type(file_name, source_text)

    summary = str(result.get("summary") or "Document reviewed.").strip() or "Document reviewed."
    recommended_action = str(result.get("recommended_action") or "Manual review recommended.").strip() or "Manual review recommended."

    raw_issues = result.get("issues") or []
    if isinstance(raw_issues, list):
        issues = [str(item).strip() for item in raw_issues if str(item).strip()][:4]
    else:
        issues = [str(raw_issues).strip()] if str(raw_issues).strip() else []

    excerpt_source = source_text.strip()
    excerpt = excerpt_source[:MAX_DOCUMENT_EXCERPT_LENGTH].strip()

    return SafetyDocumentAnalysis(
        bucket=bucket,
        document_type=document_type,
        summary=summary,
        issues=issues,
        recommended_action=recommended_action,
        excerpt=excerpt,
    )


def fallback_analysis(file_name: str, source_text: str) -> SafetyDocumentAnalysis:
    return SafetyDocumentAnalysis(
        bucket="review",
        document_type=guess_document_type(file_name, source_text),
        summary="AI review was unavailable. Sent to Needs Review.",
        issues=["Automatic classification could not be completed."],
        recommended_action="Check the document manually.",
        excerpt=source_text[:MAX_DOCUMENT_EXCERPT_LENGTH].strip(),
    )


def generate_safety_document_analysis(file_name: str, mime_type: str, text: str = "", image_data_url: str = "") -> SafetyDocumentAnalysis:
    user_text = "\n\n".join(
        part
        for part in [
            f"Filename: {file_name}",
            f"Content type: {mime_type}",
            f"Extracted content:\n{truncate_document_text(text)}" if text else "",
            "Review this document conservatively for trucking safety/compliance operations.",
        ]
        if part
    )

    if image_data_url:
        user_content: str | list[dict[str, object]] = [
            {"type": "text", "text": user_text or f"Filename: {file_name}\nContent type: {mime_type}"},
            {"type": "image_url", "image_url": {"url": image_data_url}},
        ]
    else:
        user_content = user_text

    try:
        client = get_openrouter_client()
        response = client.chat.completions.create(
            model=DEFAULT_CHAT_MODEL,
            max_tokens=max(350, DEFAULT_CHAT_MAX_OUTPUT_TOKENS + 100),
            extra_headers=build_unitedlane_chat_headers(),
            messages=[
                {"role": "system", "content": DOCUMENT_REVIEW_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
        )
        content = coerce_openrouter_message_text(response.choices[0].message.content)
        parsed = extract_json_object(content)
        return normalize_analysis_result(parsed, file_name=file_name, source_text=text)
    except UnitedLaneChatProviderError:
        return fallback_analysis(file_name=file_name, source_text=text)
    except Exception:
        return fallback_analysis(file_name=file_name, source_text=text)


def analyze_uploaded_safety_document(file_name: str, content_type: str, data_url: str) -> SafetyDocumentAnalysis:
    mime_type, file_bytes = parse_document_data_url(data_url)
    resolved_mime_type = (content_type or mime_type).strip().lower() or mime_type
    text, image_data_url = extract_document_text(file_name=file_name, mime_type=resolved_mime_type, file_bytes=file_bytes)

    if not text and not image_data_url:
        return SafetyDocumentAnalysis(
            bucket="review",
            document_type=guess_document_type(file_name, ""),
            summary="Document could not be read clearly. Sent to Needs Review.",
            issues=["Automatic text extraction could not read this file."],
            recommended_action="Open the document manually and verify it.",
            excerpt="",
        )

    return generate_safety_document_analysis(
        file_name=file_name,
        mime_type=resolved_mime_type,
        text=text,
        image_data_url=image_data_url,
    )

