# CastoriceUI v5.4.0

- Preserve separate Image API and server-image drafts while switching background sources before saving. Ignore obsolete settings responses when closing the dialog.
- Apply saved sign-in appearance to the current document immediately, including Liquid Glass on the next sign-out. Keep the decoded image when only glass or fit changes.
- Let the three-stop glass slider track continuous mouse and touch movement, then ease into the nearest preset on release. Arrow keys, Home and End select complete presets; the initial preset remains Default.
- Remove image displacement and curved edges from glass while retaining its blur levels, tint, highlights, rim lighting and adaptive contrast. Align its image using layout coordinates during the sign-in entrance animation.
- Refine selection feedback and calendar-view motion. Give select menus, date pickers and anchored popovers complete animated exits, with closing surfaces immediately removed from interaction. Respect reduced motion.
- Start background preparation alongside session verification, retaining the boot screen until authentication is known. Preserve cache expiry, stable images through login/logout and failure fallback.
- Recover from unavailable cached blob URLs and tolerate image-URL cleanup after a browser document stops during navigation.
- Audit initial settings and keep the existing defaults: Material background, glass off with the Default preset, system language and theme, and automatic traffic reset off. Existing saved choices are preserved.

Large images and slow or unavailable third-party image APIs can still delay a new background. This release keeps their configured cache policy and preserves the previous image on failure.

Deployment restarts only the panel backend. Existing settings, incident history and proxy services are preserved.
