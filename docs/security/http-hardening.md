# HTTP Hardening & Transport Security

> **Specification Reference:** Section 16.2

## 1. Helmet Security Headers Configuration

The API applies Helmet configured specifically for a headless JSON REST API:

| Header | Configured Value | Security Purpose |
| :--- | :--- | :--- |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` | Forbids execution of scripts, framing, or resource loading if opened in a browser. |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing by clients. |
| `Referrer-Policy` | `no-referrer` | Never transmits URLs or query strings in referrer headers. |
| `X-Frame-Options` | `DENY` | Prevents clickjacking and framing. |
| `Cross-Origin-Resource-Policy` | `same-site` | Restricts cross-origin resource sharing. |
| `X-Powered-By` | (Disabled/Removed) | Suppresses technology fingerprinting. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Enforced in production to mandate TLS encryption. |

---

## 2. Request Size & Media Type Controls

* **Maximum Payload Size:** Strict 100 KB ceiling enforced by `express.json({ limit: '100kb' })`. Requests exceeding this limit receive `413 PAYLOAD_TOO_LARGE`.
* **Content-Type Validation:** Mutating requests (`POST`, `PUT`, `PATCH`) with a payload must specify `Content-Type: application/json`. Non-JSON requests receive `415 UNSUPPORTED_MEDIA_TYPE`.
* **Reverse Proxy Trust:** `trust proxy` is configured to match the exact hop count (`TRUST_PROXY_HOPS`) to prevent client IP spoofing via manipulated `X-Forwarded-For` headers.
