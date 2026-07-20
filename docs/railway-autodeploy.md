# Railway autodeploy runbook

Production is Railway project `objetdart`, environment `production`, service
`objetdart`, domain `objetdart-production.up.railway.app`.

Stable IDs used by the CLI:

- Project: `b4e02a7a-826b-4eb9-9f0d-d6c55c61e5fe`
- Service: `a812cc1e-fe1e-4729-8b7e-c003788fcd2b`

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
railway status \
  --project b4e02a7a-826b-4eb9-9f0d-d6c55c61e5fe \
  --environment production \
  --json \
| jq '{
  project: .name,
  service: (.services.edges[]?.node | select(.name == "objetdart") | {id, name}),
  instance: (.environments.edges[]?.node.serviceInstances.edges[]?.node
    | select(.serviceName == "objetdart")
    | {
        source,
        latest: (.latestDeployment | {
          id,
          status,
          createdAt,
          reason: (.meta.reason // null),
          branch: (.meta.branch // null),
          repo: (.meta.repo // null),
          commitHash: (.meta.commitHash // null),
          cliCaller: (.meta.cliCaller // null),
          cliMessage: (.meta.cliMessage // null)
        })
      })
}'
```

Compare `latest.commitHash` with `git rev-parse origin/main`. If Railway is
behind `origin/main`, the GitHub trigger is not healthy or has not fired yet.
If `commitHash`, `branch`, and `repo` are null while `cliCaller` is present, the
running deployment came from a CLI upload or redeploy and does not prove that
the current GitHub `main` revision is live.

The source can be connected even when the latest deployment is CLI-sourced.
Source presence is not proof that its trigger branch is `main`.

## Repair the branch trigger

Reconnect the service source explicitly to `main`:

```bash
railway service source connect \
  --project b4e02a7a-826b-4eb9-9f0d-d6c55c61e5fe \
  --repo jawauntb/objetdart_proj \
  --branch main \
  --service objetdart \
  --environment production \
  --json
```

A healthy reconnect reports the repo and branch, then Railway should queue a
GitHub-sourced deployment for the latest `main` commit.

Do this only after the pull request is merged. The command changes the service
source and may immediately queue a production deployment.

## Verify the post-merge deployment

Capture the expected revision, then inspect the deployment records without
printing environment values:

```bash
git fetch origin main
git rev-parse origin/main

railway deployment list \
  --project b4e02a7a-826b-4eb9-9f0d-d6c55c61e5fe \
  --environment production \
  --service objetdart \
  --limit 5 --json \
| jq 'map({
    id,
    status,
    createdAt,
    reason: (.meta.reason // null),
    branch: (.meta.branch // null),
    repo: (.meta.repo // null),
    commitHash: (.meta.commitHash // null),
    cliCaller: (.meta.cliCaller // null),
    cliMessage: (.meta.cliMessage // null)
  })'

railway service status \
  --project b4e02a7a-826b-4eb9-9f0d-d6c55c61e5fe \
  --environment production \
  --service objetdart --json \
| jq '{id, name, status, deploymentId, stopped}'
```

The accepted deployment must be `SUCCESS`, GitHub-sourced, and attributable to
the captured `origin/main` SHA. If the CLI still omits commit metadata, verify
the trigger branch and commit in the Railway deployment UI; do not infer the
revision from a successful healthcheck.

Check required variable names without exposing values:

```bash
railway variables \
  --project b4e02a7a-826b-4eb9-9f0d-d6c55c61e5fe \
  --environment production \
  --service objetdart --json \
| jq 'keys | sort'
```

The Atlas progressive path needs `ATLAS_GENERATION_ENABLED`,
`ATLAS_IMAGE_PROVIDER`, `OPENAI_API_KEY`, and `OPENROUTER_API_KEY`. Presence is
not proof that the values are valid.

Finally verify HTTP health:

```bash
curl -fsS -o /dev/null -w 'home %{http_code} %{time_total}s\n' \
  https://objetdart-production.up.railway.app/
curl -fsS -o /dev/null -w 'atlas %{http_code} %{time_total}s\n' \
  https://objetdart-production.up.railway.app/atlas/origin
curl -sS -o /dev/null -w 'atlas-api-get %{http_code} %{time_total}s\n' \
  https://objetdart-production.up.railway.app/api/atlas/generate
```

Expected: home `200`, Atlas `200`, and API GET `405` because the generation
route is POST-only. These checks do not prove that paid providers work; run the
focused Atlas browser smoke in `docs/atlas-progressive-qa.md` afterward.

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

Avoid using `railway up`, `railway deployment up`, or `railway redeploy` for
normal production deploys. Upload commands create CLI-sourced deployments;
`redeploy` reuses the existing artifact. Either path can hide whether the
GitHub `main` trigger is healthy or leave production on an older revision.
