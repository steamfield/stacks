# Deployment

Local checks need no Cloudflare credentials. Creating a project never provisions cloud
resources. The user supplies the account, API token, production bindings and domains.
Keep enabling cron triggers under Pending user actions until a schedule is chosen.

Create a separate deployment workflow after CI exists. Trigger only after successful CI
for the exact tested default-branch commit and check that commit out explicitly. Use
least-privilege job permissions and actions pinned to resolved commit SHAs. Never deploy
fork pull requests. Read Node and Bun versions from the project, install the frozen
lockfile, build, then deploy with the locally installed Wrangler. Store
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as protected CI secrets.

With D1, create the production database separately, replace the local-only identifier,
and apply reviewed remote migrations before deploying the compatible Worker. Local
migration commands and tests must always use local storage.
