# family-party

![CI](https://github.com/SFMB-9/family-party/actions/workflows/ci.yml/badge.svg)

A Jeopardy-style trivia game for game nights: one shared screen shows the board, and every phone is a controller. No app to install, no accounts. It's a web rebuild of a Unity game I made for my family in 2023, and a working exercise in AWS serverless, Terraform and CI/CD.

## Architecture

```
Phones + TV ──wss──▶ API Gateway (WebSocket) ──▶ Lambda (game-session) ──▶ DynamoDB (rooms, connections)
     │                        ▲                         │
     └──https──▶ Vercel       └──── push state ─────────┘──▶ S3 (private question packs)
                (Next.js)
```

- **One Lambda, three routes.** `$connect`, `$disconnect` and `$default` all hit `game-session`, which runs a pure reducer from `packages/game-core`. Identity comes from the connection and time from the server clock, so a phone can't fake either.
- **Optimistic locking.** Every room write carries a version number, so two concurrent Lambdas can't overwrite each other.
- **$0 when idle.** DynamoDB on-demand, rooms expire after 12 h by TTL, Lambda on arm64. A $5/month budget alarm is the safety net.
- **Private packs.** Family question packs live in a versioned S3 bucket. An explicit-deny bucket policy allows reads only to the Lambda role and writes only to the admin SSO role. Each pack is unlocked in a room with a code that's stored only as a scrypt hash.
- **Region:** mx-central-1 (Mexico).

There's also a clickable version of this diagram in the game itself: **For Nerds** on the home screen.

## Repo layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js app: TV board, phone controller, room previews |
| `services/game-session` | The Lambda, a local WebSocket dev server, and pack tools (`pack-sheet`, `lock-pack`) |
| `packages/game-core` | Game rules as a pure, fully tested reducer |
| `packages/protocol` | Client/server message types |
| `packages/question-bank` | Public question packs and the spreadsheet-to-pack parser |
| `infra/bootstrap` | Terraform state bucket (applied once, by hand) |
| `infra/ci` | GitHub OIDC provider and the plan/apply roles (applied by hand) |
| `infra/live` | Everything the game runs on, applied only by the pipeline |

## CI/CD

- **`ci.yml`** typechecks and tests every push.
- **`terraform.yml`** runs on changes to `infra/live`, the Lambda's code or the shared packages. Pull requests get `terraform plan` posted as a comment using a read-only role. Merging to `main` applies it after a manual approval in the `production` environment.
- **No stored AWS keys.** GitHub's OIDC token is exchanged for short-lived credentials, and each role's trust policy is pinned to this repo by its immutable owner and repo IDs: the plan role to pull requests, the apply role to the `production` environment.

## Run it locally

Requires Node 22 and pnpm.

```sh
pnpm install
pnpm check                                         # typecheck + tests

# terminal 1: game server on ws://localhost:8787
pnpm --filter @family-party/game-session dev

# terminal 2: web app on http://localhost:3000
echo NEXT_PUBLIC_WS_URL=ws://localhost:8787 > apps/web/.env.local
pnpm --filter @family-party/web dev
```

Open the app on a laptop to host, then join from a phone on the same network.

## Operations

- **Cost cap:** the WebSocket stage throttles at 20 messages/s (burst 50), and only API Gateway can invoke the Lambda, so that also caps invocations. A $5/month budget emails at 80% spent and 100% forecast.
- **Fast alerts:** CloudWatch alarms email through SNS when traffic passes 30,000 messages/hour or the Lambda throws more than 10 errors in 5 minutes (`infra/live/alerts.tf`). Billing data lags a day; these arrive within minutes.
- **Kill switch:** stop all traffic in seconds by dropping the stage throttle to zero. The next `terraform apply` restores it.
  ```sh
  API=$(aws apigatewayv2 get-apis --query "Items[?Name=='family-party-ws'].ApiId" --output text --profile family-party)
  aws apigatewayv2 update-stage --api-id "$API" --stage-name dev \
    --default-route-settings ThrottlingBurstLimit=0,ThrottlingRateLimit=0 --profile family-party
  ```

## How this was built

The game comes from a Unity version I designed for my family in 2023. This rebuild was paired with Claude: it drafted most of the code, and I made the design, architecture and security decisions and reviewed every change before it shipped.
