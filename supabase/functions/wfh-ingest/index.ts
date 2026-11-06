// wfh-ingest — receives screenshot batches from the WFH agent and stores them.
//
// The agent runs on a company laptop and holds NO Supabase user session. It
// authenticates with a shared device token (WFH_INGEST_TOKEN) and this function
// writes with the service role (which bypasses RLS). The superadmin then views
// the captures in-app via signed URLs.
//
// Deploy notes (see wfh-agent/README.md):
//   * set verify_jwt = false for this function (no user JWT is sent)
//   * supabase secrets set WFH_INGEST_TOKEN=<long-random-string>
//
// Request (POST, application/json):
//   {
//     "device_id": "demo-laptop-01",
//     "employee_id": "demo-user-01",
//     "captures": [
//       { "captured_at": "2026-11-06T09:30:00Z", "display_no": 1,
//         "app": "excel.exe", "title": "ABC 26Q.xlsx", "idle": false,
//         "sha256": "…", "bytes": 12345, "image_b64": "<base64 webp>" }
//     ]
//   }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "employee-screenshots";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function safeSeg(s: string): string {
  // keep path segments to a safe, predictable charset
  return (s || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Shared device-token auth (no user JWT from the agent).
  const expected = Deno.env.get("WFH_INGEST_TOKEN");
  const presented = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!expected || !presented || presented !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const deviceId = safeSeg(String(body?.device_id ?? ""));
  const employeeId = String(body?.employee_id ?? "").slice(0, 200);
  const captures = Array.isArray(body?.captures) ? body.captures : [];
  if (!deviceId || !employeeId || captures.length === 0) {
    return json({ error: "device_id, employee_id and captures[] are required" }, 400);
  }
  if (captures.length > 500) {
    return json({ error: "too many captures in one batch (max 500)" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let stored = 0;
  const errors: string[] = [];

  for (const c of captures) {
    try {
      const capturedAt = new Date(c.captured_at ?? Date.now());
      const ts = Math.floor(capturedAt.getTime() / 1000);
      const day = capturedAt.toISOString().slice(0, 10); // YYYY-MM-DD
      const displayNo = Number(c.display_no ?? 1) || 1;
      const path = `${deviceId}/${day}/${ts}_${displayNo}.webp`;

      const bytes = b64ToBytes(String(c.image_b64 ?? ""));
      const up = await supabase.storage.from(BUCKET).upload(path, bytes, {
        contentType: "image/webp",
        upsert: true,
      });
      if (up.error) throw up.error;

      const ins = await supabase.from("employee_screenshots").insert({
        employee_id: employeeId,
        device_id: deviceId,
        captured_at: capturedAt.toISOString(),
        display_no: displayNo,
        storage_path: path,
        app: c.app ?? null,
        title: c.title ?? null,
        idle: Boolean(c.idle),
        sha256: c.sha256 ?? null,
        bytes: Number(c.bytes ?? bytes.length) || bytes.length,
      });
      if (ins.error) throw ins.error;

      stored++;
    } catch (e) {
      errors.push(String((e as Error)?.message ?? e));
    }
  }

  return json({ stored, received: captures.length, errors });
});
