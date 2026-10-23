import zlib from "zlib";

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZipArchive(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const uncompressed = file.data;
    const crc = crc32(uncompressed);
    const compressed = new Uint8Array(zlib.deflateRawSync(uncompressed));

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 8, true); // Deflate
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, compressed.length, true);
    lv.setUint32(22, uncompressed.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, compressed);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 8, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compressed.length, true);
    cv.setUint32(24, uncompressed.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  let centralSize = 0;
  for (const cp of centralParts) centralSize += cp.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalLen = offset + centralSize + 22;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of localParts) {
    out.set(p, pos);
    pos += p.length;
  }
  for (const p of centralParts) {
    out.set(p, pos);
    pos += p.length;
  }
  out.set(eocd, pos);
  return out;
}

function xmlEscape(val: unknown): string {
  return String(val ?? "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colIndexToLetter(colIdx0: number): string {
  let n = colIdx0 + 1;
  let str = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    str = String.fromCharCode(65 + rem) + str;
    n = Math.floor((n - 1) / 26);
  }
  return str;
}

interface XlsxCell {
  v: string | number;
  s?: number; // style index: 0=normal, 1=titleBanner, 2=tableHeader, 3=kpiBox, 4=highlightRow
}

function buildWorksheetXml(rows: XlsxCell[][], colWidths: number[]): string {
  const colsXml = colWidths
    .map((w, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`)
    .join("");
  const rowsXml: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    const rowCells = rows[r];
    if (!rowCells || rowCells.length === 0) continue;
    const cellsXml: string[] = [];
    for (let c = 0; c < rowCells.length; c++) {
      const cell = rowCells[c];
      if (cell === undefined || cell === null || cell.v === "") continue;
      const ref = `${colIndexToLetter(c)}${r + 1}`;
      const styleAttr = cell.s ? ` s="${cell.s}"` : "";
      if (typeof cell.v === "number" && Number.isFinite(cell.v)) {
        cellsXml.push(`<c r="${ref}"${styleAttr}><v>${cell.v}</v></c>`);
      } else {
        cellsXml.push(
          `<c r="${ref}" t="inlineStr"${styleAttr}><is><t xml:space="preserve">${xmlEscape(cell.v)}</t></is></c>`
        );
      }
    }
    const rowHeight = r === 0 ? ' ht="28" customHeight="1"' : r === 1 ? ' ht="22" customHeight="1"' : "";
    rowsXml.push(`<row r="${r + 1}"${rowHeight}>${cellsXml.join("")}</row>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${colsXml}</cols>
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

function makeBarChartText(pct: number): string {
  const filled = Math.round(Math.min(100, Math.max(0, pct)) / 8.33);
  const empty = Math.max(0, 12 - filled);
  return `${"█".repeat(filled)}${"░".repeat(empty)}  ${pct.toFixed(1)}%`;
}

function buildJobSheetRows(sheetTitle: string, jobs: any[]): XlsxCell[][] {
  const total = jobs.length;
  const newCount = jobs.filter((j) => j.is_new_job).length;
  const withSalary = jobs.filter((j) => Number(j.salary_vnd_normalized || 0) > 0);
  const maxSal = withSalary.reduce((m, j) => Math.max(m, Number(j.salary_vnd_normalized || 0)), 0);

  const bannerText = `${sheetTitle}   |   Tổng: ${total} việc làm   •   Mới: ${newCount}   •   Có lương rõ: ${withSalary.length}   •   Lương cao nhất: ${
    maxSal > 0 ? `${maxSal.toFixed(1)} Triệu VNĐ` : "Thỏa thuận"
  }`;

  const headers = [
    "STT",
    "Hạng & Điểm",
    "Vị Trí Tuyển Dụng",
    "Công Ty",
    "Kỹ Năng / Trình Độ",
    "Mức Lương Gốc",
    "Lương Quy Đổi (Tr)",
    "Phân Khúc Lương",
    "Nhóm Ngành Nghề",
    "Cấp Bậc",
    "Khu Vực",
    "Hình Thức",
    "Sàn Tuyển Dụng",
    "Email / SĐT HR",
    "Tóm Tắt Công Việc",
    "Trạng Thái CRM",
    "Link Bài Đăng Gốc",
  ];

  const rows: XlsxCell[][] = [
    [{ v: bannerText, s: 1 }],
    headers.map((h) => ({ v: h, s: 2 })),
  ];

  jobs.forEach((j, idx) => {
    const salNorm = Number(j.salary_vnd_normalized || 0);
    const tierBadge = `${j.quality_tier} (${j.quality_score}đ)`;
    const hrContact = [j.hr_email, j.hr_phone].filter(Boolean).join(" | ") || "-";
    const skillsStr = Array.isArray(j.skills) && j.skills.length > 0 ? j.skills.join(", ") : j.jlpt_level || "-";
    const rowStyle = j.quality_tier === "S-Tier" ? 4 : 0;

    rows.push([
      { v: idx + 1, s: rowStyle },
      { v: tierBadge, s: rowStyle },
      { v: j.title || "", s: rowStyle },
      { v: j.company_name || "", s: rowStyle },
      { v: skillsStr, s: rowStyle },
      { v: j.salary_raw || "Thỏa thuận", s: rowStyle },
      { v: salNorm > 0 ? Number(salNorm.toFixed(1)) : "-", s: rowStyle },
      { v: j.salary_bracket || "Thỏa thuận / Cạnh tranh", s: rowStyle },
      { v: j.job_category || "Chuyên ngành khác", s: rowStyle },
      { v: j.seniority || "Mid-Level", s: rowStyle },
      { v: j.location_city || "Vietnam", s: rowStyle },
      { v: j.work_mode || "Onsite", s: rowStyle },
      { v: j.portal_name || j.source_domain || "", s: rowStyle },
      { v: hrContact, s: rowStyle },
      { v: (j.summary || "").slice(0, 320), s: rowStyle },
      { v: j.status || "new", s: rowStyle },
      { v: j.url || "", s: rowStyle },
    ]);
  });

  return rows;
}

export function buildMultiSheetXlsxBuffer(jobs: any[]): Uint8Array {
  const total = jobs.length;
  const newJobs = jobs.filter((j) => j.is_new_job);
  const highPayJobs = jobs.filter((j) => Number(j.salary_vnd_normalized || 0) >= 25);
  const techJobs = jobs.filter((j) =>
    [
      "Công nghệ / Phần mềm",
      "IT / Phần mềm",
      "Kỹ thuật / Sản xuất",
      "BrSE (Kỹ sư cầu nối)",
      "IT Comtor",
    ].includes(j.job_category)
  );
  const remoteOrIntlJobs = jobs.filter(
    (j) =>
      j.work_mode === "Remote" ||
      j.work_mode === "Hybrid" ||
      /remote|toàn quốc|nước ngoài|international/i.test(j.location_city || "")
  );
  const withSalary = jobs.filter((j) => Number(j.salary_vnd_normalized || 0) > 0);
  const avgSalary =
    withSalary.length > 0
      ? withSalary.reduce((acc, j) => acc + Number(j.salary_vnd_normalized || 0), 0) / withSalary.length
      : 0;

  const dashRows: XlsxCell[][] = [
    [{ v: "CRAWLJOB STUDIO BI & CRM — BÁO CÁO PHÂN TÍCH DỮ LIỆU TUYỂN DỤNG ĐA SÀN", s: 1 }],
    [
      {
        v: `Cập nhật lúc: ${new Date().toLocaleString("vi-VN")}   |   Tổng số việc làm: ${total}   |   Số sàn thu thập: ${
          new Set(jobs.map((j) => j.portal_name)).size
        }`,
        s: 0,
      },
    ],
    [],
    [
      { v: "TỔNG VIỆC LÀM", s: 2 },
      { v: "VIỆC LÀM MỚI (NEW)", s: 2 },
      { v: "DEAL LƯƠNG CAO (≥25TR)", s: 2 },
      { v: "CÔNG NGHỆ / KỸ THUẬT", s: 2 },
      { v: "REMOTE / HYBRID", s: 2 },
      { v: "LƯƠNG TRUNG BÌNH", s: 2 },
    ],
    [
      { v: `${total} Jobs`, s: 3 },
      { v: `${newJobs.length} Jobs`, s: 3 },
      { v: `${highPayJobs.length} Jobs`, s: 3 },
      { v: `${techJobs.length} Jobs`, s: 3 },
      { v: `${remoteOrIntlJobs.length} Jobs`, s: 3 },
      { v: avgSalary > 0 ? `${avgSalary.toFixed(1)} Tr.VNĐ` : "Thỏa thuận", s: 3 },
    ],
    [],
    [
      { v: "CỔNG TUYỂN DỤNG", s: 2 },
      { v: "TỔNG JOB", s: 2 },
      { v: "JOB MỚI", s: 2 },
      { v: "CÓ LƯƠNG RÕ", s: 2 },
      { v: "LƯƠNG TB", s: 2 },
      { v: "TỶ TRỌNG & BIỂU ĐỒ PHÂN BỔ", s: 2 },
      { v: "", s: 0 },
      { v: "NHÓM NGÀNH NGHỀ / VAI TRÒ", s: 2 },
      { v: "SỐ LƯỢNG", s: 2 },
      { v: "JOB MỚI", s: 2 },
      { v: "LƯƠNG TB", s: 2 },
      { v: "BIỂU ĐỒ NGÀNH NGHỀ", s: 2 },
    ],
  ];

  const portalMap = new Map<string, any[]>();
  for (const j of jobs) {
    const p = j.portal_name || "Khác";
    if (!portalMap.has(p)) portalMap.set(p, []);
    portalMap.get(p)!.push(j);
  }
  const portalEntries = Array.from(portalMap.entries()).sort((a, b) => b[1].length - a[1].length);

  const catMap = new Map<string, any[]>();
  for (const j of jobs) {
    const c = j.job_category || "Chuyên ngành khác";
    if (!catMap.has(c)) catMap.set(c, []);
    catMap.get(c)!.push(j);
  }
  const catEntries = Array.from(catMap.entries()).sort((a, b) => b[1].length - a[1].length);

  const maxSideRows = Math.max(portalEntries.length, catEntries.length, 1);
  for (let i = 0; i < maxSideRows; i++) {
    const rowCells: XlsxCell[] = [];
    if (i < portalEntries.length) {
      const [pName, pJobs] = portalEntries[i];
      const pNew = pJobs.filter((j) => j.is_new_job).length;
      const pSal = pJobs.filter((j) => Number(j.salary_vnd_normalized || 0) > 0);
      const pAvg =
        pSal.length > 0
          ? `${(pSal.reduce((s, j) => s + Number(j.salary_vnd_normalized || 0), 0) / pSal.length).toFixed(1)} Tr`
          : "Thỏa thuận";
      const pct = total > 0 ? (pJobs.length / total) * 100 : 0;
      rowCells.push(
        { v: pName },
        { v: pJobs.length },
        { v: pNew },
        { v: pSal.length },
        { v: pAvg },
        { v: makeBarChartText(pct) }
      );
    } else {
      rowCells.push({ v: "" }, { v: "" }, { v: "" }, { v: "" }, { v: "" }, { v: "" });
    }

    rowCells.push({ v: "" });

    if (i < catEntries.length) {
      const [cName, cJobs] = catEntries[i];
      const cNew = cJobs.filter((j) => j.is_new_job).length;
      const cSal = cJobs.filter((j) => Number(j.salary_vnd_normalized || 0) > 0);
      const cAvg =
        cSal.length > 0
          ? `${(cSal.reduce((s, j) => s + Number(j.salary_vnd_normalized || 0), 0) / cSal.length).toFixed(1)} Tr`
          : "Thỏa thuận";
      const pct = total > 0 ? (cJobs.length / total) * 100 : 0;
      rowCells.push(
        { v: cName },
        { v: cJobs.length },
        { v: cNew },
        { v: cAvg },
        { v: makeBarChartText(pct) }
      );
    }
    dashRows.push(rowCells);
  }

  dashRows.push([]);
  dashRows.push([
    { v: "PHÂN KHÚC MỨC LƯƠNG QUY ĐỔI", s: 2 },
    { v: "SỐ JOB", s: 2 },
    { v: "JOB MỚI", s: 2 },
    { v: "ĐIỂM TIER TB", s: 2 },
    { v: "TRẠNG THÁI", s: 2 },
    { v: "TỶ TRỌNG KHUNG LƯƠNG", s: 2 },
  ]);

  const bracketOrder = [
    "Trên 35 Triệu (High-Paying)",
    "20 - 35 Triệu",
    "12 - 20 Triệu",
    "Dưới 12 Triệu",
    "Thỏa thuận / Cạnh tranh",
  ];
  for (const bName of bracketOrder) {
    const bJobs = jobs.filter((j) => j.salary_bracket === bName);
    const bNew = bJobs.filter((j) => j.is_new_job).length;
    const avgScore =
      bJobs.length > 0
        ? `${Math.round(bJobs.reduce((s, j) => s + Number(j.quality_score || 70), 0) / bJobs.length)}đ`
        : "-";
    const statusLabel = bName.includes("35") || bName.includes("20 - 35") ? "Hot Deal" : "Đang tuyển";
    const pct = total > 0 ? (bJobs.length / total) * 100 : 0;
    dashRows.push([
      { v: bName },
      { v: bJobs.length },
      { v: bNew },
      { v: avgScore },
      { v: statusLabel },
      { v: makeBarChartText(pct) },
    ]);
  }

  const jobColWidths = [6, 16, 42, 32, 24, 18, 16, 24, 24, 15, 16, 14, 15, 24, 48, 14, 38];
  const dashColWidths = [28, 12, 12, 14, 15, 26, 4, 28, 12, 12, 15, 26];

  const sheets: { name: string; xml: string }[] = [
    { name: "Dashboard", xml: buildWorksheetXml(dashRows, dashColWidths) },
    {
      name: "Top Luong Cao",
      xml: buildWorksheetXml(
        buildJobSheetRows(
          "TOP VIỆC LÀM LƯƠNG CAO",
          [...jobs].sort((a, b) => Number(b.salary_vnd_normalized || 0) - Number(a.salary_vnd_normalized || 0))
        ),
        jobColWidths
      ),
    },
    {
      name: "Viec Lam Moi",
      xml: buildWorksheetXml(buildJobSheetRows("VIỆC LÀM MỚI THU THẬP", newJobs.length ? newJobs : jobs), jobColWidths),
    },
    {
      name: "Cong Nghe - IT",
      xml: buildWorksheetXml(buildJobSheetRows("NHÓM CÔNG NGHỆ / PHẦN MỀM / KỸ THUẬT", techJobs), jobColWidths),
    },
    {
      name: "Tong Hop (All Jobs)",
      xml: buildWorksheetXml(buildJobSheetRows("TỔNG HỢP TẤT CẢ VIỆC LÀM", jobs), jobColWidths),
    },
  ];

  const usedNames = new Set(sheets.map((s) => s.name.toLowerCase()));
  for (const [portalName, portalJobs] of portalEntries) {
    const cleanSheetName = portalName.replace(/[\\/?*[\]:]/g, "").slice(0, 28).trim() || "Portal";
    if (usedNames.has(cleanSheetName.toLowerCase())) continue;
    usedNames.add(cleanSheetName.toLowerCase());
    sheets.push({
      name: cleanSheetName,
      xml: buildWorksheetXml(
        buildJobSheetRows(`NGUỒN TUYỂN DỤNG: ${portalName.toUpperCase()}`, portalJobs),
        jobColWidths
      ),
    });
  }

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("\n  ")}
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheets
      .map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("\n    ")}
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join("\n  ")}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="10"/><color rgb="FF18181B"/><name val="Segoe UI"/></font>
    <font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/></font>
    <font><b/><sz val="11"/><color rgb="FF1D4ED8"/><name val="Segoe UI"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF0FDF4"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE4E4E7"/></left>
      <right style="thin"><color rgb="FFE4E4E7"/></right>
      <top style="thin"><color rgb="FFE4E4E7"/></top>
      <bottom style="thin"><color rgb="FFE4E4E7"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
  </cellXfs>
</styleSheet>`;

  const enc = new TextEncoder();
  const zipEntries: { name: string; data: Uint8Array }[] = [
    { name: "[Content_Types].xml", data: enc.encode(contentTypesXml) },
    { name: "_rels/.rels", data: enc.encode(rootRelsXml) },
    { name: "xl/workbook.xml", data: enc.encode(workbookXml) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(workbookRelsXml) },
    { name: "xl/styles.xml", data: enc.encode(stylesXml) },
  ];

  sheets.forEach((s, idx) => {
    zipEntries.push({
      name: `xl/worksheets/sheet${idx + 1}.xml`,
      data: enc.encode(s.xml),
    });
  });

  return buildZipArchive(zipEntries);
}

export function buildUtf8BomCsvString(serialized: any[]): string {
  const header = [
    "ID",
    "Tier",
    "Score",
    "Title",
    "Company",
    "Portal",
    "Salary Raw",
    "Normalized (Million VND)",
    "Salary Bracket",
    "Category",
    "Skill / JLPT",
    "Location",
    "Work Mode",
    "Seniority",
    "HR Email",
    "HR Phone",
    "Status",
    "URL",
  ];
  const csvLines = [header.join(",")];
  for (const r of serialized) {
    const cols = [
      r.id,
      `"${r.quality_tier}"`,
      r.quality_score,
      `"${String(r.title || "").replace(/"/g, '""')}"`,
      `"${String(r.company_name || "").replace(/"/g, '""')}"`,
      `"${String(r.portal_name || r.source_domain || "").replace(/"/g, '""')}"`,
      `"${String(r.salary_raw || "").replace(/"/g, '""')}"`,
      r.salary_vnd_normalized || 0,
      `"${String(r.salary_bracket || "").replace(/"/g, '""')}"`,
      `"${String(r.job_category || "").replace(/"/g, '""')}"`,
      `"${String((r.skills || []).join("; ") || r.jlpt_level || "").replace(/"/g, '""')}"`,
      `"${String(r.location_city || "").replace(/"/g, '""')}"`,
      r.work_mode,
      r.seniority,
      r.hr_email || "",
      r.hr_phone || "",
      r.status || "new",
      `"${r.url}"`,
    ];
    csvLines.push(cols.join(","));
  }
  return "\uFEFF" + csvLines.join("\r\n");
}
