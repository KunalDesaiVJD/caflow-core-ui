-- ─────────────────────────────────────────────────────────────────────────────
-- Configurable section-mapping table for Stage-1 Validate & Finalise recon.
--
-- Client import files often express the nature of payment as a descriptive label
-- ("TDS - Contract", "Professional Fees", "Purchase of Goods") instead of (or
-- alongside) the statutory TDS section code (194C, 194J, 194Q…). Comparing that
-- raw text against the office section code produces false "Section Mismatch"es.
--
-- This table maps a lowercased keyword/substring (found anywhere in the raw
-- section text) to a canonical section code. The deterministic recon engine
-- (tds-recon-compare) loads GLOBAL rows (firm_id IS NULL, seeded below) plus any
-- firm-specific overrides, and canonicalises BOTH sides before comparing — so
-- "TDS - Contract" and "194C" match, while "194Q" and "194C" correctly differ.
--
-- Substring/keyword matching (not exact value) is deliberate: it is robust to
-- the messy, inconsistent phrasing real client files use. Rows are applied in
-- ascending `priority` (most specific first, e.g. "sub contract" before
-- "contract"). Firms can add their own rows to teach the engine new phrasings
-- without a code change. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tds_section_aliases (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      uuid,                              -- NULL = global default (all firms)
  pattern      text        NOT NULL,              -- lowercased keyword/substring to look for
  section_code text        NOT NULL,              -- canonical code, e.g. '194C'
  priority     integer     NOT NULL DEFAULT 100,  -- lower = checked first (specific before generic)
  note         text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- One row per (firm, pattern); the sentinel UUID stands in for the global NULL so
-- a UNIQUE index can dedupe globals too (NULLs are otherwise never equal).
CREATE UNIQUE INDEX IF NOT EXISTS tds_section_aliases_firm_pattern
  ON public.tds_section_aliases (COALESCE(firm_id, '00000000-0000-0000-0000-000000000000'::uuid), pattern);
CREATE INDEX IF NOT EXISTS tds_section_aliases_firm ON public.tds_section_aliases (firm_id);

-- ── RLS: read globals + own firm; write own firm only ────────────────────────
ALTER TABLE public.tds_section_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_section_aliases" ON public.tds_section_aliases;
CREATE POLICY "service_role_all_section_aliases" ON public.tds_section_aliases
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_read_section_aliases" ON public.tds_section_aliases;
CREATE POLICY "auth_read_section_aliases" ON public.tds_section_aliases FOR SELECT TO authenticated
  USING (firm_id IS NULL OR firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "auth_write_section_aliases" ON public.tds_section_aliases;
CREATE POLICY "auth_write_section_aliases" ON public.tds_section_aliases FOR ALL TO authenticated
  USING      (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (firm_id = (SELECT firm_id FROM public.users WHERE id = auth.uid()));

DROP TRIGGER IF EXISTS tds_section_aliases_updated_at ON public.tds_section_aliases;
CREATE TRIGGER tds_section_aliases_updated_at BEFORE UPDATE ON public.tds_section_aliases
  FOR EACH ROW EXECUTE FUNCTION public.tds_set_updated_at();

-- ── Seed comprehensive GLOBAL defaults (firm_id IS NULL) ──────────────────────
-- Keyword → canonical section code. Multi-word / more-specific patterns get a
-- lower priority number so they win over generic single words.
INSERT INTO public.tds_section_aliases (firm_id, pattern, section_code, priority, note) VALUES
  -- 192 Salary
  (NULL, 'salary',                 '192',  20, 'Salary'),
  -- 194 Dividend
  (NULL, 'dividend',               '194',  20, 'Dividend'),
  -- 194A Interest (other than securities)
  (NULL, 'interest other than',    '194A', 10, 'Interest other than securities'),
  (NULL, 'interest on',            '194A', 15, 'Interest on deposits/loans'),
  (NULL, 'interest',               '194A', 60, 'Interest (generic)'),
  -- 194C Contract / sub-contract / advertising
  (NULL, 'sub contract',           '194C', 10, 'Sub-contract'),
  (NULL, 'sub-contract',           '194C', 10, 'Sub-contract'),
  (NULL, 'subcontract',            '194C', 10, 'Sub-contract'),
  (NULL, 'contractor',             '194C', 15, 'Contractor'),
  (NULL, 'contract',               '194C', 20, 'Contract'),
  (NULL, 'advertis',               '194C', 25, 'Advertising/advertisement'),
  (NULL, 'transport',              '194C', 30, 'Transport contract'),
  -- 194D Insurance commission
  (NULL, 'insurance commission',   '194D', 10, 'Insurance commission'),
  -- 194H Commission / brokerage
  (NULL, 'commission',             '194H', 25, 'Commission'),
  (NULL, 'brokerage',              '194H', 25, 'Brokerage'),
  -- 194I Rent
  (NULL, 'rent of plant',          '194I', 10, 'Rent of plant & machinery'),
  (NULL, 'rent of machinery',      '194I', 10, 'Rent of machinery'),
  (NULL, 'rent',                   '194I', 30, 'Rent'),
  -- 194J Professional / technical / royalty
  (NULL, 'professional',           '194J', 20, 'Professional fees'),
  (NULL, 'technical',              '194J', 20, 'Technical fees'),
  (NULL, 'royalty',                '194J', 20, 'Royalty'),
  -- 194Q Purchase of goods
  (NULL, 'purchase of goods',      '194Q', 10, 'Purchase of goods'),
  (NULL, 'purchase',               '194Q', 30, 'Purchase'),
  (NULL, 'goods',                  '194Q', 40, 'Goods'),
  -- 194I(a)/(b) already covered by rent; 206C TCS
  (NULL, 'tcs',                    '206C', 20, 'Tax collected at source'),
  (NULL, 'collected at source',    '206C', 15, 'Tax collected at source')
ON CONFLICT (COALESCE(firm_id, '00000000-0000-0000-0000-000000000000'::uuid), pattern) DO NOTHING;
