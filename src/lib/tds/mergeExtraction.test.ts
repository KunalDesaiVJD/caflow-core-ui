import { describe, it, expect } from "vitest";
import { mergeChunkReadings, dedupeQueries, planChunks, type ChunkReading } from "./mergeExtraction";
import type { AgreementExtraction, ExtractedField } from "@/components/tds/property/agreementExtraction";

/**
 * These tests encode the shape of a real registered deed: 68-202 scanned
 * pages where almost every chunk reads nothing, one chunk carries the
 * parties, another the consideration, and the Index-II page — usually last —
 * carries the stamp duty value.
 */

const f = (
  value: unknown,
  confidence: "high" | "medium" | "low" = "high",
  page: number | null = 1,
): ExtractedField => ({ value, confidence, page, snippet: "source" });

const extraction = (over: Partial<AgreementExtraction> = {}): AgreementExtraction => ({
  document_kind: "sale_agreement",
  document_kind_confidence: "high",
  fields: {},
  queries: [],
  extraction_status: "extracted",
  ...over,
});

/** A chunk that read nothing — the common case on an annexure or map page. */
const empty = (fromPage: number, toPage: number): ChunkReading => ({
  fromPage,
  toPage,
  extraction: extraction({
    document_kind: "other",
    document_kind_confidence: "low",
    fields: {
      total_sale_consideration: f(null, "low", null),
      buyers: f([], "low", null),
    },
  }),
});

describe("planChunks", () => {
  it("covers every page with no gaps and no overlaps", () => {
    const plan = planChunks(202, 12);
    expect(plan[0]).toEqual({ fromPage: 1, toPage: 12 });
    expect(plan[plan.length - 1].toPage).toBe(202);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].fromPage).toBe(plan[i - 1].toPage + 1);
    }
    expect(plan).toHaveLength(17);
  });

  it("handles a document shorter than one chunk", () => {
    expect(planChunks(3, 12)).toEqual([{ fromPage: 1, toPage: 3 }]);
  });

  it("returns nothing for a document with no pages", () => {
    expect(planChunks(0, 12)).toEqual([]);
    expect(planChunks(10, 0)).toEqual([]);
  });
});

describe("mergeChunkReadings — one answer from many page ranges", () => {
  it("takes each fact from whichever chunk actually found it", () => {
    const merged = mergeChunkReadings([
      empty(1, 12),
      {
        fromPage: 13,
        toPage: 24,
        extraction: extraction({
          fields: {
            buyers: f([{ name: "Buyer One", pan: "ADFPB0000E", share_pct: 100 }], "high", 14),
            total_sale_consideration: f(25600000, "high", 15),
          },
        }),
      },
      empty(25, 36),
      {
        // Index-II, last page — the only place the jantri value appears.
        fromPage: 193,
        toPage: 202,
        extraction: extraction({
          document_kind: "index_ii",
          fields: { total_stamp_duty_value: f(28000000, "high", 201) },
        }),
      },
    ]);

    expect(merged.extraction_status).toBe("extracted");
    expect(merged.fields.total_sale_consideration?.value).toBe(25600000);
    expect(merged.fields.total_stamp_duty_value?.value).toBe(28000000);
    expect((merged.fields.buyers?.value as unknown[]).length).toBe(1);
  });

  it("never lets an empty reading displace a real one", () => {
    // The failure this guards: 16 chunks return null for the consideration
    // and one returns the figure. Last-write-wins would produce a deal with
    // no consideration, which computes no tax at all.
    const merged = mergeChunkReadings([
      {
        fromPage: 1,
        toPage: 12,
        extraction: extraction({ fields: { total_sale_consideration: f(25600000, "high", 5) } }),
      },
      empty(13, 24),
      empty(25, 36),
      empty(37, 48),
    ]);
    expect(merged.fields.total_sale_consideration?.value).toBe(25600000);
  });

  it("prefers the higher-confidence reading", () => {
    const merged = mergeChunkReadings([
      { fromPage: 1, toPage: 12, extraction: extraction({ fields: { total_sale_consideration: f(9999999, "low", 3) } }) },
      { fromPage: 13, toPage: 24, extraction: extraction({ fields: { total_sale_consideration: f(25600000, "high", 20) } }) },
    ]);
    expect(merged.fields.total_sale_consideration?.value).toBe(25600000);
  });

  it("breaks a confidence tie on the earlier page", () => {
    // The operative recital precedes the annexures that restate it.
    const merged = mergeChunkReadings([
      { fromPage: 60, toPage: 72, extraction: extraction({ fields: { date_of_agreement: f("2026-09-09", "high", 65) } }) },
      { fromPage: 1, toPage: 12, extraction: extraction({ fields: { date_of_agreement: f("2026-09-02", "high", 4) } }) },
    ]);
    expect(merged.fields.date_of_agreement?.value).toBe("2026-09-02");
  });

  it("gives the same answer whatever order the chunks finish in", () => {
    // Chunks are processed concurrently and land out of order.
    const chunks: ChunkReading[] = [
      empty(1, 12),
      { fromPage: 13, toPage: 24, extraction: extraction({ fields: { total_sale_consideration: f(25600000, "high", 15) } }) },
      { fromPage: 25, toPage: 36, extraction: extraction({ fields: { total_stamp_duty_value: f(28000000, "medium", 30) } }) },
      empty(37, 48),
    ];
    const forward = mergeChunkReadings(chunks);
    const backward = mergeChunkReadings([...chunks].reverse());
    expect(backward).toEqual(forward);
  });
});

describe("list fields are taken whole, never unioned", () => {
  it("keeps one chunk's sellers rather than concatenating duplicates", () => {
    // The same two sellers appear on the recital page and again on the
    // signature page. Unioning them would list four sellers, and each
    // seller's 50% share would be applied to a duplicate row — halving the
    // tax attributed to each real seller while doubling the row count.
    const two = [
      { name: "Seller One", pan: "ANRPP0000R", share_pct: 50 },
      { name: "Seller Two", pan: "CBNPM0000M", share_pct: 50 },
    ];
    const merged = mergeChunkReadings([
      { fromPage: 1, toPage: 12, extraction: extraction({ fields: { sellers: f(two, "high", 6) } }) },
      { fromPage: 85, toPage: 96, extraction: extraction({ fields: { sellers: f(two, "high", 90) } }) },
    ]);
    expect((merged.fields.sellers?.value as unknown[])).toHaveLength(2);
  });

  it("prefers the fuller list at equal confidence", () => {
    const merged = mergeChunkReadings([
      {
        fromPage: 85,
        toPage: 96,
        extraction: extraction({ fields: { buyers: f([{ name: "Buyer One" }], "high", 90) } }),
      },
      {
        fromPage: 1,
        toPage: 12,
        extraction: extraction({
          fields: { buyers: f([{ name: "Buyer One" }, { name: "Buyer Two" }], "high", 6) },
        }),
      },
    ]);
    expect((merged.fields.buyers?.value as unknown[])).toHaveLength(2);
  });

  it("still lets confidence beat length", () => {
    const merged = mergeChunkReadings([
      { fromPage: 1, toPage: 12, extraction: extraction({ fields: { buyers: f([{ name: "A" }, { name: "B" }, { name: "C" }], "low", 6) } }) },
      { fromPage: 13, toPage: 24, extraction: extraction({ fields: { buyers: f([{ name: "Real One" }], "high", 20) } }) },
    ]);
    expect((merged.fields.buyers?.value as { name: string }[])[0].name).toBe("Real One");
  });
});

describe("document kind across chunks", () => {
  it("is a sale agreement if any chunk read one, whatever the annexures look like", () => {
    const merged = mergeChunkReadings([
      empty(1, 12),
      { fromPage: 13, toPage: 24, extraction: extraction({ document_kind: "sale_agreement", fields: { property_type: f("LAND") } }) },
      empty(25, 36),
    ]);
    expect(merged.document_kind).toBe("sale_agreement");
  });

  it("reports index_ii when that is the most specific thing found", () => {
    const merged = mergeChunkReadings([
      { fromPage: 1, toPage: 4, extraction: extraction({ document_kind: "index_ii", fields: { total_stamp_duty_value: f(28000000) } }) },
    ]);
    expect(merged.document_kind).toBe("index_ii");
  });
});

describe("when nothing could be read", () => {
  it("reports a failure rather than an empty success", () => {
    // An empty success is indistinguishable on screen from a below-threshold
    // deal, which is the whole failure mode this module exists to avoid.
    const merged = mergeChunkReadings([
      { fromPage: 1, toPage: 12, extraction: extraction({ extraction_status: "failed", error: "Provider timed out." }) },
      { fromPage: 13, toPage: 24, extraction: extraction({ extraction_status: "failed", error: "Provider timed out." }) },
    ]);
    expect(merged.extraction_status).toBe("failed");
    expect(merged.error).toBe("Provider timed out.");
  });

  it("reports not-a-property-document when chunks read fine but found nothing", () => {
    const merged = mergeChunkReadings([
      { fromPage: 1, toPage: 12, extraction: extraction({ extraction_status: "not_a_property_document", document_kind: "other" }) },
    ]);
    expect(merged.extraction_status).toBe("not_a_property_document");
  });

  it("keeps the questions raised even when every chunk failed", () => {
    const merged = mergeChunkReadings([
      {
        fromPage: 1,
        toPage: 12,
        extraction: extraction({
          extraction_status: "failed",
          error: "bad scan",
          queries: [{ field: "total_sale_consideration", question: "Unreadable figure?", why: "needed", blocking: true }],
        }),
      },
    ]);
    expect(merged.queries).toHaveLength(1);
  });
});

describe("dedupeQueries", () => {
  const q = (field: string, question: string, blocking = false) => ({ field, question, why: "w", blocking });

  it("collapses the same question asked by several chunks", () => {
    const out = dedupeQueries([
      q("total_stamp_duty_value", "What is the jantri value?"),
      q("total_stamp_duty_value", "what is the JANTRI value?  "),
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps genuinely different questions", () => {
    const out = dedupeQueries([
      q("total_stamp_duty_value", "What is the jantri value?"),
      q("buyers", "Which buyer is filing?"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("makes blocking sticky — one chunk blocking blocks the merged reading", () => {
    const out = dedupeQueries([
      q("total_sale_consideration", "Figures disagree?", false),
      q("total_sale_consideration", "Figures disagree?", true),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].blocking).toBe(true);
  });
});
