"use strict";
const { test, expect } = require("@playwright/test");
const { zipSync, strToU8 } = require("fflate");
const { mountLibrary } = require("./library-fixture.cjs");

function officeZip(entries) {
  return zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([key, value]) => [key, strToU8(value)]),
    ),
  );
}
const rels =
  'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const word = officeZip({
  "[Content_Types].xml":
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  "_rels/.rels": `<Relationships ${rels}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  "word/document.xml":
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Document fixture</w:t></w:r></w:p></w:body></w:document>',
});
const workbook = officeZip({
  "xl/workbook.xml":
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels": `<Relationships ${rels}><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  "xl/worksheets/sheet1.xml":
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Revenue</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>',
});
const slides = officeZip({
  "ppt/slides/slide1.xml":
    '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>Presentation fixture</a:t></a:r></a:p></p:sld>',
  "ppt/slides/_rels/slide1.xml.rels": `<Relationships ${rels}><Relationship Id="img1" Type="urn:image/image" TargetMode="External" Target="https://blocked.test/private.png"/></Relationships>`,
});
function pdf() {
  const stream = "BT /F1 18 Tf 40 100 Td (PDF fixture) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let text = "%PDF-1.4\n",
    offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = text.length;
  text += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(text);
}
for (const [extension, category, bytes, expected] of [
  ["docx", "documents", word, "Document fixture"],
  ["xlsx", "spreadsheets", workbook, "Revenue"],
  ["pptx", "presentations", slides, "Presentation fixture"],
  ["pdf", "pdf", pdf(), "PDF fixture"],
  [
    "csv",
    "spreadsheets",
    Buffer.from('name,value\r\n"quoted, cell",42'),
    "quoted, cell",
  ],
  [
    "md",
    "documents",
    Buffer.from(
      '# Markdown fixture\n\n<script>parent.hacked=true</script><img src=x onerror="parent.hacked=true">',
    ),
    "Markdown fixture",
  ],
])
  test(`real sandboxed ${extension} preview renders with its shipped parser`, async ({
    page,
  }) => {
    const fixture = await mountLibrary(page, [{ extension, category, bytes }]);
    expect(fixture.requests).not.toContain("viewerBundle");
    await page.getByTitle(`sample-0.${extension}`, { exact: true }).click();
    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#preview")).toContainText(expected);
    await expect(page.locator(".agpa-library-preview-status")).toHaveCount(0);
    expect(await page.evaluate(() => window.hacked)).toBeUndefined();
    expect(
      await frame.locator("body").evaluate(() => {
        try {
          return parent.document.title;
        } catch {
          return "isolated";
        }
      }),
    ).toBe("isolated");
    expect(
      fixture.requests.filter((action) => action === "viewerBundle"),
    ).toHaveLength(1);
  });

test("oversized or malformed archives fail without allocating their declared expansion", async ({
  page,
}) => {
  const large = officeZip({ "word/document.xml": "small" });
  const view = new DataView(large.buffer, large.byteOffset, large.byteLength);
  for (let index = 0; index < large.length - 46; index++)
    if (view.getUint32(index, true) === 0x02014b50) {
      view.setUint32(index + 24, 0x7fffffff, true);
      break;
    }
  await mountLibrary(page, [
    { extension: "docx", category: "documents", bytes: large },
    {
      extension: "xlsx",
      category: "spreadsheets",
      bytes: Buffer.from("not a zip"),
    },
  ]);
  for (const name of ["sample-0.docx", "sample-1.xlsx"]) {
    await page.getByTitle(name, { exact: true }).click();
    await expect(page.frameLocator("iframe").locator("#preview")).toContainText(
      /too large|unavailable/i,
    );
    await page.locator(".agpa-library-preview header button").first().click();
  }
});
test("3D preview renders locally and rejects external glTF dependencies", async ({
  page,
}) => {
  const fixture = await mountLibrary(page, [
    {
      extension: "obj",
      category: "models",
      bytes: Buffer.from("v -1 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"),
    },
    {
      extension: "gltf",
      category: "models",
      bytes: Buffer.from(
        JSON.stringify({
          asset: { version: "2.0" },
          scene: 0,
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
          accessors: [
            {
              bufferView: 0,
              componentType: 5126,
              count: 3,
              type: "VEC3",
              min: [-1, 0, 0],
              max: [1, 1, 0],
            },
          ],
          bufferViews: [{ buffer: 0, byteLength: 36 }],
          buffers: [
            { uri: "https://blocked.test/vertices.bin", byteLength: 36 },
          ],
        }),
      ),
    },
  ]);
  await page.getByTitle("sample-0.obj", { exact: true }).click();
  await expect(page.frameLocator("iframe").locator("canvas")).toBeVisible();
  await expect(page.locator(".agpa-library-preview-status")).toHaveCount(0);
  await page.locator(".agpa-library-preview header button").first().click();
  await page.getByTitle("sample-1.gltf", { exact: true }).click();
  await expect(page.frameLocator("iframe").locator("#preview")).toContainText(
    "external",
  );
  expect(fixture.network).toEqual([]);
});
test("HTML does not load the parser bundle and failed reads can retry", async ({
  page,
}) => {
  const fixture = await mountLibrary(
    page,
    [
      {
        extension: "html",
        category: "interactive",
        bytes: Buffer.from("<h1>Interactive fixture</h1>"),
      },
      {
        extension: "md",
        category: "documents",
        bytes: Buffer.from("# Retried fixture"),
      },
    ],
    { failBundleOnce: true },
  );
  await page.getByTitle("sample-0.html", { exact: true }).click();
  await expect(page.frameLocator("iframe").locator("h1")).toHaveText(
    "Interactive fixture",
  );
  expect(fixture.requests).not.toContain("viewerBundle");
  await page.locator(".agpa-library-preview header button").first().click();
  await page.getByTitle("sample-1.md", { exact: true }).click();
  await expect(page.locator(".agpa-library-preview-status")).toContainText(
    "unavailable",
  );
  await page.locator(".agpa-library-preview header button").first().click();
  await page.getByTitle("sample-1.md", { exact: true }).click();
  await expect(page.frameLocator("iframe").locator("h1")).toHaveText(
    "Retried fixture",
  );
  expect(
    fixture.requests.filter((action) => action === "viewerBundle"),
  ).toHaveLength(2);
});
test("disabling Library during a bundle request cannot resurrect its preview", async ({
  page,
}) => {
  const fixture = await mountLibrary(
    page,
    [
      {
        extension: "md",
        category: "documents",
        bytes: Buffer.from("# Late fixture"),
      },
    ],
    { delayBundle: true },
  );
  await page.getByTitle("sample-0.md", { exact: true }).click();
  await expect.poll(() => fixture.requests.includes("viewerBundle")).toBe(true);
  await page.evaluate(() => __AGLibrary.setEnabled(false));
  fixture.release();
  await expect(page.locator(".agpa-library-preview")).toHaveCount(0);
  await expect(page.locator("[data-agpa-library]")).toBeHidden();
});
test("CSV bounds rows and columns while preserving quoted delimiters and newlines", async ({
  page,
}) => {
  const text =
    '"first, cell","two\r\nlines","a""b"\n' +
    Array.from({ length: 1005 }, () =>
      Array.from({ length: 150 }, (_, i) => `cell${i}`).join(","),
    ).join("\n");
  await mountLibrary(page, [
    { extension: "csv", category: "spreadsheets", bytes: Buffer.from(text) },
  ]);
  await page.getByTitle("sample-0.csv", { exact: true }).click();
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("tr")).toHaveCount(1000);
  await expect(frame.locator("tr").nth(1).locator("td")).toHaveCount(100);
  await expect(frame.locator("tr").first().locator("td")).toHaveText([
    "first, cell",
    "two\r\nlines",
    'a"b',
  ]);
});
test("HTML retains one-click online resources without an extra dialog", async ({
  page,
}) => {
  const html =
    '<h1>Online fixture</h1><script>try{parent.document.body.dataset.leak="yes"}catch{};fetch("https://blocked.test/data").catch(()=>{})</script>';
  const fixture = await mountLibrary(page, [
    { extension: "html", category: "interactive", bytes: Buffer.from(html) },
  ]);
  await page.getByTitle("sample-0.html", { exact: true }).click();
  await expect(page.frameLocator("iframe").locator("h1")).toHaveText(
    "Online fixture",
  );
  expect(fixture.network).toEqual([]);
  const grant = page
    .locator(".agpa-library-preview header")
    .getByRole("button", { name: "Allow online resources", exact: true });
  await grant.click();
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect
    .poll(() => fixture.network)
    .toContain("https://blocked.test/data");
  expect(await page.evaluate(() => document.body.dataset.leak)).toBeUndefined();
  await page.locator(".agpa-library-preview header button").first().click();
  await page.getByTitle("sample-0.html", { exact: true }).click();
  await expect(grant).toBeVisible();
});
