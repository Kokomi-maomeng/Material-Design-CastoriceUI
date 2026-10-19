# Repository privacy requirements

Read [docs/PRIVACY_RELEASE_GATE.md](docs/PRIVACY_RELEASE_GATE.md) before any commit, push, merge, tag, or release.

- Keep deployment credentials, private email/contact details, real production endpoints, subscriptions, raw audits, backups, and private-value lists outside this public repository and all public messages/assets.
- Install repository-local hooks with `npm run privacy:install` on each clone/worktree. Use a public alias and GitHub noreply for author, committer, and tagger. Preserve the account's email privacy and push-blocking protections.
- Check the actual staged objects and the actual SHA/tag objects being pushed, including ancestors, messages and co-author trailers. Never bypass hooks with `--no-verify`, disable the gate, or allowlist a personal identity to make a failed check green.
- Run `npm run check` before publication. Packaging must pass source/history, staging-directory and final-archive checks. A configured missing/private-value file is a blocking error; the list must be outside this repository and must never reach CI or public output.
- Inspect the actual remote merge identity before creating tags/releases. After publication, verify anonymous downloads, checksums, remote refs and relevant detached PR commits. Local/CI success is not proof that GitHub caches were removed.
- Review screenshots, image metadata and binary/nested content manually; automatic scanners cover supported text, common key patterns, known private values, Git identities and tar members, not all possible personal data.
- Keep known historical privacy cleanup separate from new-content checks. Do not reintroduce affected objects or claim old exposure is fixed until platform cleanup and anonymous checks confirm it. Do not alter production or proxy services for this maintenance task.

CI runs the full local/privacy checks, Nginx upgrade tests and CodeQL for every change. Heavy browser/VM results may be inherited only through `scripts/ci.py`: same-repository PR, unchanged checker/content/environment inputs, all domain parts passed within 24 hours; main also requires the actual checkout tree to match. Missing, failed, cancelled, expired or uncertain evidence restores execution. The acceptance job must pass; a skipped matrix alone is insufficient. Keep all ten browser suites in the two shards. Cancel superseded PR checks only. The private parent workspace owns deployment authorization, durable release state and private-value evidence; never copy that material here.
