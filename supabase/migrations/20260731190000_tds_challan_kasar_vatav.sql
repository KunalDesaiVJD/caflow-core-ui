-- ─────────────────────────────────────────────────────────────────────────────
-- TDS challan Kasar-Vatav (round-off/adjustment) closure
--
-- A challan can be left with a tiny, genuinely unrecoverable balance — ₹5,
-- ₹10, a stray ₹250 — after every real deductee entry against it has been
-- made. There's no deductee to attach that residue to, so without this the
-- challan sits "Unconsumed" and keeps re-qualifying as a Carry-Forward
-- candidate forever. Kasar-Vatav records that residue as a deliberate,
-- attributed write-off distinct from any deductee's actual TDS/interest/
-- surcharge, so the challan can be marked Fully Utilised without inventing a
-- fake deductee row to absorb it.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.tds_challans ADD COLUMN IF NOT EXISTS kasar_vatav_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.tds_challans ADD COLUMN IF NOT EXISTS kasar_vatav_note TEXT;
ALTER TABLE public.tds_challans ADD COLUMN IF NOT EXISTS kasar_vatav_by UUID;
ALTER TABLE public.tds_challans ADD COLUMN IF NOT EXISTS kasar_vatav_at TIMESTAMPTZ;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tds_challans' AND column_name = 'kasar_vatav_amount') AS has_amount,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tds_challans' AND column_name = 'kasar_vatav_note') AS has_note,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tds_challans' AND column_name = 'kasar_vatav_by') AS has_by,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tds_challans' AND column_name = 'kasar_vatav_at') AS has_at;
