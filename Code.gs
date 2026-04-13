// ════════════════════════════════════════════════
//  สมุดหนี้โชห่วย — GAS Backend v2.0
//  Deploy → Web App → Execute as: Me
//                  → Who has access: Anyone
// ════════════════════════════════════════════════

const SS_ID             = "19XbESZDbvTa1ojJENNFFz5834aW52UkjAzSoRJmRyo8";
const MAIN_ADMIN        = "thitiphankk@gmail.com";
const ADMIN_LINE_UID    = "Ub41fc0cdada0f290836a5b8258baccd1";
const PHOTO_FOLDER_NAME = "สมุดหนี้-photos";

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
    if (action === "getData")     return jsonResponse(getData());
    if (action === "getSettings") return jsonResponse(getSettings());
    if (action === "lineIdPage")  return lineIdPage();
    return jsonResponse({ ok:false, error:"unknown action" });
  } catch(err) { return jsonResponse({ ok:false, error:err.message }); }
}

// ════════════════════════════════════════════════
//  doPost
// ════════════════════════════════════════════════
function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.action === "addCustomer")    return jsonResponse(addCustomer(d));
    if (d.action === "addDebt")        return jsonResponse(addDebt(d));
    if (d.action === "updateDebt")     return jsonResponse(updateDebt(d));
    if (d.action === "markPaid")       return jsonResponse(markPaid(d));
    if (d.action === "savePhoto")      return jsonResponse(savePhoto(d));
    if (d.action === "saveSettings")   return jsonResponse(saveSettings(d));
    if (d.action === "notifyEmail")    return jsonResponse(notifyEmail(d));
    return jsonResponse({ ok:false, error:"unknown action: "+d.action });
  } catch(err) { return jsonResponse({ ok:false, error:err.message }); }
}

// ════════════════════════════════════════════════
//  getData
// ════════════════════════════════════════════════
function getData() {
  const ss  = getSpreadsheet();
  const cSh = getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl"]);
  const tSh = getOrCreate(ss,"รายการหนี้",["id","customerId","date","items","total","paid"]);
  const customers = sheetToObjects(cSh).map(c=>({
    ...c, id:Number(c.id), totalDebt:Number(c.totalDebt)||0,
    dueDate:c.dueDate||null, photo:c.photoUrl||null
  }));
  const transactions = sheetToObjects(tSh).map(t=>({
    ...t, id:Number(t.id), customerId:Number(t.customerId),
    total:Number(t.total)||0,
    paid:t.paid===true||String(t.paid).toUpperCase()==="TRUE",
    items:typeof t.items==="string"?JSON.parse(t.items||"[]"):(t.items||[]),
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
  sheetToObjects(sh).forEach(r=>{ if(r.key) map[r.key]=r.value; });
  return {
    ok:true,
    settings:{
      promptpayId: map["promptpayId"] || "",
      adminEmails: map["adminEmails"] ? JSON.parse(map["adminEmails"]) : [],
      adminLineUids: map["adminLineUids"] ? JSON.parse(map["adminLineUids"]) : [],
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
  const toSave = {
    promptpayId:   d.settings.promptpayId || "",
    adminEmails:   JSON.stringify(d.settings.adminEmails || []),
    adminLineUids: JSON.stringify(d.settings.adminLineUids || []),
  };
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
//  addCustomer
// ════════════════════════════════════════════════
function addCustomer(d) {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss,"ลูกค้า",["id","name","phone","totalDebt","dueDate","photoUrl"]);
  const id = Date.now();
  sh.appendRow([id, d.name, d.phone||"", 0, "", ""]);
  return { ok:true, newId:id, ...getData() };
}

// ════════════════════════════════════════════════
//  addDebt
// ════════════════════════════════════════════════
function addDebt(d) {
  const ss  = getSpreadsheet();
  const cSh = getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl"]);
  const tSh = getOrCreate(ss,"รายการหนี้",["id","customerId","date","items","total","paid"]);
  tSh.appendRow([d.txId||Date.now(), d.customerId, d.date, JSON.stringify(d.items), d.total, false]);
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
//  updateDebt — แก้ไขรายการในบิล
//  d: { transactionId, customerId, items, newTotal }
// ════════════════════════════════════════════════
function updateDebt(d) {
  const ss  = getSpreadsheet();
  const tSh = getOrCreate(ss,"รายการหนี้",["id","customerId","date","items","total","paid"]);
  const cSh = getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl"]);

  // อัปเดต transaction
  const tData = tSh.getDataRange().getValues();
  for(let i=1;i<tData.length;i++){
    if(Number(tData[i][0])===Number(d.transactionId)){
      tSh.getRange(i+1,4).setValue(JSON.stringify(d.items));
      tSh.getRange(i+1,5).setValue(d.newTotal);
      break;
    }
  }

  // คำนวณยอดรวมของลูกค้าใหม่จาก tx ที่ยังค้าง
  const allTx = sheetToObjects(tSh);
  const unpaid = allTx.filter(t=>Number(t.customerId)===Number(d.customerId)&&String(t.paid).toUpperCase()!=="TRUE");
  const newDebt = unpaid.reduce((s,t)=>s+Number(t.total),0);

  const cData = cSh.getDataRange().getValues();
  for(let i=1;i<cData.length;i++){
    if(Number(cData[i][0])===Number(d.customerId)){
      cSh.getRange(i+1,4).setValue(newDebt);
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
//  savePhoto — อัปโหลดรูปไป Drive
// ════════════════════════════════════════════════
function savePhoto(d) {
  try {
    const rawBase64 = d.base64.includes(",") ? d.base64.split(",")[1] : d.base64;
    const fileName  = "customer_"+d.customerId+".jpg";
    const folder    = getPhotoFolder();
    const old=folder.getFilesByName(fileName);
    while(old.hasNext()) old.next().setTrashed(true);
    const blob=Utilities.newBlob(Utilities.base64Decode(rawBase64),"image/jpeg",fileName);
    const file=folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
    const photoUrl="https://drive.google.com/thumbnail?id="+file.getId()+"&sz=w300";
    const ss=getSpreadsheet();
    const cSh=getOrCreate(ss,"ลูกค้า",["id","name","phone","totalDebt","dueDate","photoUrl"]);
    const cData=cSh.getDataRange().getValues();
    const headers=cData[0];
    let col=headers.indexOf("photoUrl");
    if(col===-1){col=headers.length;cSh.getRange(1,col+1).setValue("photoUrl");}
    for(let i=1;i<cData.length;i++){
      if(Number(cData[i][0])===Number(d.customerId)){cSh.getRange(i+1,col+1).setValue(photoUrl);break;}
    }
    return { ok:true, photoUrl };
  } catch(err){ return { ok:false, error:err.message }; }
}

// ════════════════════════════════════════════════
//  notifyEmail
// ════════════════════════════════════════════════
function notifyEmail(d) {
  try {
    const all=[MAIN_ADMIN,...(d.extraEmails||[])];
    const uniq=[...new Set(all.filter(e=>e&&e.includes("@")))];
    const subject=d.subject||"📬 สมุดหนี้โชห่วย";
    uniq.forEach(email=>{
      MailApp.sendEmail({to:email,subject,body:d.body||"",
        htmlBody:`<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <div style="background:#1a3a2a;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;">
            <h2 style="margin:0;font-size:18px;">🏪 สมุดหนี้โชห่วย</h2>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px;">
            ${d.htmlBody||d.body||""}
            <hr style="border:none;border-top:1px solid #f3f4f6;margin:16px 0;">
            <p style="color:#9ca3af;font-size:12px;margin:0;">สมุดหนี้โชห่วย v2.0 · admin: ${MAIN_ADMIN}</p>
          </div></div>`
      });
    });
    return { ok:true, sentTo:uniq };
  } catch(err){ return { ok:false, error:err.message }; }
}

// ════════════════════════════════════════════════
//  lineIdPage — HTML helper page
//  เปิดใน browser เพื่อดู LINE User ID
// ════════════════════════════════════════════════
function lineIdPage() {
  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>หา LINE User ID</title>
  <style>
    body{font-family:'Sarabun',sans-serif;background:#f4f6f0;margin:0;padding:20px;color:#1a3a2a;}
    .card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 4px 20px rgba(0,0,0,.1);max-width:400px;margin:0 auto;}
    h2{color:#1a3a2a;font-size:20px;margin:0 0 16px;}
    .step{display:flex;gap:10px;align-items:flex-start;margin-bottom:14px;}
    .num{background:#1a3a2a;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:14px;}
    .text{font-size:15px;line-height:1.5;}
    .uid-box{background:#f0fdf4;border:2px solid #22c55e;border-radius:10px;padding:12px;margin:16px 0;font-family:monospace;font-size:14px;word-break:break-all;color:#15803d;}
    button{background:#1a7a4a;color:#fff;border:none;border-radius:12px;padding:12px 24px;font-size:16px;cursor:pointer;width:100%;}
    .admin-uid{background:#eff6ff;border-radius:10px;padding:12px;margin-top:16px;font-size:13px;color:#1e40af;}
  </style>
</head>
<body>
  <div class="card">
    <h2>🔍 หา LINE User ID</h2>
    <p style="color:#6b7280;font-size:14px;margin:0 0 16px;">ให้ผู้ช่วย Admin ทำตามขั้นตอนนี้:</p>
    
    <div class="step"><div class="num">1</div><div class="text">เปิดหน้านี้ใน <b>LINE</b> (กด Share ลิงก์นี้ใน LINE แล้วกดเปิด)</div></div>
    <div class="step"><div class="num">2</div><div class="text">LINE User ID ของคุณจะแสดงด้านล่าง</div></div>
    <div class="step"><div class="num">3</div><div class="text">แคปหน้าจอหรือ Copy ส่งให้ Admin</div></div>
    
    <div class="uid-box" id="uid">⏳ กำลังโหลด... (ต้องเปิดใน LINE)</div>
    <button onclick="copyUid()">📋 Copy User ID</button>
    
    <div class="admin-uid">
      👑 Admin หลัก LINE UID:<br>
      <code>${ADMIN_LINE_UID}</code>
    </div>
  </div>
  
  <script>
    // Try to get LINE UID via LIFF or URL params
    const params = new URLSearchParams(window.location.search);
    const uid = params.get('uid') || localStorage.getItem('lineUid');
    
    if(uid) {
      document.getElementById('uid').innerHTML = '<b>LINE User ID ของคุณ:</b><br>' + uid;
      localStorage.setItem('lineUid', uid);
    } else {
      // Check if in LINE browser
      const isLINE = /Line/i.test(navigator.userAgent);
      if(!isLINE) {
        document.getElementById('uid').innerHTML = '⚠️ กรุณาเปิดลิงก์นี้ใน <b>LINE app</b><br><small>แชร์ลิงก์นี้ในแชท LINE แล้วกดเปิด</small>';
      } else {
        document.getElementById('uid').innerHTML = '📱 อยู่ใน LINE แล้ว แต่ต้องใช้ LIFF เพื่อดึง User ID<br><small>ติดต่อ Admin เพื่อตั้งค่า LIFF</small>';
      }
    }
    
    function copyUid() {
      const uid = document.getElementById('uid').innerText;
      navigator.clipboard.writeText(uid).then(()=>alert('Copied!')).catch(()=>{
        const el = document.createElement('textarea');
        el.value = uid;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        alert('Copied!');
      });
    }
  </script>
</body>
</html>`;
  return HtmlService.createHtmlOutput(html).setTitle("หา LINE User ID");
}
