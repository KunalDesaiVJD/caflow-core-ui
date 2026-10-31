import { describe, it, expect } from "vitest";
import { decodeHtmlEntities } from "./htmlEntities";

describe("decodeHtmlEntities", () => {
  it("decodes the entities eOffice sends", () => {
    expect(decodeHtmlEntities("V J DESAI &amp; CO LLP")).toBe("V J DESAI & CO LLP");
    expect(decodeHtmlEntities("A &lt;B&gt; &quot;C&quot; D&#39;S")).toBe('A <B> "C" D\'S');
    expect(decodeHtmlEntities("X &#x26; Y")).toBe("X & Y");
  });
  it("handles double escaping and leaves plain text alone", () => {
    expect(decodeHtmlEntities("A &amp;amp; B")).toBe("A & B");
    expect(decodeHtmlEntities("R&D & Co")).toBe("R&D & Co");
    expect(decodeHtmlEntities("AT&T;")).toBe("AT&T;");
  });
  it("drops control-character entities and handles empty input", () => {
    expect(decodeHtmlEntities("&#4;Primary")).toBe("Primary");
    expect(decodeHtmlEntities(null)).toBe("");
  });
});
