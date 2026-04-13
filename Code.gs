// ════════════════════════════════════════════════
//  สมุดหนี้โชห่วย — GAS Backend v2.1
//  Deploy → Web App → Execute as: Me → Anyone
// ════════════════════════════════════════════════

const SS_ID              = "19XbESZDbvTa1ojJENNFFz5834aW52UkjAzSoRJmRyo8";
const MAIN_ADMIN         = "thitiphankk@gmail.com";
const ADMIN_LINE_UID     = "Ub41fc0cdada0f290836a5b8258baccd1";
const PHOTO_FOLDER_NAME  = "สมุดหนี้-photos";
const FULL_VERSION_CODE  = "full-debt2026";
const DEFAULT_PROMPTPAY  = "0871407251";
const DEFAULT_SUPPORT_AMT= 399;
const APP_VERSION        = "v2.1";

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
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function getPhotoFolder() {
  const f = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  return f.hasNext() ? f.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
}

// ════════════════════════════════════════════════
//  doGet
// ════════════════════════════════════════════════
function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || "getData";
    if (action === "getData")         return jsonResponse(getData());
    if (action === "getSettings")     return jsonResponse(getSettings());
    if (action === "getPending")      return jsonResponse(getPendingHelpers());
    if (action === "verifyVersion")   return jsonResponse(verifyVersion(e.parameter.code));
    if (action === "getExpenses")       return jsonResponse(getExpenses(e.parameter));
    if (action === "getSupportPayments") return jsonResponse(getSupportPayments());
    if (action === "lineIdPage")      return lineIdPage(e);
    return jsonResponse({ ok:false, error:"unknown action" });
  } catch(err) { return jsonResponse({ ok:false, error:err.message }); }
}

// ════════════════════════════════════════════════
//  doPost — handles both App actions AND LINE webhook
// ════════════════════════════════════════════════
function doPost(e) {
  try {
    const body = e.postData.contents;
    const d    = JSON.parse(body);

    // ── LINE Webhook (has "destination" + "events") ──
    if (d.destination && d.events) {
      return handleLineWebhook(d);
    }

    // ── App actions ──
    switch(d.action) {
      case "addCustomer":    return jsonResponse(addCustomer(d));
      case "addDebt":        return jsonResponse(addDebt(d));
      case "updateDebt":     return jsonResponse(updateDebt(d));
      case "markPaid":       return jsonResponse(markPaid(d));
      case "savePhoto":      return jsonResponse(savePhoto(d));
      case "saveSettings":   return jsonResponse(saveSettings(d));
      case "notifyEmail":    return jsonResponse(notifyEmail(d));
      case "notifyLine":     return jsonResponse(notifyLine(d));
      case "updateCustomerNote": return jsonResponse(updateCustomerNote(d));
      case "updateCustomerPhone": return jsonResponse(updateCustomerPhone(d));
      case "approveHelper":  return jsonResponse(approveHelper(d));
      case "rejectHelper":         return jsonResponse(rejectHelper(d));
      case "refreshPendingProfiles": return jsonResponse(refreshPendingProfiles()||{ok:true});
      case "backup":         return jsonResponse(backup());
      case "addExpense":     return jsonResponse(addExpense(d));
      case "getExpenses":    return jsonResponse(getExpenses(d));
      case "supportPayment":         return jsonResponse(supportPayment(d));
      case "approveSupportPayment": return jsonResponse(approveSupportPayment(d));
      case "rejectSupportPayment":  return jsonResponse(rejectSupportPayment(d));
    }
    return jsonResponse({ ok:false, error:"unknown action: "+d.action });
  } catch(err) { return jsonResponse({ ok:false, error:err.message }); }
}

// ════════════════════════════════════════════════
//  getData
// ════════════════════════════════════════════════
function getData() {
  const ss  = getSpreadsheet();
  const cSh = getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl","note"]);
  const tSh = getOrCreate(ss,"รายการหนี้",["id","customerId","date","items","total","paid","interestRate","dueDate"]);
  const customers = sheetToObjects(cSh).map(c=>({
    ...c, id:Number(c.id), totalDebt:Number(c.totalDebt)||0,
    dueDate:c.dueDate||null, photo:c.photoUrl||null, note:c.note||""
  }));
  const transactions = sheetToObjects(tSh).map(t=>({
    ...t, id:Number(t.id), customerId:Number(t.customerId),
    total:Number(t.total)||0,
    paid:t.paid===true||String(t.paid).toUpperCase()==="TRUE",
    items:typeof t.items==="string"?JSON.parse(t.items||"[]"):(t.items||[]),
    interestRate:Number(t.interestRate)||0,
    dueDate:t.dueDate||null,
  }));
  return { ok:true, customers, transactions };
}

// ════════════════════════════════════════════════
//  getSettings
// ════════════════════════════════════════════════
function getSettings() {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss,"ตั้งค่า",["key","value"]);
  const map = {};
  sheetToObjects(sh).forEach(r=>{ if(r.key) map[r.key]=String(r.value); });
  return {
    ok: true,
    settings: {
      promptpayId:   map["promptpayId"]   || DEFAULT_PROMPTPAY,
      adminEmails:   map["adminEmails"]   ? JSON.parse(map["adminEmails"]) : [],
      adminLineUids: map["adminLineUids"] ? JSON.parse(map["adminLineUids"]) : [ADMIN_LINE_UID],
      channelToken:  map["channelToken"]  || "",
      lineOAId:      map["lineOAId"]      || "",
      supportAmount: Number(map["supportAmount"]) || DEFAULT_SUPPORT_AMT,
      isFullVersion: map["versionCode"]   === FULL_VERSION_CODE,
      supportPromptpay: map["supportPromptpay"] || DEFAULT_PROMPTPAY,
    }
  };
}

// ════════════════════════════════════════════════
//  saveSettings
// ════════════════════════════════════════════════
function saveSettings(d) {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss,"ตั้งค่า",["key","value"]);
  const data = sh.getDataRange().getValues();
  const s    = d.settings || {};
  const toSave = {
    promptpayId:      s.promptpayId   || DEFAULT_PROMPTPAY,
    adminEmails:      JSON.stringify(s.adminEmails   || []),
    adminLineUids:    JSON.stringify(s.adminLineUids || [ADMIN_LINE_UID]),
    channelToken:     s.channelToken  || "",
    lineOAId:         s.lineOAId      || "",
    supportAmount:    String(s.supportAmount || DEFAULT_SUPPORT_AMT),
    supportPromptpay: s.supportPromptpay || DEFAULT_PROMPTPAY,
  };
  if(s.versionCode) toSave.versionCode = s.versionCode;
  Object.entries(toSave).forEach(([key,value])=>{
    let found=false;
    for(let i=1;i<data.length;i++){
      if(data[i][0]===key){ sh.getRange(i+1,2).setValue(value); found=true; break; }
    }
    if(!found) sh.appendRow([key,value]);
  });
  return { ok:true };
}

// ════════════════════════════════════════════════
//  verifyVersion
// ════════════════════════════════════════════════
function verifyVersion(code) {
  if(code === FULL_VERSION_CODE) {
    // Auto-save version code
    const ss=getSpreadsheet();
    const sh=getOrCreate(ss,"ตั้งค่า",["key","value"]);
    const data=sh.getDataRange().getValues();
    let found=false;
    for(let i=1;i<data.length;i++){
      if(data[i][0]==="versionCode"){sh.getRange(i+1,2).setValue(code);found=true;break;}
    }
    if(!found) sh.appendRow(["versionCode",code]);
    return { ok:true, isFullVersion:true, message:"🎉 Activated Full Version!" };
  }
  return { ok:false, isFullVersion:false, message:"รหัสไม่ถูกต้อง" };
}

// ════════════════════════════════════════════════
//  addCustomer
// ════════════════════════════════════════════════
function addCustomer(d) {
  const ss=getSpreadsheet();
  const sh=getOrCreate(ss,"ลูกค้า",["id","name","phone","totalDebt","dueDate","photoUrl","note"]);
  const id=d.txId||Date.now();
  sh.appendRow([id,d.name,d.phone||"",0,"","",""]);
  return { ok:true, newId:id, ...getData() };
}

// ════════════════════════════════════════════════
//  addDebt
// ════════════════════════════════════════════════
function addDebt(d) {
  const ss =getSpreadsheet();
  const cSh=getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl","note"]);
  const tSh=getOrCreate(ss,"รายการหนี้",["id","customerId","date","items","total","paid","interestRate","dueDate"]);
  tSh.appendRow([d.txId||Date.now(),d.customerId,d.date,JSON.stringify(d.items),d.total,false,d.interestRate||0,d.dueDate||""]);
  const cData=cSh.getDataRange().getValues();
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
//  updateDebt
// ════════════════════════════════════════════════
function updateDebt(d) {
  const ss =getSpreadsheet();
  const tSh=getOrCreate(ss,"รายการหนี้",["id","customerId","date","items","total","paid","interestRate","dueDate"]);
  const cSh=getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl"]);
  const tData=tSh.getDataRange().getValues();
  for(let i=1;i<tData.length;i++){
    if(Number(tData[i][0])===Number(d.transactionId)){
      tSh.getRange(i+1,4).setValue(JSON.stringify(d.items));
      tSh.getRange(i+1,5).setValue(d.newTotal);
      if(d.interestRate!==undefined) tSh.getRange(i+1,7).setValue(d.interestRate);
      if(d.dueDate!==undefined)      tSh.getRange(i+1,8).setValue(d.dueDate);
      break;
    }
  }
  const allTx=sheetToObjects(tSh);
  const unpaid=allTx.filter(t=>Number(t.customerId)===Number(d.customerId)&&String(t.paid).toUpperCase()!=="TRUE");
  const newDebt=unpaid.reduce((s,t)=>s+Number(t.total),0);
  const cData=cSh.getDataRange().getValues();
  for(let i=1;i<cData.length;i++){
    if(Number(cData[i][0])===Number(d.customerId)){cSh.getRange(i+1,4).setValue(newDebt);break;}
  }
  return getData();
}

// ════════════════════════════════════════════════
//  markPaid
// ════════════════════════════════════════════════
function markPaid(d) {
  const ss =getSpreadsheet();
  const cSh=getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl","note"]);
  const tSh=getOrCreate(ss,"รายการหนี้",["id","customerId","date","items","total","paid","interestRate","dueDate"]);
  const cData=cSh.getDataRange().getValues();
  for(let i=1;i<cData.length;i++){
    if(Number(cData[i][0])===Number(d.customerId)){
      const n=Math.max(0,(Number(cData[i][3])||0)-d.amount);
      cSh.getRange(i+1,4).setValue(n);
      if(n===0) cSh.getRange(i+1,5).setValue("");
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
//  savePhoto
// ════════════════════════════════════════════════
function savePhoto(d) {
  try {
    const raw=d.base64.includes(",")?d.base64.split(",")[1]:d.base64;
    const fn="customer_"+d.customerId+".jpg";
    const folder=getPhotoFolder();
    const old=folder.getFilesByName(fn);
    while(old.hasNext()) old.next().setTrashed(true);
    const blob=Utilities.newBlob(Utilities.base64Decode(raw),"image/jpeg",fn);
    const file=folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
    const url="https://drive.google.com/thumbnail?id="+file.getId()+"&sz=w300";
    const ss=getSpreadsheet();
    const cSh=getOrCreate(ss,"ลูกค้า",["id","name","phone","totalDebt","dueDate","photoUrl","note"]);
    const cData=cSh.getDataRange().getValues();
    const headers=cData[0];
    let col=headers.indexOf("photoUrl");
    if(col===-1){col=headers.length;cSh.getRange(1,col+1).setValue("photoUrl");}
    for(let i=1;i<cData.length;i++){
      if(Number(cData[i][0])===Number(d.customerId)){cSh.getRange(i+1,col+1).setValue(url);break;}
    }
    return { ok:true, photoUrl:url };
  } catch(err){ return { ok:false, error:err.message }; }
}

// ════════════════════════════════════════════════
//  updateCustomerPhone — อัปเดตเบอร์โทรลูกค้า
//  d: { customerId, phone }
// ════════════════════════════════════════════════
function updateCustomerPhone(d) {
  const ss   = getSpreadsheet();
  const cSh  = getOrCreate(ss,"ลูกค้า",["id","name","phone","totalDebt","dueDate","photoUrl","note"]);
  const data = cSh.getDataRange().getValues();
  for (let i=1; i<data.length; i++) {
    if (Number(data[i][0]) === Number(d.customerId)) {
      cSh.getRange(i+1, 3).setValue(d.phone||"");
      break;
    }
  }
  return getData();
}

// ════════════════════════════════════════════════
//  updateCustomerNote — บันทึก Note ลูกค้า
//  d: { customerId, note }
// ════════════════════════════════════════════════
function updateCustomerNote(d) {
  const ss   = getSpreadsheet();
  const cSh  = getOrCreate(ss,"ลูกค้า",["id","name","phone","totalDebt","dueDate","photoUrl","note"]);
  const data = cSh.getDataRange().getValues();
  const headers = data[0];
  let noteCol = headers.indexOf("note");
  if (noteCol === -1) {
    noteCol = headers.length;
    cSh.getRange(1, noteCol+1).setValue("note");
  }
  for (let i=1; i<data.length; i++) {
    if (Number(data[i][0]) === Number(d.customerId)) {
      cSh.getRange(i+1, noteCol+1).setValue(d.note||"");
      break;
    }
  }
  return getData();
}

// ════════════════════════════════════════════════
//  getSupportPayments — ดึงรายการสนับสนุนทั้งหมด
// ════════════════════════════════════════════════
function getSupportPayments() {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss,"สนับสนุน",["id","name","amount","date","status","slipUrl","note"]);
  const rows = sheetToObjects(sh).map(r=>({
    ...r, amount: Number(r.amount)||0,
  }));
  return { ok:true, payments: rows.reverse() }; // newest first
}

// ════════════════════════════════════════════════
//  approveSupportPayment — อนุมัติ + ส่ง Full Version Code ทางอีเมล
//  d: { paymentId, buyerName, buyerEmail (optional) }
// ════════════════════════════════════════════════
function approveSupportPayment(d) {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss,"สนับสนุน",["id","name","amount","date","status","slipUrl","note"]);
  const data = sh.getDataRange().getValues();
  let buyerName = d.buyerName || "";
  let amount    = 0;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(d.paymentId)) {
      sh.getRange(i+1, 5).setValue("approved");
      if (!buyerName) buyerName = data[i][1] || "";
      amount = Number(data[i][2]) || 0;
      break;
    }
  }

  // ── ส่ง Full Version Code ทางอีเมล ──
  const recipientEmail = d.buyerEmail || MAIN_ADMIN;
  const code = FULL_VERSION_CODE;

  try {
    MailApp.sendEmail({
      to: recipientEmail,
      bcc: MAIN_ADMIN,           // admin ได้สำเนาด้วย
      subject: "🎉 Full Version Code — ระบบสมุดหนี้โชห่วย",
      htmlBody: `<div style="font-family:sans-serif;max-width:480px;">
        <div style="background:#1a3a2a;color:#fff;padding:18px 20px;border-radius:12px 12px 0 0;">
          <h2 style="margin:0;font-size:18px;">🎉 ขอบคุณที่สนับสนุน!</h2>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:22px;">
          <p>สวัสดีคุณ <b>${buyerName}</b></p>
          <p>ขอบคุณสำหรับการสนับสนุนระบบสมุดหนี้โชห่วย ฿${amount} 🙏</p>
          <p>รหัส Full Version ของคุณ:</p>
          <div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:10px;padding:16px;text-align:center;margin:14px 0;">
            <div style="font-size:10px;color:#15803d;margin-bottom:6px;">รหัส Full Version</div>
            <div style="font-size:22px;font-weight:800;color:#1a3a2a;letter-spacing:2px;font-family:monospace;">${code}</div>
          </div>
          <div style="background:#eff6ff;border-radius:8px;padding:12px 14px;margin-top:14px;">
            <b>วิธีเปิดใช้:</b>
            <ol style="margin:8px 0 0;padding-left:18px;font-size:14px;color:#374151;">
              <li>เปิดแอพสมุดหนี้โชห่วย</li>
              <li>กด ⚙️ ตั้งค่า (รหัสผ่าน 4207)</li>
              <li>เลื่อนลงที่ "รหัส Full Version"</li>
              <li>วางรหัสแล้วกด ยืนยัน</li>
            </ol>
          </div>
          <hr style="border:none;border-top:1px solid #f3f4f6;margin:16px 0;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">ระบบสมุดหนี้โชห่วย · admin: ${MAIN_ADMIN}</p>
        </div>
      </div>`,
      body: "รหัส Full Version: " + code + "\nขอบคุณคุณ " + buyerName + " ที่สนับสนุน ฿" + amount,
    });
  } catch(err) {
    Logger.log("Email error: " + err.message);
  }

  return { ok:true, codeSent:true, to:recipientEmail };
}

// ════════════════════════════════════════════════
//  rejectSupportPayment — ปฏิเสธ (slip ไม่ถูกต้อง ฯลฯ)
// ════════════════════════════════════════════════
function rejectSupportPayment(d) {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss,"สนับสนุน",["id","name","amount","date","status","slipUrl","note"]);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(d.paymentId)) {
      sh.getRange(i+1, 5).setValue("rejected");
      if (d.reason) sh.getRange(i+1, 7).setValue(d.reason);
      break;
    }
  }
  return { ok:true };
}

// ════════════════════════════════════════════════
//  EXPENSE (รายจ่าย) — โหมดรถส่งของ
// ════════════════════════════════════════════════

// addExpense — บันทึกการจ่ายเงินสด
// d: { supplier, items:[{name,price}], total, date, note }
function addExpense(d) {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss,"รายจ่าย",[
    "id","date","supplier","items","total","note","createdAt"
  ]);
  const id = Date.now();
  sh.appendRow([
    id,
    d.date || Utilities.formatDate(new Date(),"Asia/Bangkok","yyyy-MM-dd"),
    d.supplier || "ไม่ระบุ",
    JSON.stringify(d.items || []),
    Number(d.total) || 0,
    d.note || "",
    new Date().toISOString(),
  ]);
  return { ok:true, id, ...getExpenses({}) };
}

// getExpenses — ดึงรายจ่าย (filter by month/date optional)
function getExpenses(params) {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss,"รายจ่าย",[
    "id","date","supplier","items","total","note","createdAt"
  ]);
  const raw = sheetToObjects(sh).map(e=>({
    ...e,
    id:    Number(e.id),
    total: Number(e.total)||0,
    items: typeof e.items==="string"?JSON.parse(e.items||"[]"):(e.items||[]),
  }));

  // filter
  const month = params && params.month; // "2026-04"
  const date  = params && params.date;  // "2026-04-13"
  let filtered = raw;
  if(date)  filtered = raw.filter(e=>e.date===date);
  else if(month) filtered = raw.filter(e=>String(e.date||"").startsWith(month));

  filtered.sort((a,b)=>b.id-a.id);

  // summary
  const today      = Utilities.formatDate(new Date(),"Asia/Bangkok","yyyy-MM-dd");
  const thisMonth  = today.slice(0,7);
  const todayTotal = raw.filter(e=>e.date===today).reduce((s,e)=>s+e.total,0);
  const monthTotal = raw.filter(e=>String(e.date||"").startsWith(thisMonth)).reduce((s,e)=>s+e.total,0);

  return { ok:true, expenses:filtered, todayTotal, monthTotal };
}

// ════════════════════════════════════════════════
//  backup — สำรองข้อมูลไปยัง Sheet แยก
// ════════════════════════════════════════════════
function backup() {
  try {
    const ss   = getSpreadsheet();
    const data = getData();
    const date = Utilities.formatDate(new Date(),"Asia/Bangkok","yyyy-MM-dd HH:mm");
    const bkName = "backup_"+date.replace(" ","_").replace(":","-");
    const bkSh = ss.insertSheet(bkName);

    // ลูกค้า
    bkSh.appendRow(["=== ลูกค้า ==="]);
    bkSh.appendRow(["id","ชื่อ","เบอร์","ยอดค้าง","วันทวง","รูป"]);
    (data.customers||[]).forEach(c=>bkSh.appendRow([c.id,c.name,c.phone,c.totalDebt,c.dueDate||"",c.photo||""]));

    bkSh.appendRow([""]);
    bkSh.appendRow(["=== รายการหนี้ ==="]);
    bkSh.appendRow(["id","customerId","วันที่","รายการ","ยอด","ชำระแล้ว","ดอกเบี้ย%","วันทวง"]);
    (data.transactions||[]).forEach(t=>bkSh.appendRow([t.id,t.customerId,t.date,t.items.map(i=>i.name+"("+i.price+")").join("|"),t.total,t.paid,t.interestRate||0,t.dueDate||""]));

    return { ok:true, sheet:bkName, customers:(data.customers||[]).length, transactions:(data.transactions||[]).length };
  } catch(err){ return { ok:false, error:err.message }; }
}

// ════════════════════════════════════════════════
//  LINE Messaging API
// ════════════════════════════════════════════════
function getChannelToken() {
  const ss=getSpreadsheet();
  const sh=getOrCreate(ss,"ตั้งค่า",["key","value"]);
  const rows=sheetToObjects(sh);
  const row=rows.find(r=>r.key==="channelToken");
  return row?String(row.value):"";
}

function sendLineMessage(uid, message) {
  const token=getChannelToken();
  if(!token||!uid) return { ok:false, reason:"no token or uid" };
  try{
    const res=UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push",{
      method:"post",
      headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
      payload:JSON.stringify({to:uid,messages:[{type:"text",text:message}]}),
      muteHttpExceptions:true
    });
    return { ok:res.getResponseCode()===200, code:res.getResponseCode() };
  }catch(err){ return { ok:false, error:err.message }; }
}

// ── Drive photo URL → LINE-accessible URL ──────
// LINE Messaging API requires a publicly accessible HTTPS image URL.
// Google Drive thumbnail URLs work for this purpose.
function toLineImageUrl(driveUrl) {
  if (!driveUrl) return null;
  // Convert drive.google.com/thumbnail?id=XXX to direct URL
  if (driveUrl.includes("drive.google.com/thumbnail")) return driveUrl;
  // Convert drive.google.com/file/d/ID/view to thumbnail
  const m = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)\//);
  if (m) return "https://drive.google.com/thumbnail?id=" + m[1] + "&sz=w400";
  return null;
}

function buildLineMessages(text, photoUrl) {
  const messages = [];
  // Photo first (more eye-catching)
  const imgUrl = toLineImageUrl(photoUrl);
  if (imgUrl) {
    messages.push({
      type: "image",
      originalContentUrl: imgUrl,
      previewImageUrl:    imgUrl,
    });
  }
  // Text message
  messages.push({ type: "text", text });
  return messages;
}

function notifyLine(d) {
  const token = d.channelToken || getChannelToken();
  if (!token) return { ok:false, reason:"no channel token" };
  const uids     = d.uids || [];
  const messages = buildLineMessages(d.message, d.photoUrl || null);
  const results  = uids.map(uid => {
    try {
      const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
        method: "post",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        payload: JSON.stringify({ to: uid, messages }),
        muteHttpExceptions: true,
      });
      return { uid, ok: res.getResponseCode() === 200, code: res.getResponseCode() };
    } catch(e) { return { uid, ok: false, error: e.message }; }
  });
  return { ok: true, results };
}

// ════════════════════════════════════════════════
//  LINE Webhook — captures UIDs of people who message the bot
// ════════════════════════════════════════════════
// ════════════════════════════════════════════════
//  LINE Reply helper
// ════════════════════════════════════════════════
function replyLine(replyToken, message, photoUrl) {
  const token = getChannelToken();
  if (!token || !replyToken) return;
  try {
    const messages = buildLineMessages(message, photoUrl || null);
    UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
      method: "post",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      payload: JSON.stringify({ replyToken, messages }),
      muteHttpExceptions: true,
    });
  } catch(e) { Logger.log("replyLine error: " + e.message); }
}

function thaiDate(d) {
  if (!d) return "";
  try {
    const dt = new Date(d);
    const thMonths = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
    return dt.getDate() + " " + thMonths[dt.getMonth()] + " " + (dt.getFullYear() + 543);
  } catch { return d; }
}

function numFmt(n) { return Number(n).toLocaleString("th-TH"); }

// ════════════════════════════════════════════════
//  LINE Chatbot Help Text
// ════════════════════════════════════════════════
function getHelpText(uid) {
  return "🏪 ระบบลูกหนี้ร้านอ้อ" +
    "\n══════════════════" +
    "\n📋 คำสั่งสำหรับเจ้าหนี้:" +
    "\n" +
    "\n💾 บันทึกหนี้ใหม่:" +
    "\n  บันทึก [ชื่อ] [฿] [รายการ]" +
    "\n  เช่น: บันทึก สมศรี 200 ข้าวสาร" +
    "\n" +
    "\n💰 รับชำระเงิน:" +
    "\n  รับ [ชื่อ] [฿]" +
    "\n  เช่น: รับ สมศรี 500" +
    "\n" +
    "\n🔍 เช็คยอดค้าง:" +
    "\n  ยอด [ชื่อ]" +
    "\n  เช่น: ยอด สมศรี" +
    "\n" +
    "\n📊 รายชื่อลูกหนี้ทั้งหมด:" +
    "\n  รายการ" +
    "\n" +
    "\n📅 ดูวันทวงวันนี้:" +
    "\n  วันนี้" +
    "\n══════════════════" +
    "\n🆔 LINE UID ของคุณ:" +
    "\n" + uid;
}

// ════════════════════════════════════════════════
//  handleLineWebhook — Full chatbot with commands
// ════════════════════════════════════════════════
function handleLineWebhook(body) {
  const events = body.events || [];
  events.forEach(ev => {
    const uid = ev.source && ev.source.userId;
    if (!uid) return;

    // ── เพิ่มเพื่อน (Follow event) ──
    if (ev.type === "follow") {
      addPendingHelper(uid);
      replyLine(ev.replyToken,
        "👋 สวัสดีครับ! ระบบลูกหนี้ร้านอ้อ" +
        "\n══════════════════" +
        "\n🆔 LINE User ID ของคุณ:" +
        "\n" + uid +
        "\n══════════════════" +
        "\n📌 ส่ง ID นี้ให้ Admin เพื่อขอสิทธิ์" +
        "\nหรือพิมพ์ ช่วยเหลือ เพื่อดูคำสั่ง"
      );
      return;
    }

    // ── ข้อความ (Message event) ──
    if (ev.type === "message" && ev.message && ev.message.type === "text") {
      const text = ev.message.text.trim();
      const cfg  = getSettings().settings;
      const adminUids = cfg.adminLineUids || [];
      const isAdmin   = adminUids.includes(uid);

      if (isAdmin) {
        handleAdminCommand(uid, text, ev.replyToken, cfg);
      } else {
        // ไม่ใช่ Admin — แจ้ง UID และขึ้น pending
        addPendingHelper(uid);
        replyLine(ev.replyToken,
          "📋 LINE User ID ของคุณ:" +
          "\n" + uid +
          "\n══════════════════" +
          "\n⏳ ส่ง ID นี้ให้ Admin เพื่อขอรับแจ้งเตือน" +
          "\nหลังอนุมัติแล้ว คุณจะได้รับแจ้งเตือนทุกครั้งที่มีการบันทึกหนี้"
        );
      }
    }
  });
  return ContentService.createTextOutput("OK");
}

// ════════════════════════════════════════════════
//  Admin Command Router
// ════════════════════════════════════════════════
function handleAdminCommand(uid, text, replyToken, cfg) {
  const lower = text.toLowerCase().replace(/\s+/g," ").trim();

  // ── ช่วยเหลือ ──
  if (lower === "ช่วยเหลือ" || lower === "help" || lower === "?" || lower === "คำสั่ง") {
    replyLine(replyToken, getHelpText(uid));
    return;
  }

  // ── รายการ / ลูกหนี้ ──
  if (lower === "รายการ" || lower === "ลูกหนี้" || lower === "ทั้งหมด") {
    const data    = getData();
    const debtors = (data.customers||[]).filter(c => c.totalDebt > 0)
                    .sort((a,b) => b.totalDebt - a.totalDebt);
    if (debtors.length === 0) {
      replyLine(replyToken, "✅ ไม่มีลูกหนี้ค้างในขณะนี้");
      return;
    }
    const totalAll = debtors.reduce((s,c) => s + c.totalDebt, 0);
    let msg = "📊 ลูกหนี้ทั้งหมด (" + debtors.length + " ราย)" +
              "\n══════════════════";
    debtors.forEach((c, i) => {
      msg += "\n" + (i+1) + ". 👤 " + c.name;
      msg += "\n    💰 ฿" + numFmt(c.totalDebt);
      if (c.dueDate) {
        const isOverdue = c.dueDate < new Date().toISOString().slice(0,10);
        msg += " | " + (isOverdue ? "🔴" : "⏰") + " " + thaiDate(c.dueDate);
      }
    });
    msg += "\n══════════════════" +
           "\n💵 รวมค้างทั้งหมด: ฿" + numFmt(totalAll);
    replyLine(replyToken, msg);
    return;
  }

  // ── วันนี้ — ดูลูกหนี้ที่ครบกำหนดวันนี้ ──
  if (lower === "วันนี้" || lower === "ทวงวันนี้") {
    const today = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd");
    const data  = getData();
    const due   = (data.customers||[]).filter(c => c.dueDate === today && c.totalDebt > 0);
    if (due.length === 0) {
      replyLine(replyToken, "✅ ไม่มีลูกหนี้ครบกำหนดวันนี้
📅 " + thaiDate(today));
      return;
    }
    let msg = "🔴 ครบกำหนดวันนี้ (" + due.length + " ราย)" +
              "\n📅 " + thaiDate(today) +
              "\n══════════════════";
    due.forEach(c => {
      msg += "\n👤 " + c.name + " — ฿" + numFmt(c.totalDebt);
    });
    msg += "\n══════════════════" +
           "\n💵 รวม: ฿" + numFmt(due.reduce((s,c)=>s+c.totalDebt,0));
    replyLine(replyToken, msg);
    return;
  }

  // ── ยอด [ชื่อ] — เช็คยอดลูกค้า ──
  if (lower.startsWith("ยอด ") || lower.startsWith("เช็ค ") || lower.startsWith("ดู ")) {
    const name   = text.split(" ").slice(1).join(" ").trim();
    const data   = getData();
    const c      = (data.customers||[]).find(x => x.name.includes(name));
    if (!c) { replyLine(replyToken, '❌ ไม่พบลูกค้า "' + name + '"\nลองพิมพ์ รายการ เพื่อดูชื่อทั้งหมด'); return; }
    const txList = (data.transactions||[]).filter(t => t.customerId === c.id && !t.paid);
    let msg = "👤 " + c.name + " — เจ้าหนี้: ร้านอ้อ" +
              "\n══════════════════";
    if (c.totalDebt === 0) {
      msg += "\n✅ ไม่มียอดค้าง";
    } else {
      msg += "\n💰 ยอดค้างรวม: ฿" + numFmt(c.totalDebt);
      if (c.dueDate) {
        const isOv = c.dueDate < new Date().toISOString().slice(0,10);
        msg += "\n" + (isOv ? "🔴 เกินกำหนด:" : "⏰ ครบกำหนด:") + " " + thaiDate(c.dueDate);
      }
      if (txList.length > 0) {
        msg += "\n──────────────────\nรายการที่ค้าง:";
        txList.slice(0,5).forEach(t => {
          msg += "\n• " + thaiDate(t.date) + " — ฿" + numFmt(t.total);
          if (t.items && t.items.length > 0)
            msg += " (" + t.items.slice(0,2).map(i=>i.name).join(", ") + (t.items.length>2?"...":"") + ")";
        });
        if (txList.length > 5) msg += "\n... และอีก " + (txList.length-5) + " รายการ";
      }
    }
    msg += "\n══════════════════";
    replyLine(replyToken, msg);
    return;
  }

  // ── บันทึก [ชื่อ] [฿] [รายการ] ──
  if (lower.startsWith("บันทึก ") || lower.startsWith("จด ") || lower.startsWith("เพิ่ม ")) {
    const parts    = text.split(" ").slice(1);
    if (parts.length < 2) {
      replyLine(replyToken, "❌ รูปแบบไม่ถูกต้อง\nต้องใช้: บันทึก [ชื่อ] [฿] [รายการ]\nเช่น: บันทึก สมศรี 200 ข้าวสาร");
      return;
    }
    const custName = parts[0];
    const amount   = parseFloat(parts[1]);
    const itemName = parts.slice(2).join(" ") || "รายการสินค้า";
    if (isNaN(amount) || amount <= 0) {
      replyLine(replyToken, "❌ จำนวนเงินไม่ถูกต้อง\nเช่น: บันทึก สมศรี 200 ข้าวสาร");
      return;
    }
    const data = getData();
    let c = (data.customers||[]).find(x => x.name.includes(custName));
    if (!c) {
      // สร้างลูกค้าใหม่
      const res = addCustomer({ name: custName, phone: "", txId: Date.now() });
      c = (res.customers||[]).find(x => x.name === custName) || { id: Date.now(), name: custName, totalDebt: 0 };
    }
    const today = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd");
    addDebt({ customerId: c.id, date: today, items: [{name: itemName, price: amount}], total: amount, dueDate: "", interestRate: 0 });
    const newDebt  = (c.totalDebt||0) + amount;
    const msg = "✅ บันทึกหนี้แล้ว!" +
                "\n══════════════════" +
                "\n🏪 เจ้าหนี้: ร้านอ้อ" +
                "\n👤 ลูกหนี้:  " + custName +
                "\n📅 วันที่:   " + thaiDate(today) +
                "\n──────────────────" +
                "\n📝 " + itemName + " — ฿" + numFmt(amount) +
                "\n──────────────────" +
                "\n💰 รวมครั้งนี้: ฿" + numFmt(amount) +
                "\n📊 ยอดค้างรวม: ฿" + numFmt(newDebt) +
                "\n══════════════════" +
                "\n[บันทึกโดย LINE OA]";
    replyLine(replyToken, msg);
    return;
  }

  // ── รับ / จ่าย / ชำระ [ชื่อ] [฿] ──
  if (lower.startsWith("รับ ") || lower.startsWith("จ่าย ") || lower.startsWith("ชำระ ")) {
    const parts  = text.split(" ").slice(1);
    if (parts.length < 2) {
      replyLine(replyToken, "❌ รูปแบบ: รับ [ชื่อ] [฿]\nเช่น: รับ สมศรี 500");
      return;
    }
    const custName = parts[0];
    const amount   = parseFloat(parts[1]);
    if (isNaN(amount) || amount <= 0) {
      replyLine(replyToken, "❌ จำนวนเงินไม่ถูกต้อง");
      return;
    }
    const data = getData();
    const c    = (data.customers||[]).find(x => x.name.includes(custName));
    if (!c || c.totalDebt === 0) {
      replyLine(replyToken, '❌ ไม่พบ "' + custName + '" หรือไม่มียอดค้าง');
      return;
    }
    const fullPay   = amount >= c.totalDebt;
    const remaining = Math.max(0, c.totalDebt - amount);
    markPaid({ customerId: c.id, amount, fullPay });
    const today = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd");
    const msg = "💰 รับชำระแล้ว!" +
                "\n══════════════════" +
                "\n🏪 เจ้าหนี้: ร้านอ้อ" +
                "\n👤 ลูกหนี้:  " + c.name +
                "\n📅 วันที่:   " + thaiDate(today) +
                "\n──────────────────" +
                "\n💵 รับชำระ:   ฿" + numFmt(amount) +
                "\n📊 ยอดเดิม:   ฿" + numFmt(c.totalDebt) +
                "\n──────────────────" +
                (fullPay
                  ? "\n✅ ชำระครบแล้ว! ไม่มียอดค้าง"
                  : "\n⚠️ ยังค้างอยู่: ฿" + numFmt(remaining)) +
                "\n══════════════════";
    replyLine(replyToken, msg);
    return;
  }

  // ── ไม่รู้จักคำสั่ง ──
  replyLine(replyToken,
    "❓ ไม่เข้าใจคำสั่ง\nพิมพ์ ช่วยเหลือ เพื่อดูคำสั่งทั้งหมด" +
    "\n\n🆔 UID: " + uid
  );
}

// ════════════════════════════════════════════════
//  LINE Profile helper
//  ดึงชื่อ + รูปโปรไฟล์จาก LINE API
// ════════════════════════════════════════════════
function getLineProfile(uid) {
  try {
    const token = getChannelToken();
    if (!token) return null;
    const res = UrlFetchApp.fetch(
      "https://api.line.me/v2/bot/profile/" + uid,
      { headers: { "Authorization": "Bearer " + token }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;
    const p = JSON.parse(res.getContentText());
    return { displayName: p.displayName||"", pictureUrl: p.pictureUrl||"" };
  } catch(e) {
    Logger.log("getLineProfile error: " + e.message);
    return null;
  }
}

// ── IMAGE formula helper ── ใส่รูปใน Sheets cell
function imageCellFormula(url) {
  return url ? '=IMAGE("' + url + '",4,40,40)' : "";
}

function addPendingHelper(uid) {
  const ss  = getSpreadsheet();
  const sh  = getOrCreate(ss, "ผู้ช่วย-pending",
                ["uid","displayName","pictureUrl","timestamp","status"]);
  const rows = sheetToObjects(sh);
  if (rows.find(r => r.uid === uid)) {
    // already exists — try update profile if blank
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === uid && !data[i][1]) {
        const p = getLineProfile(uid);
        if (p) {
          sh.getRange(i+1, 2).setValue(p.displayName);
          sh.getRange(i+1, 3).setFormula(imageCellFormula(p.pictureUrl));
          sh.getRange(i+1, 3).setNote(p.pictureUrl); // store URL in note
        }
      }
    }
    return;
  }

  // ── ดึง LINE Profile ──
  const profile = getLineProfile(uid);
  const displayName = profile ? profile.displayName : "";
  const pictureUrl  = profile ? profile.pictureUrl  : "";

  // append row: uid | displayName | picture (IMAGE formula) | timestamp | status
  const rowIdx = sh.getLastRow() + 1;
  sh.getRange(rowIdx, 1).setValue(uid);
  sh.getRange(rowIdx, 2).setValue(displayName);
  if (pictureUrl) {
    sh.getRange(rowIdx, 3).setFormula(imageCellFormula(pictureUrl));
    sh.getRange(rowIdx, 3).setNote(pictureUrl); // URL เก็บใน Note
  }
  sh.getRange(rowIdx, 4).setValue(new Date().toISOString());
  sh.getRange(rowIdx, 5).setValue("pending");

  // ── ตั้งความสูงแถวให้เห็นรูป ──
  try { sh.setRowHeight(rowIdx, 50); } catch(e) {}

  // ── แจ้ง Admin Email ──
  try {
    MailApp.sendEmail({
      to: MAIN_ADMIN,
      subject: "🔔 มีผู้ขอเป็นผู้ช่วย Admin — " + (displayName||uid),
      htmlBody: `<div style="font-family:sans-serif;">
        <h3>🔔 มีผู้ขอเป็นผู้ช่วย Admin</h3>
        ${pictureUrl ? '<img src="'+pictureUrl+'" style="width:60px;height:60px;border-radius:50%;"><br><br>' : ''}
        <b>ชื่อ LINE:</b> ${displayName||"(ไม่ระบุ)"}<br>
        <b>LINE UID:</b> ${uid}<br>
        <b>เวลา:</b> ${new Date().toLocaleString("th-TH")}<br><br>
        <i>เข้า Settings → อนุมัติผู้ช่วย</i>
      </div>`,
      body: "ชื่อ: "+displayName+"
LINE UID: "+uid
    });
  } catch(e) {}
}

// ── refreshPendingProfiles — รันใน Apps Script เพื่ออัปเดตรูปที่มีอยู่แล้ว ──
function refreshPendingProfiles() {
  const ss   = getSpreadsheet();
  const sh   = ss.getSheetByName("ผู้ช่วย-pending");
  if (!sh) return;
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const uidCol = headers.indexOf("uid");
  const nameCol = headers.indexOf("displayName");
  const picCol  = headers.indexOf("pictureUrl");
  if (uidCol < 0) return;

  for (let i = 1; i < data.length; i++) {
    const uid = data[i][uidCol];
    if (!uid) continue;
    const p = getLineProfile(uid);
    if (!p) continue;
    if (nameCol >= 0) sh.getRange(i+1, nameCol+1).setValue(p.displayName);
    if (picCol  >= 0) {
      sh.getRange(i+1, picCol+1).setFormula(imageCellFormula(p.pictureUrl));
      sh.getRange(i+1, picCol+1).setNote(p.pictureUrl);
    }
    try { sh.setRowHeight(i+1, 50); } catch(e) {}
    Utilities.sleep(300); // ไม่ให้ rate limit
  }
}

function getPendingHelpers() {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss, "ผู้ช่วย-pending",
               ["uid","displayName","pictureUrl","timestamp","status"]);
  const rows = sheetToObjects(sh).map(r => ({
    ...r,
    // ดึง pictureUrl จาก Note (เพราะ cell มี formula)
    pictureUrl: sh.getRange(
      (sheetToObjects(sh).findIndex(x=>x.uid===r.uid)||0)+2, 3
    ).getNote() || r.pictureUrl || "",
  }));
  return { ok:true, pending:rows };
}

function approveHelper(d) {
  const ss  = getSpreadsheet();
  const pSh = getOrCreate(ss, "ผู้ช่วย-pending",
                ["uid","displayName","pictureUrl","timestamp","status"]);
  const data = pSh.getDataRange().getValues();
  const headers = data[0];
  const statusCol = headers.indexOf("status") + 1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === d.uid) {
      pSh.getRange(i+1, statusCol||5).setValue("approved");
      break;
    }
  }
  // Add to adminLineUids in settings
  const cfg  = getSettings().settings;
  const uids = cfg.adminLineUids || [];
  if (!uids.includes(d.uid)) uids.push(d.uid);
  saveSettings({ settings: { ...cfg, adminLineUids: uids } });
  sendLineMessage(d.uid, "✅ คุณได้รับการอนุมัติเป็นผู้ช่วย Admin แล้ว!
คุณจะได้รับแจ้งเตือนทุกครั้งที่มีการบันทึกหนี้");
  return { ok:true };
}

function rejectHelper(d) {
  const ss  = getSpreadsheet();
  const pSh = getOrCreate(ss, "ผู้ช่วย-pending",
                ["uid","displayName","pictureUrl","timestamp","status"]);
  const data = pSh.getDataRange().getValues();
  const headers = data[0];
  const statusCol = headers.indexOf("status") + 1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === d.uid) {
      pSh.getRange(i+1, statusCol||5).setValue("rejected");
      break;
    }
  }
  return { ok:true };
}

// ════════════════════════════════════════════════
//  supportPayment — บันทึกการสนับสนุน + รับ Slip
// ════════════════════════════════════════════════
const SUPPORT_FOLDER_NAME = "สมุดหนี้-slips";

function getSlipFolder() {
  const f = DriveApp.getFoldersByName(SUPPORT_FOLDER_NAME);
  return f.hasNext() ? f.next() : DriveApp.createFolder(SUPPORT_FOLDER_NAME);
}

function supportPayment(d) {
  const ss  = getSpreadsheet();
  const sh  = getOrCreate(ss,"สนับสนุน",["id","name","amount","date","status","slipUrl","note"]);
  const id  = Date.now();
  let slipUrl = "";
  let slipBlob = null;

  // ── บันทึก Slip ไป Drive ──
  if(d.slip) {
    try {
      const raw      = d.slip.includes(",") ? d.slip.split(",")[1] : d.slip;
      const fileName = "slip_"+id+".jpg";
      const folder   = getSlipFolder();
      const blob     = Utilities.newBlob(Utilities.base64Decode(raw), "image/jpeg", fileName);
      const file     = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      slipUrl = "https://drive.google.com/file/d/"+file.getId()+"/view";
      slipBlob = blob; // เก็บไว้แนบ email
    } catch(err) {
      Logger.log("Slip upload error: "+err.message);
    }
  }

  // ── บันทึกลง Sheets ──
  sh.appendRow([id, d.name||"ไม่ระบุ", d.amount||DEFAULT_SUPPORT_AMT, new Date().toISOString(), "pending", slipUrl, d.note||""]);

  // ── แจ้ง Admin ทาง Email (แนบ Slip ถ้ามี) ──
  try {
    const emailOpts = {
      to:      MAIN_ADMIN,
      subject: "☕ สนับสนุนค่ากาแฟ ฿"+d.amount+" — "+d.name,
      htmlBody: `
        <div style="font-family:sans-serif;max-width:480px;">
          <div style="background:#1a3a2a;color:#fff;padding:16px;border-radius:12px 12px 0 0;">
            <h2 style="margin:0;">☕ มีการสนับสนุนค่ากาแฟ!</h2>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px;">
            <table style="width:100%;">
              <tr><td style="color:#6b7280;">ชื่อ</td><td style="font-weight:700;text-align:right;">${d.name||"ไม่ระบุ"}</td></tr>
              <tr><td style="color:#6b7280;">จำนวน</td><td style="font-weight:800;font-size:18px;text-align:right;color:#f59e0b;">฿${d.amount}</td></tr>
              <tr><td style="color:#6b7280;">วันที่</td><td style="text-align:right;">${new Date().toLocaleString("th-TH")}</td></tr>
              ${slipUrl?`<tr><td colspan="2" style="padding-top:12px;"><a href="${slipUrl}" style="background:#f59e0b;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-weight:700;">📎 ดู Slip การโอนเงิน</a></td></tr>`:""}
            </table>
            <hr style="border:none;border-top:1px solid #f3f4f6;margin:16px 0;">
            <p style="color:#6b7280;font-size:12px;">อนุมัติได้ใน ⚙️ Settings → อนุมัติผู้ซื้อ Full Version</p>
          </div>
        </div>`,
      body: "สนับสนุน: "+d.name+" ฿"+d.amount+(slipUrl?"\nSlip: "+slipUrl:""),
    };

    // แนบ Slip เป็น attachment ด้วย (ถ้ามี)
    if(slipBlob) {
      emailOpts.attachments = [slipBlob.setName("slip_"+d.name+"_฿"+d.amount+".jpg")];
    }

    MailApp.sendEmail(emailOpts);
  } catch(e) {
    Logger.log("Email error: "+e.message);
  }

  return { ok:true, id, slipUrl };
}

// ════════════════════════════════════════════════
//  notifyEmail
// ════════════════════════════════════════════════
function notifyEmail(d) {
  try {
    const all=[MAIN_ADMIN,...(d.extraEmails||[])];
    const uniq=[...new Set(all.filter(e=>e&&e.includes("@")))];
    uniq.forEach(email=>{
      MailApp.sendEmail({
        to:email, subject:d.subject||"📬 สมุดหนี้โชห่วย",
        body:d.body||"",
        htmlBody:`<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <div style="background:#1a3a2a;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;">
            <h2 style="margin:0;font-size:18px;">🏪 สมุดหนี้โชห่วย ${APP_VERSION}</h2>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px;">
            ${d.htmlBody||d.body||""}
            <hr style="border:none;border-top:1px solid #f3f4f6;margin:16px 0;">
            <p style="color:#9ca3af;font-size:12px;margin:0;">admin: ${MAIN_ADMIN}</p>
          </div></div>`
      });
    });
    return { ok:true, sentTo:uniq };
  } catch(err){ return { ok:false, error:err.message }; }
}

// ════════════════════════════════════════════════
//  lineIdPage — HTML helper with Add Friend button
// ════════════════════════════════════════════════
function lineIdPage(e) {
  // รับ LINE OA ID จาก URL param (?oaId=@xxx)
  const oaId = (e && e.parameter && e.parameter.oaId) ? e.parameter.oaId : "";
  const addFriendUrl = oaId ? "https://line.me/R/ti/p/" + oaId : "";

  const addFriendBtn = addFriendUrl ? `
  <a href="${addFriendUrl}" class="add-btn">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.13 2 11.2c0 3.1 1.7 5.85 4.3 7.55v3.25l3.9-2.15c1.03.29 2.13.45 3.28.45 5.52 0 10-4.13 10-9.2S17.52 2 12 2z"/></svg>
    เพิ่ม LINE OA เป็นเพื่อน
  </a>` : `<div class="no-oa">⚠️ Admin ยังไม่ได้ตั้งค่า LINE OA ID<br><small>กรุณาติดต่อ Admin</small></div>`;

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>สมัครรับแจ้งเตือน LINE</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Sarabun',sans-serif;background:linear-gradient(160deg,#1a3a2a,#0d1f17);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;}
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap');
  .card{background:#fff;border-radius:20px;padding:28px 24px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);}
  .header{text-align:center;margin-bottom:24px;}
  .icon{font-size:44px;margin-bottom:10px;}
  h2{color:#1a3a2a;font-size:20px;font-weight:800;margin-bottom:4px;}
  .subtitle{color:#6b7280;font-size:14px;line-height:1.5;}
  .add-btn{display:flex;align-items:center;justify-content:center;gap:10px;background:#06c755;color:#fff;padding:16px 24px;border-radius:50px;text-decoration:none;font-weight:800;font-size:17px;width:100%;margin-bottom:20px;box-shadow:0 4px 20px rgba(6,199,85,.4);transition:transform .15s;}
  .add-btn:active{transform:scale(.97);}
  .no-oa{background:#fff7ed;border-radius:10px;padding:12px;text-align:center;color:#92400e;font-size:14px;margin-bottom:20px;line-height:1.6;}
  .divider{display:flex;align-items:center;gap:10px;margin-bottom:18px;}
  .divider hr{flex:1;border:none;border-top:1px solid #e5e7eb;}
  .divider span{color:#9ca3af;font-size:13px;white-space:nowrap;}
  .step{display:flex;gap:12px;margin-bottom:14px;align-items:flex-start;}
  .num{background:#1a3a2a;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:13px;}
  .step-text{font-size:14px;color:#374151;line-height:1.5;padding-top:4px;}
  .step-text b{color:#1a3a2a;}
  .note{background:#f0fdf4;border-radius:12px;padding:12px 14px;font-size:13px;color:#15803d;line-height:1.6;display:flex;gap:8px;align-items:flex-start;}
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <div class="icon">🏪</div>
    <h2>สมัครรับแจ้งเตือน LINE</h2>
    <p class="subtitle">เพิ่ม LINE OA แล้วส่งข้อความ<br>ระบบจะจับ User ID ของคุณอัตโนมัติ</p>
  </div>

  ${addFriendBtn}

  <div class="divider"><hr><span>ขั้นตอน</span><hr></div>

  <div class="step">
    <div class="num">1</div>
    <div class="step-text">กดปุ่ม <b>"เพิ่ม LINE OA เป็นเพื่อน"</b> ด้านบน</div>
  </div>
  <div class="step">
    <div class="num">2</div>
    <div class="step-text">ส่งข้อความใดก็ได้ เช่น <b>"สวัสดี"</b> หรือ <b>"เพิ่มฉัน"</b></div>
  </div>
  <div class="step">
    <div class="num">3</div>
    <div class="step-text">บอตจะตอบกลับพร้อม <b>User ID</b> ของคุณ (ขึ้นต้นด้วย U...)</div>
  </div>
  <div class="step">
    <div class="num">4</div>
    <div class="step-text">รอ <b>Admin อนุมัติ</b> — หลังอนุมัติจะได้รับแจ้งเตือนทุกครั้ง</div>
  </div>

  <div class="note">
    <span>✅</span>
    <span>หลังจากถูกอนุมัติ คุณจะได้รับแจ้งเตือนผ่าน LINE ทุกครั้งที่มีการบันทึกหนี้ใหม่หรือรับชำระ</span>
  </div>
</div>
</body>
</html>`;

  return HtmlService.createHtmlOutput(html).setTitle("สมัครรับแจ้งเตือน LINE").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
