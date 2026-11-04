// Old address of the AI gateway. Supabase edge functions still point
// CLAUDE_CLI_GATEWAY_URL here, so it now serves the direct Claude API
// handler in ./claude.ts — no secret change needed after the switch.
export const maxDuration = 300;
export { default } from "./claude";
