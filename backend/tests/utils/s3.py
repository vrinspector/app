"""In-memory stand-in for the boto3 S3 client.

The API signs URLs and deletes objects for user uploads, and — since
increment 10 — writes the server-generated report PDF and reads the photos
it embeds. Tests record those calls instead of reaching AWS.
"""

import io
from dataclasses import dataclass, field
from typing import Any


@dataclass
class FakeS3:
    presigned: list[tuple[str, dict[str, Any], int]] = field(default_factory=list)
    deleted: list[tuple[str, str]] = field(default_factory=list)
    fail_delete: bool = False
    # key → (bytes, content type): objects "uploaded" by tests or written by the API.
    objects: dict[str, tuple[bytes, str]] = field(default_factory=dict)
    fail_get: bool = False

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
        self.objects.pop(Key, None)
        return {}

    def put_object(
        self, Bucket: str, Key: str, Body: bytes, ContentType: str
    ) -> dict[str, Any]:
        assert Bucket
        self.objects[Key] = (bytes(Body), ContentType)
        return {}

    def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
        from botocore.exceptions import ClientError

        assert Bucket
        if self.fail_get or Key not in self.objects:
            raise ClientError(
                {"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "GetObject"
            )
        data, content_type = self.objects[Key]
        return {"Body": io.BytesIO(data), "ContentType": content_type}
