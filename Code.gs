// ════════════════════════════════════════════════
//  สมุดหนี้โชห่วย — GAS Backend (Code.gs)
//  Deploy → Web App → Execute as: Me
//                  → Who has access: Anyone
// ════════════════════════════════════════════════

const SS_ID = "19XbESZDbvTa1ojJENNFFz5834aW52UkjAzSoRJmRyo8"; // ← ใส่ Spreadsheet ID ที่นี่ (จาก URL ของ Sheets)
const MAIN_ADMIN = "thitiphankk@gmail.com";
const PHOTO_FOLDER_NAME = "สมุดหนี้-photos";

// ── Spreadsheet ──────────────────────────────────
function getSpreadsheet() {
  return SS_ID ? SpreadsheetApp.openById(SS_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreate(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1,1,1,headers.length).setFontWeight("bold").setBackground("#1a3a2a").setFontColor("#fff");
  }
  return sh;
}

function sheetToObjects(sh) {
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(r => Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ── Google Drive folder ──────────────────────────
function getPhotoFolder() {
  const folders = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
}

// ── doGet ────────────────────────────────────────
function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || "getData";
    if (action === "getData")     return jsonResponse(getData());
    if (action === "getSettings") return jsonResponse(getSettings());
    return jsonResponse({ ok:false, error:"unknown action" });
  } catch(err) { return jsonResponse({ ok:false, error:err.message }); }
}

// ── doPost ───────────────────────────────────────
function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.action === "addCustomer")  return jsonResponse(addCustomer(d));
    if (d.action === "addDebt")      return jsonResponse(addDebt(d));
    if (d.action === "markPaid")     return jsonResponse(markPaid(d));
    if (d.action === "savePhoto")    return jsonResponse(savePhoto(d));
    if (d.action === "saveSettings") return jsonResponse(saveSettings(d));
    if (d.action === "notifyEmail")  return jsonResponse(notifyEmail(d));
    return jsonResponse({ ok:false, error:"unknown action: "+d.action });
  } catch(err) { return jsonResponse({ ok:false, error:err.message }); }
}

// ════════════════════════════════════════════════
//  getData — ดึงข้อมูลทั้งหมด (customers + transactions)
// ════════════════════════════════════════════════
function getData() {
  const ss  = getSpreadsheet();
  const cSh = getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl"]);
  const tSh = getOrCreate(ss,"รายการหนี้",["id","customerId","date","items","total","paid"]);

  const customers = sheetToObjects(cSh).map(c=>({
    ...c,
    id:        Number(c.id),
    totalDebt: Number(c.totalDebt)||0,
    dueDate:   c.dueDate||null,
    photo:     c.photoUrl||null,
    photoUrl:  c.photoUrl||null,
  }));

  const transactions = sheetToObjects(tSh).map(t=>({
    ...t,
    id:         Number(t.id),
    customerId: Number(t.customerId),
    total:      Number(t.total)||0,
    paid:       t.paid===true||String(t.paid).toUpperCase()==="TRUE",
    items:      typeof t.items==="string"?JSON.parse(t.items||"[]"):(t.items||[]),
  }));

  return { ok:true, customers, transactions };
}

// ════════════════════════════════════════════════
//  getSettings — โหลดตั้งค่าจาก Sheets
// ════════════════════════════════════════════════
function getSettings() {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss,"ตั้งค่า",["key","value"]);
  const rows = sheetToObjects(sh);
  const map  = {};
  rows.forEach(r=>{ if(r.key) map[r.key]=r.value; });

  return {
    ok: true,
    settings: {
      promptpayId:  map["promptpayId"]  || "",
      adminEmails:  map["adminEmails"]  ? JSON.parse(map["adminEmails"]) : [],
    }
  };
}

// ════════════════════════════════════════════════
//  saveSettings — บันทึกตั้งค่าลง Sheets
// ════════════════════════════════════════════════
function saveSettings(d) {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss,"ตั้งค่า",["key","value"]);
  const data = sh.getDataRange().getValues();

  const toSave = {
    promptpayId: d.settings.promptpayId || "",
    adminEmails: JSON.stringify(d.settings.adminEmails || []),
  };

  Object.entries(toSave).forEach(([key,value])=>{
    let found = false;
    for(let i=1;i<data.length;i++){
      if(data[i][0]===key){ sh.getRange(i+1,2).setValue(value); found=true; break; }
    }
    if(!found) sh.appendRow([key,value]);
  });

  return { ok:true };
}

// ════════════════════════════════════════════════
//  savePhoto — อัปโหลดรูปไป Google Drive
//  รับ: { customerId, base64, mimeType }
//  คืน: { ok, url }
// ════════════════════════════════════════════════
function savePhoto(d) {
  try {
    const rawBase64 = d.base64.includes(",") ? d.base64.split(",")[1] : d.base64;
    const mimeType  = d.mimeType || "image/jpeg";
    const fileName  = "customer_" + d.customerId + ".jpg";

    const folder = getPhotoFolder();

    // ลบรูปเก่าของลูกค้าคนนี้ (ถ้ามี)
    const oldFiles = folder.getFilesByName(fileName);
    while(oldFiles.hasNext()) oldFiles.next().setTrashed(true);

    // สร้างไฟล์ใหม่
    const blob = Utilities.newBlob(Utilities.base64Decode(rawBase64), mimeType, fileName);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const fileId = file.getId();
    // Thumbnail URL ที่เข้าถึงได้สาธารณะ
    const photoUrl = "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w300";

    // อัปเดต photoUrl ในชีต ลูกค้า
    const ss   = getSpreadsheet();
    const cSh  = getOrCreate(ss,"ลูกค้า",["id","name","phone","totalDebt","dueDate","photoUrl"]);
    const cData = cSh.getDataRange().getValues();
    const headers = cData[0];
    let photoCol = headers.indexOf("photoUrl");
    if(photoCol===-1){
      photoCol = headers.length;
      cSh.getRange(1, photoCol+1).setValue("photoUrl");
    }
    for(let i=1;i<cData.length;i++){
      if(Number(cData[i][0])===Number(d.customerId)){
        cSh.getRange(i+1, photoCol+1).setValue(photoUrl);
        break;
      }
    }

    return { ok:true, photoUrl };
  } catch(err) {
    return { ok:false, error:err.message };
  }
}

// ════════════════════════════════════════════════
//  addCustomer
// ════════════════════════════════════════════════
function addCustomer(d) {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss,"ลูกค้า",["id","name","phone","totalDebt","dueDate","photoUrl"]);
  sh.appendRow([Date.now(), d.name, d.phone||"", 0, "", ""]);
  return getData();
}

// ════════════════════════════════════════════════
//  addDebt
// ════════════════════════════════════════════════
function addDebt(d) {
  const ss  = getSpreadsheet();
  const cSh = getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl"]);
  const tSh = getOrCreate(ss,"รายการหนี้",["id","customerId","date","items","total","paid"]);

  tSh.appendRow([Date.now(), d.customerId, d.date, JSON.stringify(d.items), d.total, false]);

  const cData = cSh.getDataRange().getValues();
  for(let i=1;i<cData.length;i++){
    if(Number(cData[i][0])===Number(d.customerId)){
      cSh.getRange(i+1,4).setValue((Number(cData[i][3])||0)+d.total);
      if(d.dueDate) cSh.getRange(i+1,5).setValue(d.dueDate);
      break;
    }
  }
  return getData();
}

// ════════════════════════════════════════════════
//  markPaid
// ════════════════════════════════════════════════
function markPaid(d) {
  const ss  = getSpreadsheet();
  const cSh = getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl"]);
  const tSh = getOrCreate(ss,"รายการหนี้",["id","customerId","date","items","total","paid"]);

  const cData = cSh.getDataRange().getValues();
  for(let i=1;i<cData.length;i++){
    if(Number(cData[i][0])===Number(d.customerId)){
      const newTotal=Math.max(0,(Number(cData[i][3])||0)-d.amount);
      cSh.getRange(i+1,4).setValue(newTotal);
      if(newTotal===0) cSh.getRange(i+1,5).setValue("");
      break;
    }
  }
  if(d.fullPay){
    const tData=tSh.getDataRange().getValues();
    for(let i=1;i<tData.length;i++){
      if(Number(tData[i][1])===Number(d.customerId)&&String(tData[i][5]).toUpperCase()!=="TRUE")
        tSh.getRange(i+1,6).setValue(true);
    }
  }
  return getData();
}

// ════════════════════════════════════════════════
//  notifyEmail
// ════════════════════════════════════════════════
function notifyEmail(d) {
  try {
    const all  = [MAIN_ADMIN,...(d.extraEmails||[])];
    const uniq = [...new Set(all.filter(e=>e&&e.includes("@")))];
    const subject  = d.subject  || "📬 แจ้งเตือนจากสมุดหนี้โชห่วย";
    const textBody = d.body     || "";
    const htmlBody = d.htmlBody || "";
    uniq.forEach(email=>{
      MailApp.sendEmail({
        to:email, subject,
        body:textBody,
        htmlBody:`<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <div style="background:#1a3a2a;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;">
            <h2 style="margin:0;font-size:18px;">🏪 สมุดหนี้โชห่วย</h2>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px;">
            ${htmlBody||textBody.replace(/\n/g,"<br>")}
            <hr style="border:none;border-top:1px solid #f3f4f6;margin:16px 0;">
            <p style="color:#9ca3af;font-size:12px;margin:0;">admin: ${MAIN_ADMIN}</p>
          </div></div>`
      });
    });
    return { ok:true, sentTo:uniq };
  } catch(err){ return { ok:false, error:err.message }; }
}
