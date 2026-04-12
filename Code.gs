// ════════════════════════════════════════════════
//  สมุดหนี้โชห่วย — GAS Backend v2.0
//  Deploy → Web App → Execute as: Me → Anyone
// ════════════════════════════════════════════════

const SS_ID            = "19XbESZDbvTa1ojJENNFFz5834aW52UkjAzSoRJmRyo8";
const MAIN_ADMIN       = "thitiphankk@gmail.com";
const ADMIN_LINE_UID   = "Ub41fc0cdada0f290836a5b8258baccd1";
const PHOTO_FOLDER     = "สมุดหนี้-photos";

function getSpreadsheet() {
  return SpreadsheetApp.openById(SS_ID);
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
  const h = data[0];
  return data.slice(1).map(r => Object.fromEntries(h.map((k,i)=>[k,r[i]])));
}
function jsonResponse(d) {
  return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON);
}
function getPhotoFolder() {
  const f = DriveApp.getFoldersByName(PHOTO_FOLDER);
  return f.hasNext() ? f.next() : DriveApp.createFolder(PHOTO_FOLDER);
}

// ── doGet ─────────────────────────────────────
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || "getData";
  if (action === "lineId")        return HtmlService.createHtmlOutput(lineIdPage());
  if (action === "requestAdmin")  return handleAdminRequest(e);
  try {
    if (action === "getData")     return jsonResponse(getData());
    if (action === "getSettings") return jsonResponse(getSettings());
    return jsonResponse({ok:false,error:"unknown"});
  } catch(err) { return jsonResponse({ok:false,error:err.message}); }
}

// ── doPost ────────────────────────────────────
function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.action==="addCustomer")      return jsonResponse(addCustomer(d));
    if (d.action==="addDebt")          return jsonResponse(addDebt(d));
    if (d.action==="markPaid")         return jsonResponse(markPaid(d));
    if (d.action==="updateTransaction")return jsonResponse(updateTransaction(d));
    if (d.action==="savePhoto")        return jsonResponse(savePhoto(d));
    if (d.action==="saveSettings")     return jsonResponse(saveSettings(d));
    if (d.action==="notifyEmail")      return jsonResponse(notifyEmail(d));
    return jsonResponse({ok:false,error:"unknown: "+d.action});
  } catch(err) { return jsonResponse({ok:false,error:err.message}); }
}

// ── getData ───────────────────────────────────
function getData() {
  const ss  = getSpreadsheet();
  const cSh = getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl"]);
  const tSh = getOrCreate(ss,"รายการหนี้",["id","customerId","date","items","total","paid"]);
  const customers    = sheetToObjects(cSh).map(c=>({...c,id:Number(c.id),totalDebt:Number(c.totalDebt)||0,dueDate:c.dueDate||null,photo:c.photoUrl||null}));
  const transactions = sheetToObjects(tSh).map(t=>({...t,id:Number(t.id),customerId:Number(t.customerId),total:Number(t.total)||0,paid:t.paid===true||String(t.paid).toUpperCase()==="TRUE",items:typeof t.items==="string"?JSON.parse(t.items||"[]"):(t.items||[])}));
  return {ok:true,customers,transactions};
}

// ── getSettings / saveSettings ────────────────
function getSettings() {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss,"ตั้งค่า",["key","value"]);
  const map = {};
  sheetToObjects(sh).forEach(r=>{ if(r.key) map[r.key]=r.value; });
  return {ok:true,settings:{
    promptpayId: map["promptpayId"]||"",
    adminUsers:  map["adminUsers"] ? JSON.parse(map["adminUsers"]) : [],
  }};
}
function saveSettings(d) {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss,"ตั้งค่า",["key","value"]);
  const data = sh.getDataRange().getValues();
  const toSave = {
    promptpayId: d.settings.promptpayId||"",
    adminUsers:  JSON.stringify(d.settings.adminUsers||[]),
  };
  Object.entries(toSave).forEach(([key,value])=>{
    let found=false;
    for(let i=1;i<data.length;i++){if(data[i][0]===key){sh.getRange(i+1,2).setValue(value);found=true;break;}}
    if(!found) sh.appendRow([key,value]);
  });
  return {ok:true};
}

// ── addCustomer ───────────────────────────────
function addCustomer(d) {
  const ss = getSpreadsheet();
  const sh = getOrCreate(ss,"ลูกค้า",["id","name","phone","totalDebt","dueDate","photoUrl"]);
  sh.appendRow([d.id||Date.now(), d.name, d.phone||"", 0, "", d.photoUrl||""]);
  return {ok:true};
}

// ── addDebt ───────────────────────────────────
function addDebt(d) {
  const ss  = getSpreadsheet();
  const cSh = getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl"]);
  const tSh = getOrCreate(ss,"รายการหนี้",["id","customerId","date","items","total","paid"]);
  tSh.appendRow([d.txId||Date.now(), d.customerId, d.date, JSON.stringify(d.items), d.total, false]);
  const cData = cSh.getDataRange().getValues();
  for(let i=1;i<cData.length;i++){
    if(Number(cData[i][0])===Number(d.customerId)){
      cSh.getRange(i+1,4).setValue((Number(cData[i][3])||0)+d.total);
      if(d.dueDate) cSh.getRange(i+1,5).setValue(d.dueDate);
      break;
    }
  }
  return {ok:true};
}

// ── updateTransaction — แก้ไขรายการหนี้ ───────
function updateTransaction(d) {
  // d: { txId, customerId, items, total, oldTotal }
  const ss  = getSpreadsheet();
  const cSh = getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl"]);
  const tSh = getOrCreate(ss,"รายการหนี้",["id","customerId","date","items","total","paid"]);
  const tData = tSh.getDataRange().getValues();
  for(let i=1;i<tData.length;i++){
    if(Number(tData[i][0])===Number(d.txId)){
      tSh.getRange(i+1,4).setValue(JSON.stringify(d.items));
      tSh.getRange(i+1,5).setValue(d.total);
      break;
    }
  }
  const diff = (d.total||0) - (d.oldTotal||0);
  if(diff!==0){
    const cData = cSh.getDataRange().getValues();
    for(let i=1;i<cData.length;i++){
      if(Number(cData[i][0])===Number(d.customerId)){
        cSh.getRange(i+1,4).setValue(Math.max(0,(Number(cData[i][3])||0)+diff));
        break;
      }
    }
  }
  return {ok:true};
}

// ── markPaid ──────────────────────────────────
function markPaid(d) {
  const ss  = getSpreadsheet();
  const cSh = getOrCreate(ss,"ลูกค้า",    ["id","name","phone","totalDebt","dueDate","photoUrl"]);
  const tSh = getOrCreate(ss,"รายการหนี้",["id","customerId","date","items","total","paid"]);
  const cData = cSh.getDataRange().getValues();
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
  return {ok:true};
}

// ── savePhoto → Google Drive ──────────────────
function savePhoto(d) {
  try {
    const raw = d.base64.includes(",")?d.base64.split(",")[1]:d.base64;
    const fname = "customer_"+d.customerId+".jpg";
    const folder = getPhotoFolder();
    const old = folder.getFilesByName(fname);
    while(old.hasNext()) old.next().setTrashed(true);
    const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(raw),"image/jpeg",fname));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = "https://drive.google.com/thumbnail?id="+file.getId()+"&sz=w300";
    // update sheet
    const ss  = getSpreadsheet();
    const cSh = getOrCreate(ss,"ลูกค้า",["id","name","phone","totalDebt","dueDate","photoUrl"]);
    const cData = cSh.getDataRange().getValues();
    const h = cData[0]; let photoCol = h.indexOf("photoUrl");
    if(photoCol===-1){photoCol=h.length;cSh.getRange(1,photoCol+1).setValue("photoUrl");}
    for(let i=1;i<cData.length;i++){
      if(Number(cData[i][0])===Number(d.customerId)){cSh.getRange(i+1,photoCol+1).setValue(url);break;}
    }
    return {ok:true,photoUrl:url};
  } catch(err){ return {ok:false,error:err.message}; }
}

// ── notifyEmail ───────────────────────────────
function notifyEmail(d) {
  try {
    const extras = (d.extraEmails||[]).filter(e=>e&&e.includes("@"));
    const all    = [...new Set([MAIN_ADMIN,...extras])];
    const sub    = d.subject||"📬 แจ้งเตือนสมุดหนี้โชห่วย";
    const html   = d.htmlBody||"";
    const txt    = d.body||"";
    all.forEach(to=>{
      MailApp.sendEmail({to,subject:sub,body:txt,htmlBody:`
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <div style="background:#1a3a2a;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;"><h2 style="margin:0;font-size:18px;">🏪 สมุดหนี้โชห่วย</h2></div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px;">
            ${html||txt.replace(/\n/g,"<br>")}
            <hr style="border:none;border-top:1px solid #f3f4f6;margin:16px 0;">
            <p style="color:#9ca3af;font-size:12px;margin:0;">admin: ${MAIN_ADMIN}</p>
          </div></div>`});
    });
    return {ok:true,sentTo:all};
  } catch(err){ return {ok:false,error:err.message}; }
}

// ── lineIdPage — HTML สำหรับหา LINE User ID ──
function lineIdPage() {
  const gasUrl = ScriptApp.getService().getUrl();
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>หา LINE User ID</title>
<style>body{font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px;background:#f4f6f0;}
h2{color:#1a3a2a;}.card{background:#fff;border-radius:16px;padding:20px;margin-bottom:16px;box-shadow:0 2px 10px rgba(0,0,0,.08);}
input{width:100%;padding:10px 12px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:1em;box-sizing:border-box;margin:8px 0;}
button{width:100%;padding:14px;background:#1a7a4a;color:#fff;border:none;border-radius:12px;font-size:1em;font-weight:700;cursor:pointer;margin-top:8px;}
.info{background:#f0fdf4;border-radius:10px;padding:12px;font-size:.85em;color:#166534;margin-bottom:12px;}
.warn{background:#fff7ed;border-radius:10px;padding:12px;font-size:.85em;color:#92400e;}</style></head>
<body>
<h2>🏪 สมุดหนี้โชห่วย<br>ขอเป็นผู้ช่วย Admin</h2>
<div class="card">
  <div class="info">กรอกข้อมูลด้านล่างแล้วกดส่ง — admin หลักจะได้รับ email และเพิ่มคุณเป็นผู้ช่วย admin</div>
  <label>ชื่อ-นามสกุล</label>
  <input id="name" placeholder="ชื่อ นามสกุล" />
  <label>อีเมล</label>
  <input id="email" type="email" placeholder="your@email.com" />
  <label>LINE User ID <span style="color:#9ca3af;font-size:.8em">(ดูวิธีหาด้านล่าง)</span></label>
  <input id="lineId" placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
  <button onclick="send()">📤 ส่งคำขอให้ Admin</button>
  <div id="result" style="margin-top:10px;text-align:center;font-size:.85em;"></div>
</div>
<div class="card">
  <b>🔍 วิธีหา LINE User ID ของตัวเอง</b><br><br>
  <b>วิธีที่ 1:</b> เปิด LINE → โปรไฟล์ → กดรูปโปรไฟล์ตัวเอง → ดู ID ที่ขึ้นต้นด้วย "U"<br><br>
  <b>วิธีที่ 2:</b> เปิด <a href="https://developers.line.biz" target="_blank">developers.line.biz</a> → Login → My Account → User ID<br><br>
  <div class="warn">⚠️ LINE User ID ขึ้นต้นด้วย "U" ตามด้วยตัวเลข/อักษร 32 ตัว เช่น Uabc123...</div>
</div>
<script>
async function send(){
  const name=document.getElementById("name").value.trim();
  const email=document.getElementById("email").value.trim();
  const lineId=document.getElementById("lineId").value.trim();
  if(!name){alert("กรุณาใส่ชื่อ");return;}
  document.getElementById("result").textContent="⏳ กำลังส่ง...";
  try{
    await fetch("${gasUrl}?action=requestAdmin&name="+encodeURIComponent(name)+"&email="+encodeURIComponent(email)+"&lineId="+encodeURIComponent(lineId));
    document.getElementById("result").innerHTML="<span style='color:#15803d;'>✅ ส่งคำขอแล้ว! admin จะติดต่อกลับ</span>";
  }catch(e){document.getElementById("result").innerHTML="<span style='color:#ef4444;'>❌ เกิดข้อผิดพลาด ลองใหม่</span>";}
}
</script></body></html>`;
}

// ── handleAdminRequest ————————————————————────
function handleAdminRequest(e) {
  const name   = e.parameter.name   || "ไม่ระบุ";
  const email  = e.parameter.email  || "-";
  const lineId = e.parameter.lineId || "-";
  try {
    MailApp.sendEmail({
      to: MAIN_ADMIN,
      subject: "📬 คำขอเป็นผู้ช่วย Admin — "+name,
      body: "มีผู้ขอเป็นผู้ช่วย admin:\n\nชื่อ: "+name+"\nอีเมล: "+email+"\nLINE User ID: "+lineId+"\n\nเพิ่มในหน้า ⚙️ ตั้งค่า → ผู้รับแจ้งเตือน",
      htmlBody: `<div style="font-family:sans-serif;padding:20px;"><h3>📬 คำขอเป็นผู้ช่วย Admin</h3>
        <table><tr><td style="color:#6b7280;padding:4px 16px 4px 0;">ชื่อ</td><td><b>${name}</b></td></tr>
        <tr><td style="color:#6b7280;padding:4px 16px 4px 0;">อีเมล</td><td>${email}</td></tr>
        <tr><td style="color:#6b7280;padding:4px 16px 4px 0;">LINE User ID</td><td style="font-family:monospace;">${lineId}</td></tr></table>
        <p>เพิ่มได้ใน ⚙️ ตั้งค่า → ผู้รับแจ้งเตือน</p></div>`
    });
  } catch(err) {}
  return HtmlService.createHtmlOutput("<html><body style='font-family:sans-serif;text-align:center;padding:40px;'><h2 style='color:#15803d;'>✅ ส่งคำขอแล้ว!</h2><p>Admin จะติดต่อกลับเร็วๆ นี้</p></body></html>");
}
