# Railway autodeploy runbook

Production is Railway project `objetdart`, environment `production`, service
`objetdart`, domain `objetdart-production.up.railway.app`.

The service should deploy from GitHub, not from local uploads. Railway docs say
a GitHub-sourced service automatically deploys when a new commit is pushed to
the linked branch. For this repo, the linked branch should be `main`.

## Expected shape

- GitHub repo: `jawauntb/objetdart_proj`
- GitHub branch: `main`
- Config file: `/railway.json`
- Build command: `npm run build`
- Start command: `npm run start`

## Verify the current state

```bash
railway link --project objetdart --environment production --service objetdart
railway status --json | jq '{
  project: .name,
  service: .services.edges[0].node.name,
  source: .environments.edges[0].node.serviceInstances.edges[0].node.source,
  latest: .environments.edges[0].node.serviceInstances.edges[0].node.latestDeployment
    | {status, createdAt, branch: .meta.branch, repo: .meta.repo, commitHash: .meta.commitHash}
}'
```

Compare `latest.commitHash` with `git rev-parse origin/main`. If Railway is
behind `origin/main`, the GitHub trigger is not healthy or has not fired yet.

## Repair the branch trigger

Reconnect the service source explicitly to `main`:

```bash
railway service source connect \
  --repo jawauntb/objetdart_proj \
  --branch main \
  --service objetdart \
  --environment production \
  --json
```

A healthy reconnect reports the repo and branch, then Railway should queue a
GitHub-sourced deployment for the latest `main` commit.

## If it still does not deploy

Check Railway service settings for the GitHub trigger:

- Autodeploy should be enabled.
- The trigger branch should be `main`.
- Watch paths should be empty, or should include the changed files.
- If Wait for CI is enabled, the required GitHub checks must complete
  successfully before Railway deploys.

Also check Railway's GitHub permissions:

- At least one Railway project member must have a connected GitHub account with
  contributor access to `jawauntb/objetdart_proj`.
- The Railway GitHub App must have access to this repository.
- Any pending Railway GitHub App permission update must be accepted.

Avoid using `railway up` for normal production deploys. It uploads the local
directory and produces CLI-sourced deployments, which can hide whether the
GitHub `main` trigger is actually working.
