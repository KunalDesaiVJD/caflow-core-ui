-- Add custom_content JSONB column to nce_letters
-- Stores per-paragraph text overrides for NCE Client Certificate and Management Letter.
-- NULL means "use application defaults"; set fields override specific paragraphs.

ALTER TABLE nce_letters
  ADD COLUMN IF NOT EXISTS custom_content jsonb;

COMMENT ON COLUMN nce_letters.custom_content IS
  'JSON map of overridden paragraph text for NCE letters.
   Client Certificate keys: para3..para9, closingLine.
   Management Letter keys: bodyPara, confirmLine.';
