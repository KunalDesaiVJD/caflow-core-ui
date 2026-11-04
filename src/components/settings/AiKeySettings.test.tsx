import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AiKeySettings from "./AiKeySettings";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jwt-admin" } } }) } },
}));
// useToast's toast is a stable module function in the app; keep it stable here too.
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const KEY = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123a1b2";
let saved: { masked: string; saved_by: string; saved_at: string } | null;
const sentBodies: Record<string, unknown>[] = [];

beforeEach(() => {
  saved = null;
  sentBodies.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sentBodies.push(body);
    const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
    switch (body.action) {
      case "status":
        return ok({ active: saved ? "ui" : "env", ui: saved, env_configured: true, model: "claude-sonnet-4-5" });
      case "save":
        saved = { masked: "sk-ant-…a1b2", saved_by: "Meet Admin", saved_at: "2026-11-04T13:00:00Z" };
        return ok({ ok: true, ...saved });
      case "test":
        return ok({ ok: true, source: saved ? "ui" : "env", model: "claude-sonnet-4-5" });
      case "remove":
        saved = null;
        return ok({ ok: true, active: "env" });
    }
    return new Response("{}", { status: 400 });
  }));
});

describe("AiKeySettings", () => {
  it("saves the key once, then shows only the masked value; test and remove work", async () => {
    render(<AiKeySettings />);
    expect(await screen.findByText("Vercel ANTHROPIC_API_KEY")).toBeInTheDocument();

    const input = screen.getByLabelText("API key") as HTMLInputElement;
    expect(input.type).toBe("password");

    const saveBtn = screen.getByRole("button", { name: /save/i });
    fireEvent.change(input, { target: { value: "sk-proj-not-anthropic" } });
    expect(screen.getByText(/starts with sk-ant-/)).toBeInTheDocument();
    expect(saveBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: KEY } });
    fireEvent.click(saveBtn);
    expect(await screen.findByText("sk-ant-…a1b2")).toBeInTheDocument();
    expect(screen.getByText("Key saved here")).toBeInTheDocument();
    expect(screen.getByText(/by Meet Admin/)).toBeInTheDocument();
    expect((screen.getByLabelText("Replace API key") as HTMLInputElement).value).toBe("");
    // The key left the browser exactly once, in the save call, and is not on the page.
    expect(sentBodies.filter((b) => JSON.stringify(b).includes(KEY))).toHaveLength(1);
    expect(document.body.innerHTML).not.toContain(KEY);

    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    expect(await screen.findByText(/OK — Claude answered/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByText("Vercel ANTHROPIC_API_KEY")).toBeInTheDocument());
    expect(screen.queryByText("sk-ant-…a1b2")).not.toBeInTheDocument();
  });
});
