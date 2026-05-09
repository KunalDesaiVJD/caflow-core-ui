/**
 * useAiSkills — reads approved AI skills from audit_ai_skills table.
 *
 * Returns skills grouped by action_type so callers can pull relevant
 * examples before making AI calls. Also provides `recordUsed()` to
 * increment applied_count + update last_used_at for each skill used.
 *
 * Usage:
 *   const { skillsFor, recordUsed } = useAiSkills();
 *   const examples = skillsFor("coa_remap");   // ← for COA mapping
 *   const caroEx  = skillsFor("caro_clause_approve");
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AiSkill = {
  id: string;
  action_type: string;
  pattern_name: string | null;
  example_before: string | null;
  example_after: string | null;
  action_count: number;
  firms_affected: number;
  applied_count: number;
  last_used_at: string | null;
};

let _cache: AiSkill[] | null = null;
let _cacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

export function useAiSkills() {
  const [skills, setSkills] = useState<AiSkill[]>(_cache ?? []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    const now = Date.now();
    if (_cache && now - _cacheAt < CACHE_TTL) {
      setSkills(_cache);
      setLoading(false);
      return;
    }
    supabase
      .from("audit_ai_skills")
      .select("id, action_type, pattern_name, example_before, example_after, action_count, firms_affected, applied_count, last_used_at")
      .eq("active", true)
      .order("action_count", { ascending: false })
      .then(({ data }) => {
        const rows = (data as AiSkill[]) ?? [];
        _cache = rows;
        _cacheAt = Date.now();
        setSkills(rows);
        setLoading(false);
      });
  }, []);

  /** Returns all active skills matching a given action_type */
  const skillsFor = useCallback(
    (actionType: string): AiSkill[] =>
      skills.filter(s => s.action_type === actionType),
    [skills],
  );

  /**
   * Returns skill examples formatted for injection into Claude prompts.
   * Format: [{ before: string, after: string }]
   * Only returns skills that have both example_before and example_after.
   */
  const examplesFor = useCallback(
    (actionType: string): { id: string; before: string; after: string }[] =>
      skills
        .filter(s => s.action_type === actionType && s.example_before && s.example_after)
        .map(s => ({ id: s.id, before: s.example_before!, after: s.example_after! })),
    [skills],
  );

  /**
   * Record that a skill was applied — increments applied_count + sets last_used_at.
   * Fire-and-forget: never awaited by callers.
   */
  const recordUsed = useCallback((skillIds: string[]) => {
    if (!skillIds.length) return;
    const now = new Date().toISOString();
    for (const id of skillIds) {
      // Optimistic local update
      setSkills(prev =>
        prev.map(s =>
          s.id === id
            ? { ...s, applied_count: s.applied_count + 1, last_used_at: now }
            : s,
        ),
      );
      // Persist: read current count then increment (simple approach without RPC)
      supabase
        .from("audit_ai_skills")
        .select("applied_count")
        .eq("id", id)
        .maybeSingle()
        .then(({ data }) => {
          const current = (data as any)?.applied_count ?? 0;
          supabase
            .from("audit_ai_skills")
            .update({ applied_count: current + 1, last_used_at: now } as any)
            .eq("id", id)
            .then(() => {});
        });
    }
    // Bust cache so next load reflects real counts
    _cache = null;
  }, []);

  return { skills, loading, skillsFor, examplesFor, recordUsed };
}
