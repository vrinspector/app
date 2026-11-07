"""In-memory stand-in for the boto3 S3 client (presigned URLs + deletes only).

The API never touches S3 directly except to sign URLs and delete objects, so
tests record those calls instead of reaching AWS.
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class FakeS3:
    presigned: list[tuple[str, dict[str, Any], int]] = field(default_factory=list)
    deleted: list[tuple[str, str]] = field(default_factory=list)
    fail_delete: bool = False

    def generate_presigned_url(
        self, ClientMethod: str, Params: dict[str, Any], ExpiresIn: int
    ) -> str:
        self.presigned.append((ClientMethod, dict(Params), ExpiresIn))
        verb = "put" if ClientMethod == "put_object" else "get"
        return (
            f"https://{Params['Bucket']}.s3.test/{Params['Key']}"
            f"?X-Amz-Signature=fake-{verb}&X-Amz-Expires={ExpiresIn}"
        )

    def delete_object(self, Bucket: str, Key: str) -> dict[str, Any]:
        if self.fail_delete:
            from botocore.exceptions import ClientError

            raise ClientError(
                {"Error": {"Code": "AccessDenied", "Message": "nope"}}, "DeleteObject"
            )
        self.deleted.append((Bucket, Key))
        return {}
