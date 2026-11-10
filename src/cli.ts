#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

// `attention migrate` — apply the bundled SQL migrations to a Postgres /
// Supabase database. Idempotent: every migration uses `if not exists`, so
// re-running is safe. Pass `--seed` to also insert the example boards when the
// table is empty.
//
//   npx attention migrate --url "postgresql://..."
//   DATABASE_URL=postgresql://... npx attention migrate --seed
//
// The connection string is your project's *direct* Postgres URL (Supabase →
// Project Settings → Database → Connection string). SSL is enabled for remote
// hosts automatically.

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

const SEED_SQL = `
insert into public.attention_boards (name, color, sender_domains, keywords, rules, position)
select * from (values
  ('Events',  '#a78bfa',
   array['lu.ma','luma.com','eventbrite.com'],
   array['event','rsvp','invite','ticket','webinar','meetup'],
   'Event invitations and RSVPs, e.g. from Luma or Eventbrite.', 0),
  ('Finance', '#34d399',
   array['chase.com','paypal.com','apple.com'],
   array['statement','payment','receipt','invoice','transaction','balance'],
   'Statements and receipts from Apple Card, Chase, or PayPal.', 1),
  ('Chores',  '#fbbf24',
   array['']::text[],
   array['chore','household','delivery','order'],
   'Household chores and errands.', 2)
) as v(name, color, sender_domains, keywords, rules, position)
where not exists (select 1 from public.attention_boards);
`;

type Args = { command: string; url: string | null; seed: boolean };

function parseArgs(argv: string[]): Args {
  let url: string | null = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL ?? null;
  let seed = false;
  let command = "migrate";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url" || arg === "-u") url = argv[++i] ?? url;
    else if (arg === "--seed") seed = true;
    else if (arg === "--help" || arg === "-h") command = "help";
    else if (!arg.startsWith("-")) command = arg;
  }
  return { command, url, seed };
}

function help(): void {
  console.log(`@markbase/attention — database setup

Usage:
  attention migrate [--url <postgres-url>] [--seed]
  attention --help

Options:
  --url, -u   Postgres/Supabase connection string (default: $DATABASE_URL).
  --seed      Insert the example boards (only if no boards exist yet).

Examples:
  DATABASE_URL=postgresql://... attention migrate
  attention migrate --url "postgresql://..." --seed
`);
}

function needsSsl(url: string): boolean {
  if (/sslmode=disable/.test(url)) return false;
  return !/@(localhost|127\.0\.0\.1)/.test(url);
}

async function migrate(args: Args): Promise<void> {
  if (!args.url) {
    console.error(
      "No database URL. Pass --url or set DATABASE_URL (your Supabase direct Postgres connection string)."
    );
    process.exit(1);
  }

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    console.error("No migrations found in the package.");
    process.exit(1);
  }

  const client = new Client({
    connectionString: args.url,
    ssl: needsSsl(args.url) ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    await client.query("begin");
    for (const file of files) {
      const sql = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
      process.stdout.write(`  applying ${file} … `);
      await client.query(sql);
      console.log("ok");
    }
    if (args.seed) {
      process.stdout.write("  seeding example boards … ");
      await client.query(SEED_SQL);
      console.log("ok");
    }
    await client.query("commit");
    console.log("Attention schema is up to date.");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.error(
      `Migration failed: ${e instanceof Error ? e.message : String(e)}`
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.command === "help") {
  help();
} else if (args.command === "migrate") {
  migrate(args);
} else {
  console.error(`Unknown command: ${args.command}\n`);
  help();
  process.exit(1);
}
