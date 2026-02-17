# GitLab → GitHub Mirroring Guide

> Mirror `gitlab.com/samuelbirk-private/crawfish/claw-platform` → `github.com/crawfishlabs/crawfish`

## Prerequisites

### 1. Create the GitHub Organization

1. Go to https://github.com/account/organizations/new
2. Choose the **Free** plan
3. Organization name: **crawfishlabs** (recommended) or `crawfish-platform`
4. Contact email: your email
5. Select "My personal account" for ownership

### 2. Create a GitHub Personal Access Token (PAT)

1. Go to https://github.com/settings/tokens?type=beta (fine-grained) or https://github.com/settings/tokens/new (classic)
2. **Classic token** is simpler for mirroring:
   - Name: `gitlab-mirror`
   - Expiration: 1 year (set a calendar reminder to rotate)
   - Scopes: `repo` (full control of private repositories)
3. Copy the token — you'll need it below

### 3. Create the Target GitHub Repo

```bash
# Via gh CLI
gh repo create crawfishlabs/crawfish --public --description "Crawfish Platform — adapters, SDK, and core packages for building AI assistants"

# Or manually: https://github.com/organizations/crawfishlabs/repositories/new
# Name: crawfish
# Visibility: Public
# Do NOT initialize with README (mirror will push everything)
```

---

## Option A: GitLab Push Mirroring ⭐ Recommended

**Simplest approach.** GitLab pushes to GitHub automatically on every push. Zero maintenance. Available on GitLab Free tier.

### Setup

1. Open your GitLab project: `gitlab.com/samuelbirk-private/crawfish/claw-platform`
2. Go to **Settings → Repository**
3. Expand **Mirroring repositories**
4. Fill in:
   - **Git repository URL:** `https://github-push-mirror:TOKEN@github.com/crawfishlabs/crawfish.git`
     - Replace `TOKEN` with your GitHub PAT
     - The username (`github-push-mirror`) can be anything — GitLab uses the token for auth
   - **Mirror direction:** Push
   - **Authentication method:** Password
   - **Password:** _(leave empty — token is in the URL)_
   - **Only mirror protected branches:** Uncheck (mirror everything)
   - **Keep divergent refs:** Check (recommended)
5. Click **Mirror repository**
6. Click the refresh button (🔄) next to the new mirror entry to trigger the first sync

### How It Works

- GitLab pushes all branches and tags to GitHub after every push event
- Sync happens within ~5 minutes of a push
- If sync fails, GitLab retries and shows errors in the mirroring UI
- Force-push on GitLab = force-push on GitHub

### Verify

```bash
# Check GitHub has the content
git clone https://github.com/crawfishlabs/crawfish.git /tmp/crawfish-verify
cd /tmp/crawfish-verify
git log --oneline -5
```

### Troubleshooting

| Issue | Fix |
|-------|-----|
| "remote: Permission denied" | Token expired or wrong scope — regenerate with `repo` scope |
| Mirror stuck "pending" | Click refresh button; check token hasn't been revoked |
| Branches missing | Uncheck "Only mirror protected branches" |
| GitHub repo not empty | Delete and recreate empty, or force the first mirror |

---

## Option B: GitHub Actions Pull Mirror

Pull from GitLab on a schedule. Useful if you want GitHub to own the sync, or if GitLab push mirroring ever becomes paid-only.

### Setup

1. Create the GitHub repo (see Prerequisites above)
2. Add a GitLab deploy token or use a public repo (no auth needed for public)
3. Add this workflow to the GitHub repo:

Create `.github/workflows/mirror.yml`:

```yaml
name: Mirror from GitLab

on:
  schedule:
    - cron: '*/15 * * * *'  # Every 15 minutes
  workflow_dispatch: {}       # Manual trigger

jobs:
  mirror:
    runs-on: ubuntu-latest
    steps:
      - name: Mirror from GitLab
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Pull from GitLab and push
        run: |
          git remote add gitlab https://gitlab.com/samuelbirk-private/crawfish/claw-platform.git || true
          git fetch gitlab --prune
          
          # Mirror all branches
          for branch in $(git branch -r | grep 'gitlab/' | grep -v HEAD | sed 's|gitlab/||'); do
            git checkout -B "$branch" "gitlab/$branch"
            git push origin "$branch" --force
          done
          
          # Mirror all tags
          git push origin --tags --force
        env:
          GIT_AUTHOR_NAME: Mirror Bot
          GIT_AUTHOR_EMAIL: mirror@crawfishlabs.dev
```

> **Note:** For private GitLab repos, add `GITLAB_TOKEN` as a GitHub secret and use:
> `https://oauth2:${{ secrets.GITLAB_TOKEN }}@gitlab.com/samuelbirk-private/crawfish/claw-platform.git`

### Pros/Cons vs Option A

| | Option A (Push) | Option B (Pull) |
|---|---|---|
| Setup complexity | Simple (UI) | Medium (workflow file) |
| Sync speed | ~5 min | Cron-based (15 min+) |
| Maintenance | None | Workflow updates |
| Auth direction | GitLab stores GitHub token | GitHub stores GitLab token |
| Works with free tier | ✅ | ✅ |

---

## Option C: CI/CD Pipeline Mirror

Push to GitHub only after CI passes. Maximum control — broken code never reaches GitHub.

### Setup

Add to `.gitlab-ci.yml`:

```yaml
mirror-to-github:
  stage: deploy
  image: alpine/git:latest
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH  # main branch only
    - if: $CI_COMMIT_TAG                             # all tags
  variables:
    GITHUB_REPO: "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/crawfishlabs/crawfish.git"
  script:
    - git remote add github "$GITHUB_REPO" || git remote set-url github "$GITHUB_REPO"
    - |
      if [ -n "$CI_COMMIT_TAG" ]; then
        git push github "$CI_COMMIT_TAG" --force
      else
        git push github "HEAD:$CI_COMMIT_BRANCH" --force
      fi
  allow_failure: true  # Don't block pipeline if GitHub is down
```

### Required CI/CD Variables

Set in **Settings → CI/CD → Variables**:

| Variable | Value | Protected | Masked |
|----------|-------|-----------|--------|
| `GITHUB_USER` | `crawfishlabs-bot` (or any username) | ✅ | ❌ |
| `GITHUB_TOKEN` | Your GitHub PAT | ✅ | ✅ |

### Extending to Mirror All Branches

Replace the `rules` section:

```yaml
  rules:
    - if: $CI_COMMIT_BRANCH  # all branches
    - if: $CI_COMMIT_TAG     # all tags
```

---

## Recommendation

**Use Option A (GitLab Push Mirroring)** unless you have a specific reason not to.

- Zero config files to maintain
- Instant sync
- Free tier ✅
- Battle-tested by GitLab

Switch to Option C only if you need "tests must pass before public mirror updates."

---

## Repos to Mirror

### Now
| GitLab | GitHub | Status |
|--------|--------|--------|
| `samuelbirk-private/crawfish/claw-platform` | `crawfishlabs/crawfish` | 🟡 Ready to set up |

### Later (when ready)
| GitLab | GitHub | Notes |
|--------|--------|-------|
| `claw-web/apps/marketing` | `crawfishlabs/crawfish-web` | Marketing site, once public |
| SDK standalone | `crawfishlabs/crawfish-sdk` | Extract from platform monorepo |

### Never Mirror (Private)
- `claw-health`, `claw-budget`, `claw-meetings`, `claw-web`, `claw-bootstrap`

---

## GitHub Repo Setup Checklist

After mirroring is working:

- [ ] Replace `README.md` on GitHub with `README.github.md` (or set up Option C to swap it during mirror)
- [ ] Enable GitHub Issues (for community bug reports)
- [ ] Enable GitHub Discussions (optional — for community Q&A)
- [ ] Set up branch protection on `main` (prevent direct pushes from GitHub side)
- [ ] Add topics: `ai`, `assistant`, `sdk`, `typescript`, `open-source`
- [ ] Add repository description and website URL
- [ ] Pin the repo in the org profile

## Automating README Swap

If you want a different README on GitHub vs GitLab, add to `.gitlab-ci.yml` (Option C only):

```yaml
mirror-to-github:
  # ... (same as above)
  script:
    - cp README.github.md README.md  # Swap before pushing
    - git add README.md
    - git commit -m "chore: use GitHub README" --allow-empty || true
    - git remote add github "$GITHUB_REPO" || git remote set-url github "$GITHUB_REPO"
    - git push github "HEAD:$CI_COMMIT_BRANCH" --force
```

For Option A (push mirror), both repos share the same README. You can either:
1. Use a single README that works for both (recommended)
2. Use a GitHub Action to swap it after mirror push
