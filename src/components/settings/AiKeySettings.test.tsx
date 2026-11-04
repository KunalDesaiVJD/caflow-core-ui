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
const NO_CREDIT_KEY = "sk-ant-api03-NOCREDITNOCREDITNOCREDITzzzz";
const NO_CREDIT =
  "Anthropic knows this key, but its account has no API credit, so it was not saved. Add credit at console.anthropic.com › Settings › Billing (a Claude subscription does not cover the API), then paste it again.";
const MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
];

let pasted: boolean;
const sentBodies: Record<string, unknown>[] = [];

function statusBody() {
  return {
    key: pasted
      ? { source: "pasted", hint: "a1b2", savedOn: "2026-11-04T13:00:00Z", savedBy: "Meet Admin" }
      : { source: "server" },
    serverKeySet: true,
    model: "claude-sonnet-5-5",
    modelSource: "default",
    modelSavedBy: null,
    modelSavedOn: null,
    models: MODELS,
  };
}

beforeEach(() => {
  pasted = false;
  sentBodies.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sentBodies.push(body);
    const reply = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status });
    switch (body.action) {
      case "status":
        return reply(statusBody());
      case "save":
        if (body.apiKey === NO_CREDIT_KEY) return reply({ error: NO_CREDIT }, 400);
        pasted = true;
        return reply(statusBody());
      case "test":
        return reply({ ok: true, source: pasted ? "pasted" : "server", model: "claude-sonnet-5-5", reply: "The connection works." });
      case "remove":
        pasted = false;
        return reply(statusBody());
    }
    return reply({}, 400);
  }));
});

describe("AiKeySettings", () => {
  it("shows Anthropic's refusal sentence and clears the field", async () => {
    render(<AiKeySettings />);
    expect(await screen.findByText(/Key set where the app is hosted/)).toBeInTheDocument();
    const input = screen.getByLabelText("Paste key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: NO_CREDIT_KEY } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(NO_CREDIT)).toBeInTheDocument();
    expect(input.value).toBe("");
  });

  it("saves the key once, then shows only the last 4; test and remove work", async () => {
    render(<AiKeySettings />);
    expect(await screen.findByText(/Key set where the app is hosted/)).toBeInTheDocument();

    const input = screen.getByLabelText("Paste key") as HTMLInputElement;
    expect(input.type).toBe("password");

    const saveBtn = screen.getByRole("button", { name: /save/i });
    fireEvent.change(input, { target: { value: "sk-proj-not-anthropic" } });
    expect(screen.getByText(/starts with sk-ant-/)).toBeInTheDocument();
    expect(saveBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: KEY } });
    fireEvent.click(saveBtn);
    expect(await screen.findByText(/Key ending a1b2, pasted here by Meet Admin/)).toBeInTheDocument();
    expect((screen.getByLabelText("Replace key") as HTMLInputElement).value).toBe("");
    // The key left the browser exactly once, in the save call, and is not on the page.
    expect(sentBodies.filter((b) => JSON.stringify(b).includes(KEY))).toHaveLength(1);
    expect(document.body.innerHTML).not.toContain(KEY);

    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    expect(await screen.findByText(/OK — claude-sonnet-5-5 answered/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /remove key/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByText(/Key set where the app is hosted/)).toBeInTheDocument());
    expect(screen.queryByText(/Key ending a1b2/)).not.toBeInTheDocument();
  });
});
