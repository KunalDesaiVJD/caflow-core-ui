import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://hubyywmodekfdzhwiumb.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1Ynl5d21vZGVrZmR6aHdpdW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODkyNzgsImV4cCI6MjA4ODM2NTI3OH0.M6UQcpMLCCFja9TdeJpxawUvKhso38BmMGFJi6lLbrc"
);

// Check engagements
console.log("=== audit_engagements ===");
const { data: engs, error: e1 } = await sb.from("audit_engagements").select("*").limit(5);
if (e1) console.log("Error:", e1.message);
else if (engs?.length) {
  console.log("Columns:", Object.keys(engs[0]).join(", "));
  for (const e of engs) {
    // Print just identifying fields
    const vals = {};
    for (const k of Object.keys(e)) {
      if (typeof e[k] === "string" && e[k].length < 200) vals[k] = e[k];
      else if (typeof e[k] !== "object") vals[k] = e[k];
    }
    console.log(JSON.stringify(vals));
  }
} else console.log("No engagements or empty");

// Check clients
console.log("\n=== clients ===");
const { data: cls, error: e2 } = await sb.from("clients").select("*").limit(5);
if (e2) console.log("Error:", e2.message);
else if (cls?.length) {
  console.log("Columns:", Object.keys(cls[0]).join(", "));
  for (const c of cls) console.log(JSON.stringify(c));
} else console.log("No clients or empty");

// Check profiles (sometimes client names are in user profiles)
console.log("\n=== profiles ===");
const { data: profs, error: e3 } = await sb.from("profiles").select("*").limit(3);
if (e3) console.log("Error:", e3.message);
else if (profs?.length) {
  console.log("Columns:", Object.keys(profs[0]).join(", "));
} else console.log("No profiles or empty");
