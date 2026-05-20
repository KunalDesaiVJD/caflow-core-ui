const fs = require("fs");
const path = require("path");
const docxFile = "C:\\Users\\kvdes\\Desktop\\New folder (2)\\ISSUE IN FS.docx";
const buf = fs.readFileSync(docxFile);
const JSZip = require(path.join(process.cwd(), "node_modules", "jszip"));
JSZip.loadAsync(buf).then(z => z.file("word/document.xml").async("string")).then(xml => {
  // Convert paragraphs with line breaks
  const cleaned = xml
    .replace(/<w:p[^>]*\/>/g, "\n")
    .replace(/<w:p[^>]*>/g, "")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x2019;/g, "'")
    .replace(/&#x201[CD];/g, '"')
    .replace(/[ \t]+\n/g, "\n");
  console.log(cleaned);
});
