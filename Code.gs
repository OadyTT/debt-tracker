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
    if (action === "lineIdPage")      return lineIdPage();
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
      case "approveHelper":  return jsonResponse(approveHelper(d));
      case "rejectHelper":   return jsonResponse(rejectHelper(d));
      case "backup":         return jsonResponse(backup());
      case "supportPayment": return jsonResponse(supportPayment(d));
    }
    return jsonResponse({ ok:false, error:"unknown action: "+d.action });
  } catch(err) { return jsonResponse({ ok:false, error:err.message }); }
}

// ════════════════════════════════════════════════
//  getData
// ════════════════════════════════════════════════
function getData() {
  const ss  = getSpreadsheet();
  const cSh = getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl"]);
  const tSh = getOrCreate(ss,"รายการหนี้",["id","customerId","date","items","total","paid","interestRate","dueDate"]);
  const customers = sheetToObjects(cSh).map(c=>({
    ...c, id:Number(c.id), totalDebt:Number(c.totalDebt)||0,
    dueDate:c.dueDate||null, photo:c.photoUrl||null
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
  const sh=getOrCreate(ss,"ลูกค้า",["id","name","phone","totalDebt","dueDate","photoUrl"]);
  const id=d.txId||Date.now();
  sh.appendRow([id,d.name,d.phone||"",0,"",""]);
  return { ok:true, newId:id, ...getData() };
}

// ════════════════════════════════════════════════
//  addDebt
// ════════════════════════════════════════════════
function addDebt(d) {
  const ss =getSpreadsheet();
  const cSh=getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl"]);
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
  const cSh=getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl"]);
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
    const cSh=getOrCreate(ss,"ลูกค้า",["id","name","phone","totalDebt","dueDate","photoUrl"]);
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

function notifyLine(d) {
  const token=d.channelToken||getChannelToken();
  if(!token) return { ok:false, reason:"no channel token" };
  const uids=d.uids||[];
  const results=uids.map(uid=>{
    try{
      const res=UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push",{
        method:"post",
        headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
        payload:JSON.stringify({to:uid,messages:[{type:"text",text:d.message}]}),
        muteHttpExceptions:true
      });
      return { uid, ok:res.getResponseCode()===200 };
    }catch(e){ return { uid, ok:false }; }
  });
  return { ok:true, results };
}

// ════════════════════════════════════════════════
//  LINE Webhook — captures UIDs of people who message the bot
// ════════════════════════════════════════════════
function handleLineWebhook(body) {
  const events=body.events||[];
  events.forEach(ev=>{
    const uid=ev.source&&ev.source.userId;
    if(!uid) return;
    if(ev.type==="follow"||ev.type==="message") {
      addPendingHelper(uid);
      // Reply with instructions if message event
      if(ev.type==="message"&&ev.replyToken) {
        const token=getChannelToken();
        if(token){
          UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply",{
            method:"post",
            headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
            payload:JSON.stringify({
              replyToken:ev.replyToken,
              messages:[{type:"text",text:"✅ ระบบได้รับข้อมูลของคุณแล้ว!\n\nLINE User ID: "+uid+"\n\nรอ Admin อนุมัติให้คุณเป็นผู้ช่วย..."}]
            }),
            muteHttpExceptions:true
          });
        }
      }
    }
  });
  return ContentService.createTextOutput("OK");
}

function addPendingHelper(uid) {
  const ss=getSpreadsheet();
  const sh=getOrCreate(ss,"ผู้ช่วย-pending",["uid","timestamp","status"]);
  const rows=sheetToObjects(sh);
  if(rows.find(r=>r.uid===uid)) return; // already exists
  sh.appendRow([uid,new Date().toISOString(),"pending"]);
  // Notify admin by email
  try{
    MailApp.sendEmail({
      to:MAIN_ADMIN,
      subject:"🔔 มีผู้ขอเป็นผู้ช่วย Admin",
      body:"LINE UID: "+uid+"\nเวลา: "+new Date().toLocaleString("th-TH")+"\n\nกรุณาเข้า Settings เพื่ออนุมัติ"
    });
  }catch(e){}
}

function getPendingHelpers() {
  const ss=getSpreadsheet();
  const sh=getOrCreate(ss,"ผู้ช่วย-pending",["uid","timestamp","status"]);
  return { ok:true, pending:sheetToObjects(sh) };
}

function approveHelper(d) {
  const ss=getSpreadsheet();
  const pSh=getOrCreate(ss,"ผู้ช่วย-pending",["uid","timestamp","status"]);
  const data=pSh.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(data[i][0]===d.uid){pSh.getRange(i+1,3).setValue("approved");break;}
  }
  // Add to settings adminLineUids
  const cfg=getSettings().settings;
  const uids=cfg.adminLineUids||[];
  if(!uids.includes(d.uid)) uids.push(d.uid);
  saveSettings({settings:{...cfg,adminLineUids:uids}});
  // Notify via LINE
  sendLineMessage(d.uid,"✅ คุณได้รับการอนุมัติเป็นผู้ช่วย Admin แล้ว! คุณจะได้รับแจ้งเตือนทุกครั้งที่มีการบันทึกหนี้ใหม่");
  return { ok:true };
}

function rejectHelper(d) {
  const ss=getSpreadsheet();
  const pSh=getOrCreate(ss,"ผู้ช่วย-pending",["uid","timestamp","status"]);
  const data=pSh.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(data[i][0]===d.uid){pSh.getRange(i+1,3).setValue("rejected");break;}
  }
  return { ok:true };
}

// ════════════════════════════════════════════════
//  supportPayment — บันทึกการสนับสนุน
// ════════════════════════════════════════════════
function supportPayment(d) {
  const ss=getSpreadsheet();
  const sh=getOrCreate(ss,"สนับสนุน",["id","name","amount","date","status","note"]);
  const id=Date.now();
  sh.appendRow([id,d.name||"ไม่ระบุ",d.amount||DEFAULT_SUPPORT_AMT,new Date().toISOString(),"pending",d.note||""]);
  // Notify admin
  try{
    MailApp.sendEmail({
      to:MAIN_ADMIN,
      subject:"☕ มีการสนับสนุน ฿"+d.amount,
      body:"ชื่อ: "+d.name+"\nจำนวน: ฿"+d.amount+"\n\nกรุณาตรวจสอบใน Google Sheets แท็บ 'สนับสนุน'"
    });
  }catch(e){}
  return { ok:true, id };
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
//  lineIdPage — HTML helper
// ════════════════════════════════════════════════
function lineIdPage() {
  return HtmlService.createHtmlOutput(`<!DOCTYPE html>
<html lang="th">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>สมัครรับแจ้งเตือน LINE</title>
<style>body{font-family:sans-serif;background:#f4f6f0;margin:0;padding:20px;}.card{background:#fff;border-radius:16px;padding:20px;max-width:380px;margin:0 auto;box-shadow:0 4px 20px rgba(0,0,0,.1);}h2{color:#1a3a2a;margin:0 0 12px;}.step{display:flex;gap:10px;margin-bottom:12px;align-items:flex-start;}.num{background:#06c755;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:13px;}button{background:#06c755;color:#fff;border:none;border-radius:12px;padding:12px 20px;width:100%;font-size:16px;cursor:pointer;margin-top:12px;}</style>
</head>
<body>
<div class="card">
  <h2>📱 สมัครรับแจ้งเตือน LINE</h2>
  <p style="color:#6b7280;font-size:14px;">เพิ่ม LINE OA แล้วส่งข้อความใดก็ได้ ระบบจะจับ UID ของคุณอัตโนมัติ</p>
  <div class="step"><div class="num">1</div><div>เพิ่ม LINE OA ของร้าน เป็นเพื่อน</div></div>
  <div class="step"><div class="num">2</div><div>ส่งข้อความใดก็ได้ เช่น "สวัสดี"</div></div>
  <div class="step"><div class="num">3</div><div>บอต LINE จะตอบกลับพร้อม User ID ของคุณ</div></div>
  <div class="step"><div class="num">4</div><div>รอ Admin อนุมัติ</div></div>
  <p style="background:#f0fdf4;border-radius:8px;padding:10px;font-size:13px;color:#15803d;">✅ หลังจากถูกอนุมัติ คุณจะได้รับแจ้งเตือนทุกครั้งที่มีการบันทึกหนี้</p>
</div>
</body></html>`).setTitle("สมัครรับแจ้งเตือน LINE");
}
