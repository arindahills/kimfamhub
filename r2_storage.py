"""
R2 storage helpers for KimFam Hub.

Folder conventions inside kimfam-media-prod:
  minutes/     — meeting minutes .docx files
  receipts/    — payment receipt images
  expenditures/ — expenditure evidence images
  avatars/     — member profile photos
  governance/  — constitution, rules, policies (.pdf/.docx)
  projects/    — project proposal and report files
  financial/   — financial statements and reports
"""

import os
import mimetypes
import boto3
from botocore.client import Config

_R2_ENDPOINT  = os.getenv("R2_ENDPOINT", "")
_R2_BUCKET    = os.getenv("R2_BUCKET_NAME", "kimfam-media")
_R2_KEY_ID    = os.getenv("R2_ACCESS_KEY_ID", "")
_R2_SECRET    = os.getenv("R2_SECRET_ACCESS_KEY", "")

_PUBLIC_FOLDERS = {"governance", "minutes", "projects"}

def _client():
    return boto3.client(
        "s3",
        endpoint_url=_R2_ENDPOINT,
        aws_access_key_id=_R2_KEY_ID,
        aws_secret_access_key=_R2_SECRET,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def upload(local_path: str, key: str, public: bool = False) -> str:
    """
    Upload a file to R2. Returns a presigned URL (R2 does not support per-object ACLs;
    bucket-level public access must be enabled in the Cloudflare dashboard separately).
    key example: "minutes/KIMFAM_Meeting_Minutes_June_2026.docx"
    """
    ct, _ = mimetypes.guess_type(local_path)
    ct = ct or "application/octet-stream"

    s3 = _client()
    s3.upload_file(local_path, _R2_BUCKET, key, ExtraArgs={"ContentType": ct})

    return presigned_url(key)


def presigned_url(key: str, expires: int = 3600) -> str:
    """Return a time-limited presigned GET URL for a private object."""
    s3 = _client()
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": _R2_BUCKET, "Key": key},
        ExpiresIn=expires,
    )


def public_url(key: str) -> str:
    """Return the direct public URL for an object uploaded with public-read."""
    return f"{_R2_ENDPOINT}/{_R2_BUCKET}/{key}"


def delete(key: str) -> None:
    _client().delete_object(Bucket=_R2_BUCKET, Key=key)


def list_folder(prefix: str) -> list[dict]:
    """Return [{key, size, last_modified}] for all objects under a prefix."""
    s3 = _client()
    resp = s3.list_objects_v2(Bucket=_R2_BUCKET, Prefix=prefix)
    return [
        {"key": o["Key"], "size": o["Size"], "last_modified": o["LastModified"]}
        for o in resp.get("Contents", [])
    ]


def folder_for(path: str) -> str:
    """
    Infer the R2 folder from a local file path.
    Falls back to 'uploads/' if no match.
    """
    p = path.lower()
    for folder in ("minutes", "receipts", "expenditures", "avatars", "governance", "projects", "financial"):
        if folder in p:
            return folder
    return "uploads"


def is_configured() -> bool:
    return bool(_R2_ENDPOINT and _R2_KEY_ID and _R2_SECRET)
