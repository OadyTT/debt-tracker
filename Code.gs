// ════════════════════════════════════════════════
//  สมุดหนี้โชห่วย — GAS Backend (Code.gs)
//  วาง code นี้ใน Google Apps Script
//  Deploy → Web App → Execute as: Me
//                  → Who has access: Anyone
// ════════════════════════════════════════════════

const SS_ID = "19XbESZDbvTa1ojJENNFFz5834aW52UkjAzSoRJmRyo8"; // ← ใส่ Spreadsheet ID ที่นี่ (จาก URL ของ Sheets)
                   //   เช่น "19XbESZDbvTa1ojJENNFFz5834aW52UkjAzSoRJmRyo8" 
                   // https://docs.google.com/spreadsheets/d/19XbESZDbvTa1ojJENNFFz5834aW52UkjAzSoRJmRyo8/edit?gid=0#gid=0
                  // https://script.google.com/macros/s/AKfycbxrCd34oeytvV3nogkJjJRVLWObLCUpWmE9yR9i2oHdFo-SYOqbU-T9tnzKrFA-5gcM/exec

function getSpreadsheet() {
  return SS_ID
    ? SpreadsheetApp.openById(SS_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

// ── Sheet helpers ──────────────────────────────
function getOrCreate(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight("bold")
      .setBackground("#1a3a2a")
      .setFontColor("#ffffff");
  }
  return sh;
}

function sheetToObjects(sh) {
  const [headers, ...rows] = sh.getDataRange().getValues();
  return rows.map(r =>
    Object.fromEntries(headers.map((h, i) => [h, r[i]]))
  );
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ════════════════════════════════════════════════
//  doGet  →  GET /exec?action=getData
// ════════════════════════════════════════════════
function doGet(e) {
  try {
    const action = e.parameter.action || "getData";
    if (action === "getData") return jsonResponse(getData());
    return jsonResponse({ ok: false, error: "unknown action" });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ════════════════════════════════════════════════
//  doPost →  POST /exec  { action, ...payload }
// ════════════════════════════════════════════════
function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);

    if (d.action === "addCustomer") return jsonResponse(addCustomer(d));
    if (d.action === "addDebt")     return jsonResponse(addDebt(d));
    if (d.action === "markPaid")    return jsonResponse(markPaid(d));
    if (d.action === "notify")      return jsonResponse(notifyLine(d));

    return jsonResponse({ ok: false, error: "unknown action: " + d.action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ════════════════════════════════════════════════
//  getData — ดึงข้อมูลทั้งหมด
// ════════════════════════════════════════════════
function getData() {
  const ss = getSpreadsheet();
  const cSh  = getOrCreate(ss, "ลูกค้า",      ["id","name","phone","totalDebt","dueDate"]);
  const tSh  = getOrCreate(ss, "รายการหนี้",  ["id","customerId","date","items","total","paid"]);

  const customers    = sheetToObjects(cSh).map(c => ({
    ...c,
    id:        Number(c.id),
    totalDebt: Number(c.totalDebt) || 0,
    dueDate:   c.dueDate || null,
    photo:     null, // photos stored locally on device
  }));

  const transactions = sheetToObjects(tSh).map(t => ({
    ...t,
    id:         Number(t.id),
    customerId: Number(t.customerId),
    total:      Number(t.total) || 0,
    paid:       t.paid === true || t.paid === "TRUE" || t.paid === "true",
    items:      typeof t.items === "string" ? JSON.parse(t.items || "[]") : (t.items || []),
  }));

  return { ok: true, customers, transactions };
}

// ════════════════════════════════════════════════
//  addCustomer
// ════════════════════════════════════════════════
function addCustomer(d) {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss, "ลูกค้า", ["id","name","phone","totalDebt","dueDate"]);
  const id = Date.now();
  sh.appendRow([id, d.name, d.phone || "", 0, ""]);
  return { ok: true, id };
}

// ════════════════════════════════════════════════
//  addDebt — เพิ่มรายการหนี้ + อัปเดตยอดค้าง
// ════════════════════════════════════════════════
function addDebt(d) {
  const ss  = getSpreadsheet();
  const cSh = getOrCreate(ss, "ลูกค้า",     ["id","name","phone","totalDebt","dueDate"]);
  const tSh = getOrCreate(ss, "รายการหนี้", ["id","customerId","date","items","total","paid"]);

  // ── บันทึกรายการ ──
  const txId = Date.now();
  tSh.appendRow([
    txId,
    d.customerId,
    d.date,
    JSON.stringify(d.items),
    d.total,
    false,
  ]);

  // ── อัปเดตยอดค้างลูกค้า ──
  const data  = cSh.getDataRange().getValues();
  const colId = 0, colDebt = 3, colDue = 4;
  for (let i = 1; i < data.length; i++) {
    if (Number(data[i][colId]) === Number(d.customerId)) {
      const old = Number(data[i][colDebt]) || 0;
      cSh.getRange(i + 1, colDebt + 1).setValue(old + d.total);
      if (d.dueDate) cSh.getRange(i + 1, colDue + 1).setValue(d.dueDate);
      break;
    }
  }
  return { ok: true, txId };
}

// ════════════════════════════════════════════════
//  markPaid — รับชำระ (บางส่วนหรือทั้งหมด)
// ════════════════════════════════════════════════
function markPaid(d) {
  const ss  = getSpreadsheet();
  const cSh = getOrCreate(ss, "ลูกค้า",     ["id","name","phone","totalDebt","dueDate"]);
  const tSh = getOrCreate(ss, "รายการหนี้", ["id","customerId","date","items","total","paid"]);

  // ── อัปเดตยอดค้างลูกค้า ──
  const cData = cSh.getDataRange().getValues();
  for (let i = 1; i < cData.length; i++) {
    if (Number(cData[i][0]) === Number(d.customerId)) {
      const old      = Number(cData[i][3]) || 0;
      const newTotal = Math.max(0, old - d.amount);
      cSh.getRange(i + 1, 4).setValue(newTotal);
      if (newTotal === 0) cSh.getRange(i + 1, 5).setValue("");
      break;
    }
  }

  // ── ถ้าจ่ายครบ mark transaction ว่า paid ──
  if (d.fullPay) {
    const tData = tSh.getDataRange().getValues();
    for (let i = 1; i < tData.length; i++) {
      if (Number(tData[i][1]) === Number(d.customerId) && tData[i][5] !== true) {
        tSh.getRange(i + 1, 6).setValue(true);
      }
    }
  }
  return { ok: true };
}

// ════════════════════════════════════════════════
//  notifyLine — ส่งแจ้งเตือน LINE
// ════════════════════════════════════════════════
function notifyLine(d) {
  if (!d.token || !d.message) return { ok: false, error: "missing token or message" };
  const res = UrlFetchApp.fetch("https://notify-api.line.me/api/notify", {
    method: "post",
    headers: { Authorization: "Bearer " + d.token },
    payload: "message=" + encodeURIComponent(d.message),
    muteHttpExceptions: true,
  });
  return { ok: res.getResponseCode() === 200 };
}
