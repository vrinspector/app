/*
 * Demo build only: a stand-in for S3.
 *
 * The app uploads photos and drawings with an XMLHttpRequest PUT to a
 * presigned URL (hooks/usePhotoUpload.ts `putToS3`). In the demo, presigned
 * URLs use the `demo-s3://` scheme; this patch answers those PUTs locally,
 * reporting progress like a real upload, and keeps the file in memory as a
 * blob URL so the photo or drawing can be shown straight back. Everything
 * else goes to the browser's real XMLHttpRequest.
 */

const DEMO_SCHEME = "demo-s3://"

/** s3_key -> blob URL of the uploaded file (in-memory, lost on reload). */
const stored = new Map<string, string>()

export function demoUploadUrl(s3Key: string): string {
  return `${DEMO_SCHEME}${s3Key}`
}

export function storedFileUrl(s3Key: string): string | undefined {
  return stored.get(s3Key)
}

export function forgetStoredFile(s3Key: string): void {
  const url = stored.get(s3Key)
  if (url) URL.revokeObjectURL(url)
  stored.delete(s3Key)
}

export function installFakeS3(): void {
  const NativeXHR = window.XMLHttpRequest

  class DemoXHR extends NativeXHR {
    private demoKey: string | null = null

    open(method: string, url: string | URL, ...rest: unknown[]): void {
      const href = String(url)
      if (href.startsWith(DEMO_SCHEME)) {
        this.demoKey = href.slice(DEMO_SCHEME.length)
        return
      }
      this.demoKey = null
      ;(NativeXHR.prototype.open as any).call(this, method, url, ...rest)
    }

    setRequestHeader(name: string, value: string): void {
      if (this.demoKey !== null) return
      super.setRequestHeader(name, value)
    }

    send(body?: Document | XMLHttpRequestBodyInit | null): void {
      if (this.demoKey === null) {
        super.send(body)
        return
      }
      const key = this.demoKey
      const total = body instanceof Blob ? body.size : 1
      const steps = 6
      let step = 0
      const tick = () => {
        step += 1
        const loaded = Math.min(total, Math.round((total * step) / steps))
        this.upload.dispatchEvent(
          new ProgressEvent("progress", {
            lengthComputable: true,
            loaded,
            total,
          }),
        )
        if (step < steps) {
          window.setTimeout(tick, 120)
          return
        }
        if (body instanceof Blob) {
          forgetStoredFile(key)
          stored.set(key, URL.createObjectURL(body))
        }
        Object.defineProperty(this, "status", { value: 200 })
        Object.defineProperty(this, "readyState", { value: 4 })
        this.dispatchEvent(new ProgressEvent("load"))
        this.dispatchEvent(new ProgressEvent("loadend"))
      }
      window.setTimeout(tick, 120)
    }
  }

  window.XMLHttpRequest = DemoXHR
}
