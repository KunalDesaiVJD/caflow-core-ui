/**
 * create-client-logins.mjs
 *
 * Creates Supabase Auth accounts for all clients that:
 *   • are active
 *   • have an email address
 *   • have no portal login yet (user_id IS NULL)
 *
 * Strategy for shared emails (one person / multiple entities):
 *   ONE auth account per unique email — all client records with that
 *   email get the same user_id linked.
 *
 * Default password: Client@2025!
 * Role: client
 *
 * Usage: node scripts/create-client-logins.mjs
 */

const SUPABASE_URL  = "https://hubyywmodekfdzhwiumb.supabase.co";
// SECURITY: this used to be a service_role key hardcoded in plain text —
// full, unrestricted database access, bypassing every RLS policy — checked
// into and pushed to git. It's now read from the environment instead. This
// does NOT undo the exposure: the old key value is still present in this
// file's git history and must be treated as compromised. Rotate it from the
// Supabase dashboard (Project Settings → API → service_role → regenerate),
// then set the new value as SUPABASE_SERVICE_ROLE_KEY before running this
// script — never paste it back into this file.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("[create-client-logins] SUPABASE_SERVICE_ROLE_KEY environment variable is not set. Aborting.");
  process.exit(1);
}
const FIRM_ID       = "be411601-f0f5-4f74-b93d-b87a8ef1b82b";
const DEFAULT_PASS  = "Client@2025!";
const BATCH_DELAY   = 120; // ms between auth creates to avoid rate-limiting

const headers = {
  "Content-Type":  "application/json",
  "apikey":        SERVICE_KEY,
  "Authorization": `Bearer ${SERVICE_KEY}`,
};

// ── REST helpers ──────────────────────────────────────────────────────────────

async function supabaseGet(path) {
  const r = await fetch(`${SUPABASE_URL}${path}`, { headers });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

async function supabasePost(path, body) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method: "POST", headers,
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
  return { ok: r.ok, status: r.status, data };
}

async function supabasePatch(path, body) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method: "PATCH", headers,
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
  return { ok: r.ok, status: r.status, data };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log(" CAFlow — Bulk Client Login Creator");
  console.log("=".repeat(60));
  console.log();

  // 1. Fetch all clients needing a login (no user_id, has email)
  console.log("Fetching clients without portal logins...");
  const clients = await supabaseGet(
    `/rest/v1/clients?is_active=eq.true&user_id=is.null&email=not.is.null&select=id,name,email,mobile&order=name`
  );

  const eligibleClients = clients.filter(c => c.email && c.email.trim() !== "");
  console.log(`Found ${eligibleClients.length} clients with emails needing logins.\n`);

  // 2. Group by unique email (one auth account per email)
  const byEmail = new Map();
  for (const c of eligibleClients) {
    const email = c.email.trim().toLowerCase();
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(c);
  }
  console.log(`Unique emails: ${byEmail.size} (${eligibleClients.length - byEmail.size} clients share an email with another client)\n`);

  // 3. Check which emails already have an auth user (paginate through all pages)
  console.log("Checking existing auth users...");
  const existingEmails = new Map();
  let page = 1;
  while (true) {
    const res = await supabaseGet(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    const users = res.users || res || [];
    if (!Array.isArray(users) || users.length === 0) break;
    for (const u of users) {
      if (u.email) existingEmails.set(u.email.toLowerCase(), u.id);
    }
    if (users.length < 1000) break;
    page++;
  }
  console.log(`Found ${existingEmails.size} existing auth users.\n`);

  // 4. Process each unique email
  let created = 0, linked = 0, skipped = 0, failed = 0;
  const failedList = [];
  const results = [];

  let idx = 0;
  for (const [email, clientGroup] of byEmail) {
    idx++;
    const primaryClient = clientGroup[0];
    const names = clientGroup.map(c => c.name).join(" / ");
    process.stdout.write(`[${idx}/${byEmail.size}] ${email.substring(0, 40).padEnd(42)} `);

    let userId = existingEmails.get(email);

    // A. Create auth user if not exists
    if (!userId) {
      const { ok, status, data } = await supabasePost("/auth/v1/admin/users", {
        email,
        password:      DEFAULT_PASS,
        email_confirm: true,
        user_metadata: { role: "client", firm_id: FIRM_ID, name: primaryClient.name },
      });

      if (!ok || !data.id) {
        const errMsg = data?.msg || data?.message || JSON.stringify(data).substring(0, 80);
        process.stdout.write(`✗ Auth create failed: ${errMsg}\n`);
        failed++;
        failedList.push({ email, names, error: errMsg });
        await sleep(BATCH_DELAY);
        continue;
      }
      userId = data.id;
      created++;

      // B. Insert into public.users
      const { ok: uok } = await supabasePost("/rest/v1/users", {
        id:                  userId,
        name:                primaryClient.name,
        email:               email,
        phone:               primaryClient.mobile || null,
        role:                "client",
        firm_id:             FIRM_ID,
        is_active:           true,
        must_change_password: false,
      });
      // Ignore duplicate key errors (user might already exist from a previous partial run)
      if (!uok) {
        // Try to fetch existing public.users record
        const existing = await supabaseGet(`/rest/v1/users?email=eq.${encodeURIComponent(email)}&limit=1`);
        if (existing.length > 0) userId = existing[0].id;
      }

      process.stdout.write(`✓ created  `);
    } else {
      process.stdout.write(`↩ exists   `);
      skipped++;
    }

    // C. Link ALL client records with this email to the userId
    let linkCount = 0;
    for (const c of clientGroup) {
      const { ok: lok } = await supabasePatch(
        `/rest/v1/clients?id=eq.${c.id}`,
        { user_id: userId }
      );
      if (lok) linkCount++;
    }
    linked += linkCount;
    process.stdout.write(`→ linked ${linkCount} client${linkCount !== 1 ? "s" : ""}: ${names.substring(0, 50)}\n`);

    results.push({ email, userId, clients: clientGroup.length, names });
    await sleep(BATCH_DELAY);
  }

  // 5. Summary
  console.log();
  console.log("=".repeat(60));
  console.log(" SUMMARY");
  console.log("=".repeat(60));
  console.log(`  Auth accounts created : ${created}`);
  console.log(`  Existing accounts used: ${skipped}`);
  console.log(`  Client records linked : ${linked}`);
  console.log(`  Failed                : ${failed}`);
  console.log(`  Default password      : ${DEFAULT_PASS}`);
  console.log(`  Portal URL            : https://caflow-core-ui.vercel.app/portal`);
  console.log();

  if (failedList.length > 0) {
    console.log("FAILED:");
    for (const f of failedList) {
      console.log(`  ✗ ${f.email} — ${f.error}`);
    }
    console.log();
  }

  // 6. Remaining (no-email) clients
  const noEmailCount = clients.filter(c => !c.email || !c.email.trim()).length;
  console.log(`  Skipped (no email)    : ${noEmailCount} clients — cannot create portal login without email`);
  console.log("=".repeat(60));
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
