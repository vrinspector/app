"""S3 object storage (Hard Rule 8: files live in S3 only, never on the server).

The API never streams file bytes. Uploads go browser → S3 through a presigned
PUT URL that is bound to the owning project/inspection prefix; reads go
through short-lived presigned GET URLs. This mirrors the deployed Block 3 /
Block 8D flow (``/photos/presign`` → PUT → ``/photos``) byte for byte at the
API level while keeping all S3 access in one place.

Credentials are resolved by boto3 from the runtime environment (instance
role or ``AWS_*`` variables) — nothing is read from the repository.
"""

import logging
import os
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

logger = logging.getLogger(__name__)

PHOTO_EXTENSIONS = frozenset(
    {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".gif"}
)
DRAWING_EXTENSIONS = frozenset({".pdf", ".png", ".jpg", ".jpeg", ".svg"})


def _boto3_client() -> S3Client:
    return boto3.client(
        "s3",
        region_name=settings.AWS_REGION,
        config=BotoConfig(signature_version="s3v4"),
    )


class Storage:
    """Presigned-URL helpers over one lazily created S3 client."""

    def __init__(
        self, bucket: str, client_factory: Callable[[], S3Client] = _boto3_client
    ) -> None:
        self.bucket = bucket
        self._client_factory = client_factory
        self._client: S3Client | None = None

    @property
    def client(self) -> S3Client:
        if self._client is None:
            self._client = self._client_factory()
        return self._client

    def use_client(self, client: Any) -> None:
        """Replace the client (tests inject a fake; ``None`` resets to boto3)."""
        self._client = client

    # --- keys ---------------------------------------------------------------

    @staticmethod
    def safe_extension(filename: str | None, allowed: frozenset[str]) -> str:
        ext = os.path.splitext(filename or "")[1].lower()
        return ext if ext in allowed else ""

    @staticmethod
    def photo_prefix(inspection_id: int) -> str:
        return f"photos/inspections/{int(inspection_id)}/"

    @staticmethod
    def drawing_prefix(project_id: int) -> str:
        # Deployed Block 8D layout: drawings/projects/{project_id}/{uuid}{ext}
        return f"drawings/projects/{int(project_id)}/"

    @staticmethod
    def report_prefix(inspection_id: int) -> str:
        # Rebuild (increment 10): reports/inspections/{inspection_id}/v{n}-{uuid}.pdf
        return f"reports/inspections/{int(inspection_id)}/"

    # --- URLs ----------------------------------------------------------------

    def presign_put(self, key: str, content_type: str) -> str:
        return self.client.generate_presigned_url(
            "put_object",
            Params={"Bucket": self.bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=settings.S3_PRESIGN_PUT_SECONDS,
        )

    def presign_get(self, key: str) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=settings.S3_PRESIGN_GET_SECONDS,
        )

    def delete_object(self, key: str) -> bool:
        """Best-effort delete; the DB row is removed regardless (returns False on error)."""
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except BotoCoreError, ClientError:
            logger.warning("S3 delete failed for %s", key, exc_info=True)
            return False
        return True

    # --- objects (server-generated documents only) -------------------------
    #
    # User uploads never pass through the API (presigned PUT above). The two
    # methods below exist for documents the *server* produces — the Block 4
    # inspection report PDF — and for reading the photos it embeds.

    def put_object(self, key: str, body: bytes, content_type: str) -> None:
        self.client.put_object(
            Bucket=self.bucket, Key=key, Body=body, ContentType=content_type
        )

    def get_object(self, key: str) -> bytes | None:
        """The object's bytes, or ``None`` if it is missing or unreadable."""
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
        except BotoCoreError, ClientError:
            logger.warning("S3 read failed for %s", key, exc_info=True)
            return None
        data: bytes = response["Body"].read()
        return data


storage = Storage(settings.S3_BUCKET)
