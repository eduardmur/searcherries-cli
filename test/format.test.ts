import { describe, expect, it } from "vitest";
import { cell, createStyle, genericTable, label, table } from "../src/render/format.js";
import { cliCallFor, withLinks } from "../src/render/renderers.js";

const plain = { style: createStyle(false), width: Number.POSITIVE_INFINITY };

describe("cell", () => {
  it("formats values by their key", () => {
    expect(cell("ctr", 0.0251)).toBe("2.5%");
    expect(cell("current_ctr", 0.04)).toBe("4%");
    expect(cell("visibility_percentage", 65.63)).toBe("65.6%");
    expect(cell("position", 4.66)).toBe("4.7");
    expect(cell("impressions", 4910)).toBe("4,910");
    expect(cell("anything", null)).toBe("–");
    expect(cell("platforms", ["chatgpt", "perplexity"])).toBe("chatgpt, perplexity");
    expect(cell("platforms", [])).toBe("–");
    expect(cell("platforms", { chatgpt: 12 })).toBe("chatgpt 12");
    expect(cell("flag", true)).toBe("yes");
  });

  it("writes headers with the usual acronyms", () => {
    expect(label("high_impression_low_ctr_queries")).toBe("High impression low CTR queries");
  });
});

describe("table", () => {
  const rows = [{ name: "a very long question that does not fit anywhere", count: 12000 }];
  const columns = [
    { header: "Question", value: (row: (typeof rows)[number]) => row.name, flex: true },
    {
      header: "Count",
      value: (row: (typeof rows)[number]) => cell("count", row.count),
      align: "right" as const,
    },
  ];

  it("shrinks flexible columns with an ellipsis to fit the width", () => {
    const lines = table(rows, columns, { ...plain, width: 30 });
    expect(lines.every((line) => line.length <= 30)).toBe(true);
    expect(lines[1]).toContain("…");
    expect(lines[1]).toMatch(/12,000$/);
  });

  it("keeps everything when piped", () => {
    expect(table(rows, columns, plain)[1]).toContain(rows[0]?.name);
  });

  it("leaves out trailing columns of unknown rows when the terminal is narrow", () => {
    const wide = [
      { query: "q", a_long_metric_name: 1, another_long_metric: 2, third_long_metric: 3 },
    ];
    const lines = genericTable(wide, { ...plain, width: 40 });
    expect(lines[0]).toContain("Query");
    expect(lines.at(-1)).toMatch(/more columns? not shown; --json prints every field\./);
    expect(genericTable(wide, plain)).toHaveLength(2);
  });
});

describe("plan helpers", () => {
  it("puts URLs in place of the link fields the API names", () => {
    expect(withLinks("Connect it at connect_url.", { connect_url: "https://x/connect" })).toEqual({
      text: "Connect it at https://x/connect.",
      linked: true,
    });
    expect(withLinks("Nothing to link.", {})).toEqual({ text: "Nothing to link.", linked: false });
  });

  it("shows API links as searcherries api calls", () => {
    expect(
      cliCallFor(
        "https://app.searcherries.com/api/v1/projects/1/answers?limit=5",
        "https://app.searcherries.com/api/v1",
      ),
    ).toBe("searcherries api '/projects/1/answers?limit=5'");
  });
});
