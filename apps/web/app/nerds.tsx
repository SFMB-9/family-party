"use client";

/**
 * "For Nerds": the cloud architecture behind the game, as a clickable pixel diagram.
 * Sprites live in /public/sprites/arch/<id>.png (24×24, drawn at 2×). Swap the PNGs to restyle;
 * the layout, edges and copy are all here.
 */
import { useEffect, useState } from "react";

type NodeId = "players" | "vercel" | "apigw" | "lambda" | "dynamodb" | "s3" | "iam" | "budget" | "actions" | "tfstate";

interface ArchNode {
  id: NodeId;
  label: string;
  x: number; // center, in viewBox units
  y: number;
  title: string;
  body: string;
  terraform: string[];
}

const NODES: ArchNode[] = [
  {
    id: "vercel", label: "Vercel", x: 110, y: 100,
    title: "Vercel · Next.js",
    body: "Serves the web app (TV screen and phone controller) and an Open Graph preview per room. Every merge to main deploys it.",
    terraform: [],
  },
  {
    id: "players", label: "Phones + TV", x: 110, y: 300,
    title: "Phones and the shared screen",
    body: "Any browser, no app to install. The TV or laptop shows the board; each phone is a controller. A heartbeat every 20 s measures latency and reconnects dead sockets.",
    terraform: [],
  },
  {
    id: "apigw", label: "API Gateway", x: 350, y: 260,
    title: "API Gateway · WebSocket API",
    body: "Holds every open socket. Three routes ($connect, $disconnect, $default) all go to one Lambda, and the Lambda pushes state back to each phone through the connections API.",
    terraform: ["aws_apigatewayv2_api.ws", "aws_apigatewayv2_route.routes", "aws_apigatewayv2_stage.dev"],
  },
  {
    id: "lambda", label: "Lambda", x: 600, y: 260,
    title: "Lambda · game-session",
    body: "Node 22 on arm64 (Graviton), 256 MB. Runs a pure game reducer: identity comes from the connection and time from the server clock, so a phone can't lie about either. Every write uses optimistic locking.",
    terraform: ["aws_lambda_function.game_session", "aws_cloudwatch_log_group.game_session"],
  },
  {
    id: "dynamodb", label: "DynamoDB", x: 860, y: 230,
    title: "DynamoDB · rooms + connections",
    body: "On-demand billing, so it costs $0 when nobody is playing. Rooms expire after 12 h through TTL, and a version number on every room stops two Lambdas from overwriting each other.",
    terraform: ["aws_dynamodb_table.rooms", "aws_dynamodb_table.connections"],
  },
  {
    id: "s3", label: "S3 packs", x: 860, y: 380,
    title: "S3 · private question packs",
    body: "Family packs, unlocked in a room with a code that's stored only as a scrypt hash. The bucket policy explicitly denies everyone except the Lambda (read) and the admin role (write), HTTPS only, versioned.",
    terraform: ["aws_s3_bucket.packs", "aws_s3_bucket_policy.packs", "aws_s3_bucket_versioning.packs"],
  },
  {
    id: "iam", label: "IAM", x: 600, y: 400,
    title: "IAM · least privilege",
    body: "The Lambda's role can only touch its two tables, push to its own API's connections and read packs. In CI, the plan role is read-only and the apply role is scoped to family-party-* resources.",
    terraform: ["aws_iam_role.game_session", "aws_iam_role.plan", "aws_iam_role.apply"],
  },
  {
    id: "budget", label: "Budget", x: 350, y: 400,
    title: "Budget alarm",
    body: "A $5/month AWS budget with email alerts. A four-hour family night with eleven devices costs a few cents.",
    terraform: ["aws_budgets_budget.monthly"],
  },
  {
    id: "actions", label: "GitHub Actions", x: 470, y: 560,
    title: "GitHub Actions · OIDC, no stored keys",
    body: "Each run trades a GitHub OIDC token for short-lived AWS credentials. Pull requests get the Terraform plan as a comment; merging to main applies it after a manual approval.",
    terraform: ["aws_iam_openid_connect_provider.github"],
  },
  {
    id: "tfstate", label: "Terraform state", x: 760, y: 560,
    title: "Terraform · three stacks",
    body: "bootstrap creates the state bucket, ci creates the OIDC provider and roles (applied by hand), and live is everything above, applied only by the pipeline. S3-native locking, no lock table.",
    terraform: ["aws_s3_bucket.tfstate"],
  },
];

/** Orthogonal paths between nodes, in viewBox units. `back` draws dashed (a response or push). */
const EDGES: { points: [number, number][]; label: string; lx: number; ly: number; back?: boolean }[] = [
  { points: [[110, 252], [110, 148]], label: "HTTPS", lx: 122, ly: 204 },
  { points: [[174, 290], [286, 290]], label: "wss://", lx: 180, ly: 280 },
  { points: [[414, 250], [536, 250]], label: "3 routes", lx: 440, ly: 240 },
  { points: [[536, 274], [414, 274]], label: "push state", lx: 436, ly: 292, back: true },
  { points: [[664, 250], [740, 250], [740, 230], [796, 230]], label: "rooms", lx: 690, ly: 240 },
  { points: [[664, 270], [740, 270], [740, 380], [796, 380]], label: "read packs", lx: 748, ly: 330 },
  { points: [[600, 308], [600, 352]], label: "role", lx: 610, ly: 334 },
  { points: [[470, 512], [470, 480], [600, 480], [600, 448]], label: "OIDC", lx: 480, ly: 474 },
  { points: [[534, 560], [696, 560]], label: "plan · apply", lx: 568, ly: 550 },
];

/** Unlocks the "Behind the scenes" pack (in the private bucket like any other, but meant to be found). */
const CHALLENGE_CODE = "TERRAFORMAPPLY";

const BOX_W = 128;
const BOX_H = 92;

export function NerdsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="nerds-btn" onClick={() => setOpen(true)} title="How it's built" aria-haspopup="dialog">
        <CloudIcon />
        <span>For Nerds</span>
      </button>
      {open && <NerdsPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function NerdsPanel({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<NodeId>("lambda");
  const node = NODES.find((n) => n.id === selected)!;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay nerds" role="dialog" aria-modal="true" aria-label="How Family Party is built" onClick={onClose}>
      <div className="nerds-card" onClick={(e) => e.stopPropagation()}>
        <header className="nerds-head">
          <p className="pixel-title">How it&apos;s built</p>
          <button className="btn small" onClick={onClose}>Close</button>
        </header>

        <div className="arch-wrap">
        <svg className="arch" viewBox="0 0 1000 620" shapeRendering="crispEdges" role="group" aria-label="Architecture diagram">
          {/* The AWS region, drawn as a dashed pixel frame */}
          <rect x="236" y="170" width="752" height="290" className="region" />
          <text x="252" y="196" className="region-label">AWS · mx-central-1 (México)</text>

          {EDGES.map((e, i) => (
            <g key={i} className={`edge ${e.back ? "back" : ""}`}>
              <polyline points={e.points.map((p) => p.join(",")).join(" ")} />
              <text x={e.lx} y={e.ly}>{e.label}</text>
            </g>
          ))}

          {NODES.map((n) => (
            <g
              key={n.id}
              className={`node ${n.id === selected ? "on" : ""}`}
              transform={`translate(${n.x - BOX_W / 2} ${n.y - BOX_H / 2})`}
              role="button"
              tabIndex={0}
              aria-pressed={n.id === selected}
              aria-label={n.title}
              onClick={() => setSelected(n.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSelected(n.id))}
            >
              <rect width={BOX_W} height={BOX_H} className="box" />
              <image href={`/sprites/arch/${n.id}.png`} x={BOX_W / 2 - 24} y={10} width={48} height={48} className="sprite" />
              <text x={BOX_W / 2} y={80} className="node-label">{n.label}</text>
            </g>
          ))}
        </svg>
        </div>

        <section className="nerds-detail" aria-live="polite">
          <h3>{node.title}</h3>
          <p>{node.body}</p>
          {node.terraform.length > 0 && (
            <p className="tf">
              {node.terraform.map((r) => <code key={r}>{r}</code>)}
            </p>
          )}
        </section>

        <aside className="nerds-challenge">
          <span className="pixel-title small">Think you got all that?</span>
          <span>
            Create a room, open <b>Opciones → Preguntas</b> (Options → Questions) and enter <code>{CHALLENGE_CODE}</code> to play a pack of questions about
            this project. The code is public on purpose: unlocking it is the private-pack flow above, end to end.
          </span>
        </aside>

        <footer className="nerds-foot">
          Terraform, CI/CD and game code are public:{" "}
          <a href="https://github.com/SFMB-9/family-party" target="_blank" rel="noreferrer">github.com/SFMB-9/family-party</a>
        </footer>
      </div>
    </div>
  );
}

/** 12×12 pixel cloud, same grid approach as the booklet and cog icons. */
function CloudIcon() {
  const rows = [
    "............",
    "....####....",
    "...######...",
    ".##########.",
    "############",
    "############",
    ".##########.",
    "............",
  ];
  return (
    <svg className="cloud-icon" viewBox="0 0 12 8" width="24" height="16" aria-hidden shapeRendering="crispEdges">
      {rows.flatMap((row, y) => [...row].map((c, x) => (c === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" /> : null)))}
    </svg>
  );
}
