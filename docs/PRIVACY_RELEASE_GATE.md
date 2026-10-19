# Privacy gate for commits and releases

Privacy failures can survive deletion from the working tree: staged bytes, old blobs, author/committer/tagger identities, co-author trailers, PR references and detached merge commits can remain public. This gate applies to every content submission and release.

## Local setup

Run in this repository on every clone or worktree:

```sh
npm run privacy:install
npm run privacy:identity
```

Set `user.name` to an intentionally public alias and `user.email` to the account's GitHub noreply address. The installer changes only this repository's `core.hooksPath`, preserves an unrelated existing hooksPath by refusing replacement, and enables the hook executable bits. New clones do not inherit local Git configuration. Integrate an existing hook system explicitly before proceeding.

The owner also configures `castoriceui.privateValuesFile` in **local Git configuration** to an absolute, protected JSON file outside this public repository. Its format is a nonempty array of private literal strings of at least four characters. Refresh it when deployment/contact secrets change. Never commit this file, copy its values into test fixtures, upload it as an artifact or configure it as a public CI input. A configured missing/invalid/in-repository list blocks checks. With no configured list, only generic checks run; that is insufficient for the owner's publication acceptance.

## Required sequence

| Stage | Required evidence | Stop condition |
| --- | --- | --- |
| Before commit | `privacy:identity`, staged diff review, pre-commit checks the complete Git index; commit-msg checks message/trailers | Private identity, sensitive staged bytes/names, unmerged index, missing policy or inspection error |
| Before push | pre-push checks the exact pushed commit/annotated-tag SHA and all reachable objects, even if files were later deleted | Private metadata/content anywhere in pushed ancestry, unverifiable object, shallow history |
| Before web merge | Keep my email addresses private and Block command line pushes that expose my email enabled; review squash message and co-authors | Settings or proposed identity cannot be verified |
| Immediately after merge | Inspect the actual remote merge SHA's author/committer and message through the Git commit API or fresh fetch | Non-noreply identity or private text; stop before tag/release and record affected PR/SHA |
| Before release | `npm run check`; packaging scans source/full history, completed staging directory, then actual gzip/tar contents and headers | Any check fails or screenshots/binary review is incomplete |
| After release | Anonymous download, published SHA-256, private-value scan of actual downloaded archive; remote heads/tags/PR refs and relevant historical merge objects | Mismatched asset, new exposure or incomplete verification |

Useful commands:

```sh
npm run scan:sensitive
npm run test:privacy
npm run release:package
npm run privacy:archive -- release/CastoriceUI-vVERSION.tar.gz
```

Pre-commit checks effective `GIT_AUTHOR_IDENT` and `GIT_COMMITTER_IDENT`, including environment and command-line overrides. Pre-push reads Git's actual ref-update stdin rather than assuming `HEAD` is the only object being pushed. Commit and annotated-tag identities require GitHub noreply. Documentation addresses under example.com/net/org, .test and .invalid are allowed in content, but not as Git identities. The known public Copilot service co-author and GitHub Support contact are narrow content exceptions; arbitrary github.com addresses and personal-email allowlists are not accepted.

`npm run scan:sensitive` checks working files and complete **local** history, including messages and tagger metadata. CI uses full checkout depth and runs this scan before installing dependencies. Packaging requires Node, Git, Python and tar; Python reads archive members without extracting their paths. Archives containing links, special entries, traversal paths or more than 128 MiB of member data are rejected. Scan errors return a nonzero exit code and do not print matching private values.

Unchanged browser/VM domains can reuse CI evidence as defined in `AGENTS.md` and `scripts/ci.py`; this never replaces the per-commit source/history, Nginx, CodeQL or publication-object checks. Local release steps can reuse fresh, identically bound evidence and resume an interrupted historical-URL batch. Preserve the original check time, package/SHA binding and failed/unverified results; do not count a skipped job or a submitted cleanup ticket as successful acceptance.

## Human and platform checks remain necessary

Source text in UTF-8 and BOM-marked UTF-16 receives a generic email scan; binary data still receives common-key and known-private-value matching. Random bytes in image signatures must not be mistaken for email addresses. Inspect images, their metadata, production screenshots and nested compressed content separately. OCR, unknown secrets and arbitrary binary encodings are not guaranteed by this tool.

Local hooks can technically be bypassed, and CI runs after data has reached GitHub. Project policy forbids bypasses and requires the identity/privacy checks **before** transmission. Branch protections and platform account settings are separate controls; this change does not claim they were installed on every contributor's device or remotely enforced.

Fetching normal heads/tags does not enumerate every GitHub PR cache or detached historical object. Check discoverable PR refs in an isolated private mirror and relevant merge SHAs separately. Keep affected-object inventories outside public source and do not push audit refs. If an existing cleanup is still pending, disclose that status and ensure no new private data or old affected object is submitted.

Changing current metadata does not remove old cached views. A cleanup ticket is complete only after the platform's response and anonymous checks of the relevant PR/commit/patch/API locations. Follow [GitHub's data-removal procedure](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) and [commit email guidance](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address).
