-- 26 client names (and 7 addresses) were stored HTML-escaped by the eOffice
-- customer sync, e.g. "V J DESAI &amp; CO LLP". Store the plain text. The sync
-- now decodes on import (src/lib/htmlEntities.ts), so it won't come back.
-- No decoded name clashes with another client of the same firm (checked 31-Oct).
CREATE OR REPLACE FUNCTION pg_temp.decode_entities(s text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace(replace(replace(s,
    '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&apos;', ''''), '&amp;', '&')
$$;

UPDATE public.clients
SET name = pg_temp.decode_entities(name)
WHERE name ~ '&(amp|lt|gt|quot|apos|#39);';

UPDATE public.clients
SET address = pg_temp.decode_entities(address)
WHERE address ~ '&(amp|lt|gt|quot|apos|#39);';
