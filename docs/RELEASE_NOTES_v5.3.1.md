# CastoriceUI v5.3.1

- Keep the decoded login background for the lifetime of the page, across login, logout and window resizing. Logout reuses it immediately without another bootstrap or image request.
- Evaluate cache expiry only when the page is opened or refreshed. A fresh image's client TTL starts after decoding completes; reusing it never extends that deadline.
- Preload the document image even when an existing session opens directly into the dashboard. Preserve upstream-failure fallback and finite resource limits.
- Add real-browser login/logout cycles beyond the two-second TTL, asserting the first login-page paint already has the same image and no extra image or bootstrap requests.

Deployment restarts only the panel backend. Existing settings, incident history and proxy services are preserved.
