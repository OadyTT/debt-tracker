import { useState, useRef, useEffect, useCallback } from "react";

// ══ Config ══════════════════════════════════════
const APP_VERSION = "v2.1";
const GAS_URL = "https://script.google.com/macros/s/AKfycbxrCd34oeytvV3nogkJjJRVLWObLCUpWmE9yR9i2oHdFo-SYOqbU-T9tnzKrFA-5gcM/exec";
const getLineRegisterPage = (oaId="") => GAS_URL + "?action=lineIdPage" + (oaId?"&oaId="+encodeURIComponent(oaId):"");
const MAIN_ADMIN   = "thitiphankk@gmail.com";
const CORRECT_PIN  = "4207";
const DEFAULT_QR   = "0871407251"; // default PromptPay (debt collection)
const SUPPORT_QR   = "0655619464"; // PromptPay สนับสนุนค่ากาแฟ (แยกต่างหาก)

const fl=document.createElement("link");
fl.href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap";
fl.rel="stylesheet";document.head.appendChild(fl);

// ══ PromptPay QR ════════════════════════════════
function crc16(s){let c=0xFFFF;for(let i=0;i<s.length;i++){c^=s.charCodeAt(i)<<8;for(let j=0;j<8;j++)c=c&0x8000?(c<<1)^0x1021:c<<1;}return(c&0xFFFF).toString(16).toUpperCase().padStart(4,"0");}
function tlv(t,v){return t+String(v.length).padStart(2,"0")+v;}
function genQR(target,amount){
  const raw=String(target||"").replace(/[^0-9]/g,"");
  if(!raw||raw.length<10) return null;
  const proxy=raw.length===10&&raw.startsWith("0")?"0066"+raw.slice(1):raw;
  const mi=tlv("00","A000000677010111")+tlv("01",proxy);
  const body=tlv("00","01")+tlv("01",amount>0?"12":"11")+tlv("29",mi)+tlv("53","764")+(amount>0?tlv("54",Number(amount).toFixed(2)):"")+tlv("58","TH")+"6304";
  return body+crc16(body);
}
const qrUrl=(p,s=220)=>p?`https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&data=${encodeURIComponent(p)}`:null;

// ══ GAS API ═════════════════════════════════════
async function gasGet(action="getData"){
  const res=await fetch(`${GAS_URL}?action=${action}`);
  return res.json();
}
function gasSync(payload){
  fetch(GAS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).catch(()=>{});
  return new Promise(resolve=>setTimeout(async()=>{ try{resolve(await gasGet());}catch{resolve({ok:false});} },2200));
}
async function gasPostRead(payload){
  try{
    const res=await fetch(GAS_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    return res.json();
  }catch{
    await fetch(GAS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).catch(()=>{});
    await new Promise(r=>setTimeout(r,2000));
    return {ok:true};
  }
}
const gasNotify=p=>fetch(GAS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"notifyEmail",...p})}).catch(()=>{});
const gasNotifyLine=p=>fetch(GAS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"notifyLine",...p})}).catch(()=>{});

// ══ Image compress ═══════════════════════════════
function compressImage(file,maxPx=400){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const s=Math.min(1,maxPx/Math.max(img.width,img.height));
      const c=document.createElement("canvas");
      c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);
      c.getContext("2d").drawImage(img,0,0,c.width,c.height);
      resolve(c.toDataURL("image/jpeg",0.75));
    };
    img.src=URL.createObjectURL(file);
  });
}

// ══ Helpers ══════════════════════════════════════
const TODAY  = new Date().toISOString().slice(0,10);
const fmt    = n=>Number(n).toLocaleString("th-TH");
const initial= name=>(name||"?").trim().charAt(0);
const aColor = name=>["#e07b39","#3b82f6","#22c55e","#a855f7","#ef4444","#f59e0b","#06b6d4"][(name||"").charCodeAt(0)%7];
const thDate = d=>{if(!d)return"";try{return new Date(d).toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"2-digit"});}catch{return d;}};

// Interest calc: daily compound
function calcInterest(tx){
  if(!tx.interestRate||!tx.dueDate||tx.paid) return 0;
  const due=new Date(tx.dueDate);
  const now=new Date();
  if(now<=due) return 0;
  const days=Math.floor((now-due)/(1000*60*60*24));
  return Math.round(tx.total*(tx.interestRate/100/30)*days);
}

// ══ Notification Builders ════════════════════════
// แยกชัดเจน เจ้าหนี้ / ลูกหนี้

const SHOP_NAME = "ร้านอ้อ";

function lineDebtMsg(c, items, total, due, ir) {
  // สำหรับ เจ้าหนี้ (admin)
  const itemLines = items.map(i=>`• ${i.name} — ฿${fmt(i.price)}`).join("\n");
  const newTotal  = (c.totalDebt||0) + total;
  return (
    `📝 บันทึกหนี้ใหม่ — ${SHOP_NAME}\n` +
    `══════════════════\n` +
    `🏪 เจ้าหนี้: ${SHOP_NAME}\n` +
    `👤 ลูกหนี้: ${c.name}\n` +
    `📅 วันที่:  ${thDate(TODAY)}\n` +
    (due ? `⏰ ทวง:    ${thDate(due)}\n` : "") +
    (ir > 0 ? `💹 ดอกเบี้ย: ${ir}%/เดือน\n` : "") +
    `──────────────────\n` +
    `${itemLines}\n` +
    `══════════════════\n` +
    `💰 รวมครั้งนี้:  ฿${fmt(total)}\n` +
    `📊 ยอดค้างรวม: ฿${fmt(newTotal)}\n` +
    `══════════════════`
  );
}

function linePaidMsg(c, amt) {
  // สำหรับ เจ้าหนี้ (admin)
  const remaining = Math.max(0, (c.totalDebt||0) - amt);
  return (
    `💰 รับชำระแล้ว — ${SHOP_NAME}\n` +
    `══════════════════\n` +
    `🏪 เจ้าหนี้: ${SHOP_NAME}\n` +
    `👤 ลูกหนี้: ${c.name}\n` +
    `📅 วันที่:  ${thDate(TODAY)}\n` +
    `──────────────────\n` +
    `💵 รับชำระ:  ฿${fmt(amt)}\n` +
    `📊 ยอดเดิม:  ฿${fmt(c.totalDebt||0)}\n` +
    `══════════════════\n` +
    (remaining > 0
      ? `⚠️ ยังค้างอยู่: ฿${fmt(remaining)}`
      : `✅ ชำระครบแล้ว! ไม่มียอดค้าง`)
  );
}

// Email builders
function buildDebtEmail(c, items, total, due, interest) {
  const newTotal = (c.totalDebt||0) + total;
  const rows = items.map(i=>`<tr><td style="padding:4px 8px;">${i.name}</td><td style="padding:4px 8px;text-align:right;font-weight:600;">฿${fmt(i.price)}</td></tr>`).join("");
  return {
    subject: `📝 [ร้านอ้อ] บันทึกหนี้ใหม่ — ${c.name} ฿${fmt(total)}`,
    htmlBody: `
      <div style="font-size:13px;border:2px solid #1a3a2a;border-radius:12px;overflow:hidden;max-width:460px;">
        <div style="background:#1a3a2a;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;">
          <span style="font-weight:800;font-size:15px;">📝 บันทึกหนี้ใหม่</span>
          <span style="opacity:.7;">${thDate(TODAY)}</span>
        </div>
        <div style="background:#f9fafb;padding:12px 16px;border-bottom:1px solid #e5e7eb;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="color:#6b7280;padding:3px 0;">🏪 เจ้าหนี้</td><td style="font-weight:700;text-align:right;">${SHOP_NAME}</td></tr>
            <tr><td style="color:#6b7280;padding:3px 0;">👤 ลูกหนี้</td><td style="font-weight:700;text-align:right;color:#1a3a2a;">${c.name}</td></tr>
            ${due?`<tr><td style="color:#6b7280;padding:3px 0;">⏰ ครบกำหนด</td><td style="text-align:right;color:#f59e0b;">${thDate(due)}</td></tr>`:""}
            ${interest>0?`<tr><td style="color:#6b7280;padding:3px 0;">💹 ดอกเบี้ย</td><td style="text-align:right;color:#f59e0b;">${interest}% / เดือน</td></tr>`:""}
          </table>
        </div>
        <div style="padding:12px 16px;">
          <div style="font-weight:700;margin-bottom:8px;color:#374151;">รายการสินค้า</div>
          <table style="width:100%;border-collapse:collapse;">${rows}</table>
        </div>
        <div style="background:#fff7ed;padding:12px 16px;border-top:2px solid #f59e0b;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="font-weight:700;">💰 รวมครั้งนี้</td><td style="text-align:right;font-weight:800;font-size:16px;color:#f59e0b;">฿${fmt(total)}</td></tr>
            <tr><td style="color:#6b7280;padding-top:4px;">ยอดค้างเดิม</td><td style="text-align:right;color:#6b7280;">฿${fmt(c.totalDebt||0)}</td></tr>
            <tr><td style="font-weight:800;padding-top:6px;border-top:1px dashed #e5e7eb;">📊 ยอดค้างรวมใหม่</td><td style="text-align:right;font-weight:800;font-size:17px;color:#ef4444;border-top:1px dashed #e5e7eb;">฿${fmt(newTotal)}</td></tr>
          </table>
        </div>
      </div>`,
    body: `[ร้านอ้อ] บันทึกหนี้
ลูกหนี้: ${c.name}
รวม: ฿${fmt(total)}
ยอดค้างรวม: ฿${fmt(newTotal)}`
  };
}

function buildPaidEmail(c, amt) {
  const remaining = Math.max(0, (c.totalDebt||0) - amt);
  return {
    subject: `💰 [ร้านอ้อ] รับชำระ — ${c.name} ฿${fmt(amt)}`,
    htmlBody: `
      <div style="font-size:13px;border:2px solid #22c55e;border-radius:12px;overflow:hidden;max-width:460px;">
        <div style="background:#15803d;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;">
          <span style="font-weight:800;font-size:15px;">💰 รับชำระแล้ว</span>
          <span style="opacity:.7;">${thDate(TODAY)}</span>
        </div>
        <div style="background:#f9fafb;padding:12px 16px;border-bottom:1px solid #e5e7eb;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="color:#6b7280;padding:3px 0;">🏪 เจ้าหนี้</td><td style="font-weight:700;text-align:right;">${SHOP_NAME}</td></tr>
            <tr><td style="color:#6b7280;padding:3px 0;">👤 ลูกหนี้</td><td style="font-weight:700;text-align:right;color:#1a3a2a;">${c.name}</td></tr>
            <tr><td style="color:#6b7280;padding:3px 0;">📅 วันที่</td><td style="text-align:right;">${thDate(TODAY)}</td></tr>
          </table>
        </div>
        <div style="padding:12px 16px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="color:#6b7280;padding:3px 0;">💵 รับชำระ</td><td style="text-align:right;font-weight:800;font-size:17px;color:#15803d;">฿${fmt(amt)}</td></tr>
            <tr><td style="color:#6b7280;padding:3px 0;">ยอดเดิม</td><td style="text-align:right;color:#6b7280;">฿${fmt(c.totalDebt||0)}</td></tr>
          </table>
        </div>
        <div style="background:${remaining>0?"#fef2f2":"#f0fdf4"};padding:12px 16px;border-top:2px solid ${remaining>0?"#ef4444":"#22c55e"};text-align:center;">
          ${remaining>0
            ? `<span style="color:#ef4444;font-weight:800;font-size:16px;">⚠️ ยังค้างอยู่: ฿${fmt(remaining)}</span>`
            : `<span style="color:#15803d;font-weight:800;font-size:16px;">✅ ชำระครบแล้ว!</span>`}
        </div>
      </div>`,
    body: `[ร้านอ้อ] รับชำระ
ลูกหนี้: ${c.name}
จำนวน: ฿${fmt(amt)}
ยอดคงเหลือ: ${remaining>0?"฿"+fmt(remaining):"ชำระครบ!"}`
  };
}

// ══ Toast ════════════════════════════════════════
function Toast({msg,icon="✅"}){
  return <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",background:"#1a3a2a",color:"#fff",padding:"10px 20px",borderRadius:100,fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em",fontWeight:600,zIndex:3000,boxShadow:"0 4px 20px rgba(0,0,0,.3)",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:8}}>{icon} {msg}</div>;
}

// ══ PIN Screen ═══════════════════════════════════
function PinScreen({onSuccess,onCancel}){
  const [digits,setDigits]=useState([]);
  const [shake,setShake]=useState(false);
  const [err,setErr]=useState(false);
  const press=d=>{
    if(digits.length>=4)return;
    const next=[...digits,d];setDigits(next);
    if(next.length===4){
      if(next.join("")===CORRECT_PIN){setTimeout(onSuccess,200);}
      else{setShake(true);setErr(true);setTimeout(()=>{setDigits([]);setShake(false);setErr(false);},700);}
    }
  };
  const KEYS=["1","2","3","4","5","6","7","8","9","","0","⌫"];
  return(
    <div style={{position:"fixed",inset:0,background:"linear-gradient(160deg,#1a3a2a,#0d1f17)",zIndex:1000,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Sarabun',sans-serif"}}>
      <div style={{fontSize:32,marginBottom:8}}>🔒</div>
      <div style={{color:"#fff",fontWeight:700,fontSize:"1.2em",marginBottom:36}}>รหัสผ่าน ตั้งค่า</div>
      <div style={{display:"flex",gap:16,marginBottom:36,animation:shake?"shake .5s":"none"}}>
        {[0,1,2,3].map(i=><div key={i} style={{width:18,height:18,borderRadius:"50%",border:"2px solid rgba(255,255,255,.4)",background:digits.length>i?(err?"#ef4444":"#22c55e"):"transparent",transition:"background .15s"}} />)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,width:240}}>
        {KEYS.map((k,i)=>(
          <button key={i} onClick={()=>k==="⌫"?setDigits(d=>d.slice(0,-1)):k?press(k):null} disabled={!k}
            style={{height:64,borderRadius:16,border:"none",background:k?"rgba(255,255,255,.1)":"transparent",color:"#fff",fontSize:k==="⌫"?"1.4em":"1.5em",fontWeight:600,cursor:k?"pointer":"default",fontFamily:"'Sarabun',sans-serif"}}>{k}</button>
        ))}
      </div>
      <button onClick={onCancel} style={{marginTop:28,background:"none",border:"none",color:"rgba(255,255,255,.45)",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em"}}>← ยกเลิก</button>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
    </div>
  );
}

// ══ Avatar ═══════════════════════════════════════
function Avatar({c,size=48}){
  return(
    <div style={{width:size,height:size,borderRadius:"50%",background:aColor(c?.name||""),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:Math.round(size*.4),flexShrink:0,overflow:"hidden",border:`2px solid ${aColor(c?.name||"")}44`}}>
      {c?.photo?<img src={c.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>e.target.style.display="none"} />:initial(c?.name||"?")}
    </div>
  );
}

// ══ Photo Upload ══════════════════════════════════
function PhotoUploadBtn({customerId,onUploaded}){
  const [state,setState]=useState("idle");
  const ref=useRef();
  const handle=async e=>{
    const f=e.target.files[0];if(!f)return;
    setState("uploading");
    try{
      const b64=await compressImage(f,400);
      const res=await gasPostRead({action:"savePhoto",customerId,base64:b64,mimeType:"image/jpeg"});
      if(res.ok&&res.photoUrl){onUploaded(res.photoUrl);setState("done");}
      else setState("error");
    }catch{setState("error");}
    setTimeout(()=>setState("idle"),2500);
  };
  return(
    <>
      <input ref={ref} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handle}/>
      <button onClick={()=>ref.current?.click()} disabled={state==="uploading"}
        style={{position:"absolute",bottom:0,right:0,background:state==="done"?"#22c55e":state==="error"?"#ef4444":"rgba(0,0,0,.65)",border:"2px solid #fff",borderRadius:"50%",width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:12,zIndex:2}}>
        {state==="uploading"?"⏳":state==="done"?"✅":state==="error"?"❌":"📷"}
      </button>
    </>
  );
}

// ══ Phone Edit ════════════════════════════════════
function PhoneEdit({phone,onSave}){
  const [editing, setEditing] = useState(false);
  const [val,     setVal]     = useState(phone||"");
  const inputRef = useRef();

  useEffect(()=>{ setVal(phone||""); },[phone]);
  useEffect(()=>{ if(editing&&inputRef.current) inputRef.current.focus(); },[editing]);

  const save=()=>{ onSave(val.trim()); setEditing(false); };
  const cancel=()=>{ setVal(phone||""); setEditing(false); };

  if(editing) return(
    <div style={{display:"flex",gap:6,alignItems:"center",marginTop:4}}>
      <input ref={inputRef} value={val} onChange={e=>setVal(e.target.value)}
        onKeyDown={e=>{if(e.key==="Enter")save();if(e.key==="Escape")cancel();}}
        type="tel" inputMode="tel" placeholder="0812345678"
        style={{flex:1,padding:"5px 10px",borderRadius:8,border:"1.5px solid rgba(255,255,255,.6)",background:"rgba(255,255,255,.15)",color:"#fff",fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em",outline:"none",width:0}}/>
      <button onClick={save} style={{background:"#22c55e",border:"none",borderRadius:8,padding:"5px 10px",color:"#fff",cursor:"pointer",fontWeight:700,fontSize:"0.82em",flexShrink:0}}>✓</button>
      <button onClick={cancel} style={{background:"rgba(255,255,255,.2)",border:"none",borderRadius:8,padding:"5px 10px",color:"#fff",cursor:"pointer",fontSize:"0.82em",flexShrink:0}}>✕</button>
    </div>
  );

  return(
    <div onClick={()=>setEditing(true)} style={{opacity:.85,fontSize:"0.9em",cursor:"pointer",display:"flex",alignItems:"center",gap:6,marginTop:2}}>
      <span>📞</span>
      <span style={{textDecoration:phone?"none":"underline dotted",opacity:phone?1:.7}}>
        {phone||"แตะเพื่อเพิ่มเบอร์โทร"}
      </span>
      <span style={{fontSize:"0.75em",opacity:.5}}>✏️</span>
    </div>
  );
}

// ══ Note Section ══════════════════════════════════
function NoteSection({c,onSave}){
  const [editing,  setEditing]  = useState(false);
  const [noteVal,  setNoteVal]  = useState(c.note||"");
  const [saving,   setSaving]   = useState(false);
  const taRef = useRef();

  useEffect(()=>{ if(editing&&taRef.current) taRef.current.focus(); },[editing]);

  const save=async()=>{
    setSaving(true);
    await onSave(noteVal);
    setSaving(false);
    setEditing(false);
  };

  const cancel=()=>{ setNoteVal(c.note||""); setEditing(false); };

  return(
    <div style={{background:"#fff",borderRadius:14,padding:14,marginBottom:10,boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontWeight:700,color:"#1a3a2a",display:"flex",alignItems:"center",gap:6}}>
          <span>📝</span><span>Note</span>
        </div>
        {!editing&&(
          <button onClick={()=>setEditing(true)}
            style={{background:"#eff6ff",border:"1.5px solid #3b82f6",borderRadius:8,padding:"4px 12px",cursor:"pointer",color:"#3b82f6",fontWeight:600,fontSize:"0.82em",fontFamily:"'Sarabun',sans-serif"}}>
            ✏️ {c.note?"แก้ไข":"เพิ่ม Note"}
          </button>
        )}
      </div>

      {editing?(
        <>
          <textarea ref={taRef} value={noteVal} onChange={e=>setNoteVal(e.target.value)}
            placeholder="เพิ่ม Note เช่น บ้านใกล้วัด, จ่ายทุกสิ้นเดือน, ห้ามลืมทวง..."
            rows={4}
            style={{width:"100%",padding:"10px 12px",border:"1.5px solid #3b82f6",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em",boxSizing:"border-box",outline:"none",resize:"vertical",lineHeight:1.6}}/>
          <div style={{display:"flex",gap:8,marginTop:8}}>
            <button onClick={cancel} style={{flex:1,padding:"9px 0",background:"#f3f4f6",border:"none",borderRadius:10,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",color:"#374151",fontSize:"0.9em"}}>ยกเลิก</button>
            <button onClick={save} disabled={saving}
              style={{flex:2,padding:"9px 0",background:saving?"#9ca3af":"#1a7a4a",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:saving?"default":"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em"}}>
              {saving?"⏳ กำลังบันทึก...":"💾 บันทึก Note"}
            </button>
          </div>
        </>
      ):(
        c.note?(
          <div style={{background:"#fffbeb",borderRadius:10,padding:"10px 14px",color:"#374151",fontSize:"0.9em",lineHeight:1.7,border:"1px solid #fde68a",whiteSpace:"pre-wrap"}}>
            {c.note}
          </div>
        ):(
          <div onClick={()=>setEditing(true)} style={{background:"#f9fafb",borderRadius:10,padding:"12px 14px",color:"#9ca3af",fontSize:"0.88em",textAlign:"center",cursor:"pointer",border:"1.5px dashed #e5e7eb"}}>
            + แตะเพื่อเพิ่ม Note ของลูกค้าคนนี้
          </div>
        )
      )}
    </div>
  );
}

// ══ QR Modal ═════════════════════════════════════
function QRModal({c,settings,onPaid,onClose}){
  const ppId=settings?.promptpayId||DEFAULT_QR;
  const [amount,setAmount]=useState(String(c.totalDebt>0?c.totalDebt:""));
  const [state,setState]=useState("idle");
  const amt=Number(amount)||0;
  const payload=genQR(ppId,amt);
  const imgUrl=qrUrl(payload);

  const handleConfirm=async()=>{
    const a=amt||c.totalDebt;
    setState("sending");
    const emailData=buildPaidEmail(c,a);
    gasNotify({...emailData,extraEmails:settings?.adminEmails||[]});
    if(settings?.channelToken&&(settings?.adminLineUids||[]).length>0){
      gasNotifyLine({channelToken:settings.channelToken,uids:settings.adminLineUids,
          message:linePaidMsg(c,a),photoUrl:c.photo||null});
    }
    await onPaid(a);
    setState("done");
  };

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:999,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:480,padding:24,paddingBottom:40}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div>
            <div style={{fontWeight:800,fontSize:"1.15em",color:"#1a3a2a"}}>💳 QR รับชำระเงิน</div>
            <div style={{color:"#6b7280",fontSize:"0.85em"}}>{c.name} · ค้างอยู่ ฿{fmt(c.totalDebt)}</div>
          </div>
          <button onClick={onClose} style={{background:"#f3f4f6",border:"none",borderRadius:"50%",width:36,height:36,cursor:"pointer",fontSize:18}}>✕</button>
        </div>

        {/* Amount input */}
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <input type="number" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="จำนวนเงิน"
            style={{flex:1,padding:"12px 14px",border:"2px solid #1a7a4a",borderRadius:12,fontFamily:"'Sarabun',sans-serif",fontSize:"1.3em",fontWeight:700,color:"#1a3a2a",outline:"none"}}/>
          <button onClick={()=>setAmount(String(c.totalDebt))}
            style={{padding:"10px 12px",background:"#f0fdf4",border:"1.5px solid #22c55e",borderRadius:10,color:"#15803d",fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",lineHeight:1.4}}>
            เต็ม<br/>฿{fmt(c.totalDebt)}
          </button>
        </div>

        {/* QR Display */}
        {!ppId||ppId.length<8?(
          <div style={{background:"#fff7ed",borderRadius:14,padding:20,textAlign:"center",marginBottom:16}}>
            <div style={{fontSize:32,marginBottom:8}}>⚠️</div>
            <div style={{fontWeight:700,color:"#92400e"}}>ยังไม่ได้ตั้งค่าเบอร์ PromptPay</div>
            <div style={{color:"#b45309",fontSize:"0.85em",marginTop:4}}>ไปที่ ⚙️ ตั้งค่า → PromptPay</div>
          </div>
        ):(
          <div style={{textAlign:"center",marginBottom:16}}>
            <div style={{display:"inline-block",padding:10,background:"#fff",borderRadius:16,boxShadow:"0 4px 20px rgba(0,0,0,.12)",border:"3px solid #06c755"}}>
              {imgUrl
                ? <img src={imgUrl} alt="QR" width={200} height={200} style={{display:"block",borderRadius:8}}/>
                : <div style={{width:200,height:200,display:"flex",alignItems:"center",justifyContent:"center",color:"#9ca3af"}}>สร้าง QR...</div>
              }
            </div>
            <div style={{marginTop:8,fontWeight:700,fontSize:"1.1em",color:"#1a3a2a"}}>{amt>0?`฿${fmt(amt)}`:"ไม่ระบุจำนวน"}</div>
            <div style={{fontSize:"0.78em",color:"#6b7280"}}>PromptPay: {ppId}</div>
          </div>
        )}

        <div style={{background:"#f0fdf4",borderRadius:10,padding:"8px 12px",marginBottom:14,fontSize:"0.8em",color:"#15803d",display:"flex",gap:6}}>
          <span>📧</span><span>จะแจ้งเตือน <b>{1+(settings?.adminEmails||[]).length}</b> อีเมล{settings?.channelToken?` + LINE <b>${(settings?.adminLineUids||[]).length}</b> คน`:""}</span>
        </div>

        <button onClick={handleConfirm} disabled={state!=="idle"}
          style={{width:"100%",padding:"14px 0",background:state==="idle"?"#1a7a4a":state==="done"?"#22c55e":"#9ca3af",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.05em",cursor:state==="idle"?"pointer":"default",fontFamily:"'Sarabun',sans-serif",transition:"background .2s"}}>
          {state==="idle"?"✅ ยืนยันรับเงิน + แจ้งเตือน":state==="done"?"✅ บันทึกแล้ว!":"⏳ กำลังบันทึก..."}
        </button>
      </div>
    </div>
  );
}

// ══ Edit Debt Modal ════════════════════════════════
function EditDebtModal({tx,customer,onSave,onClose}){
  const [items,setItems]=useState(tx.items.map(it=>({...it,price:String(it.price)})));
  const [interestRate,setInterestRate]=useState(String(tx.interestRate||0));
  const [dueDate,setDueDate]=useState(tx.dueDate||"");
  const total=items.reduce((s,it)=>s+(parseFloat(it.price)||0),0);
  const addItem=()=>setItems(p=>[...p,{name:"",price:""}]);
  const upd=(i,f,v)=>setItems(p=>{const a=[...p];a[i]={...a[i],[f]:v};return a;});
  const save=()=>onSave(tx.id,items.filter(it=>it.name||it.price).map(it=>({name:it.name||"รายการ",price:parseFloat(it.price)||0})),total,parseFloat(interestRate)||0,dueDate);
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:998,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:480,padding:20,paddingBottom:36,maxHeight:"85vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div><div style={{fontWeight:800,color:"#1a3a2a"}}>✏️ แก้ไขรายการ</div><div style={{color:"#6b7280",fontSize:"0.82em"}}>📅 {tx.date}</div></div>
          <button onClick={onClose} style={{background:"#f3f4f6",border:"none",borderRadius:"50%",width:36,height:36,cursor:"pointer",fontSize:18}}>✕</button>
        </div>
        {items.map((it,i)=>(
          <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
            <input value={it.name} onChange={e=>upd(i,"name",e.target.value)} placeholder="ชื่อสินค้า" style={{flex:2,padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",outline:"none"}}/>
            <input value={it.price} onChange={e=>upd(i,"price",e.target.value)} placeholder="฿" type="number" inputMode="decimal" style={{flex:1,padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",outline:"none"}}/>
            <button onClick={()=>setItems(p=>p.filter((_,idx)=>idx!==i))} style={{background:"#fee2e2",border:"none",borderRadius:8,padding:"8px 10px",cursor:"pointer",color:"#ef4444",fontWeight:700}}>🗑</button>
          </div>
        ))}
        <button onClick={addItem} style={{width:"100%",padding:"9px 0",background:"#f0fdf4",border:"1.5px dashed #22c55e",borderRadius:10,color:"#15803d",fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em",marginTop:4}}>+ เพิ่มรายการ</button>
        <div style={{display:"flex",justifyContent:"space-between",padding:"12px",background:"#f9fafb",borderRadius:10,margin:"12px 0",fontWeight:700}}>
          <span>รวม</span><span>฿{fmt(total)}</span>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize:"0.82em",color:"#6b7280",marginBottom:4}}>📅 วันทวง</div>
            <input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} style={{width:"100%",padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em",boxSizing:"border-box",outline:"none"}}/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:"0.82em",color:"#6b7280",marginBottom:4}}>💰 ดอกเบี้ย %/เดือน</div>
            <input type="number" inputMode="decimal" value={interestRate} onChange={e=>setInterestRate(e.target.value)} placeholder="0" style={{width:"100%",padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em",boxSizing:"border-box",outline:"none"}}/>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:"12px 0",background:"#f3f4f6",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",color:"#374151"}}>ยกเลิก</button>
          <button onClick={save} style={{flex:2,padding:"12px 0",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>💾 บันทึก</button>
        </div>
      </div>
    </div>
  );
}

// ══ Calendar View ══════════════════════════════════
function CalendarView({customers,transactions,onSelectDate}){
  const [month,setMonth]=useState(new Date());
  const year=month.getFullYear();
  const mo=month.getMonth();
  const firstDay=new Date(year,mo,1).getDay();
  const daysInMonth=new Date(year,mo+1,0).getDate();
  const thMonths=["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  // Build due-date map
  const dueMap={};
  transactions.forEach(tx=>{
    if(tx.paid)return;
    const d=tx.dueDate;
    if(!d)return;
    const dt=new Date(d);
    if(dt.getFullYear()===year&&dt.getMonth()===mo){
      const day=dt.getDate();
      if(!dueMap[day]) dueMap[day]={count:0,total:0,customers:[]};
      dueMap[day].count++;
      dueMap[day].total+=tx.total;
      const c=customers.find(x=>x.id===tx.customerId);
      if(c&&!dueMap[day].customers.includes(c.name)) dueMap[day].customers.push(c.name);
    }
  });
  const todayDate=new Date();
  const cells=[];
  for(let i=0;i<firstDay;i++) cells.push(null);
  for(let d=1;d<=daysInMonth;d++) cells.push(d);
  while(cells.length%7!==0) cells.push(null);

  return(
    <div style={{padding:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <button onClick={()=>setMonth(new Date(year,mo-1,1))} style={{background:"#f3f4f6",border:"none",borderRadius:10,padding:"8px 14px",cursor:"pointer",fontWeight:700,fontSize:"1em"}}>←</button>
        <div style={{fontWeight:800,fontSize:"1.1em",color:"#1a3a2a"}}>{thMonths[mo]} {year+543}</div>
        <button onClick={()=>setMonth(new Date(year,mo+1,1))} style={{background:"#f3f4f6",border:"none",borderRadius:10,padding:"8px 14px",cursor:"pointer",fontWeight:700,fontSize:"1em"}}>→</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:8}}>
        {["อา","จ","อ","พ","พฤ","ศ","ส"].map(d=><div key={d} style={{textAlign:"center",fontWeight:700,color:"#6b7280",fontSize:"0.8em",padding:"4px 0"}}>{d}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
        {cells.map((d,i)=>{
          if(!d) return <div key={i}/>;
          const isToday=d===todayDate.getDate()&&mo===todayDate.getMonth()&&year===todayDate.getFullYear();
          const hasDue=dueMap[d];
          const isPast=new Date(year,mo,d)<new Date(todayDate.getFullYear(),todayDate.getMonth(),todayDate.getDate());
          return(
            <div key={i} onClick={()=>hasDue&&onSelectDate&&onSelectDate(year,mo,d,dueMap[d])}
              style={{borderRadius:10,padding:"6px 2px",textAlign:"center",background:isToday?"#1a7a4a":hasDue?"#fef2f2":"transparent",border:isToday?"2px solid #1a7a4a":hasDue?"2px solid #ef4444":"2px solid transparent",cursor:hasDue?"pointer":"default",position:"relative"}}>
              <div style={{fontWeight:isToday||hasDue?700:400,color:isToday?"#fff":hasDue&&isPast?"#ef4444":hasDue?"#b91c1c":"#374151",fontSize:"0.9em"}}>{d}</div>
              {hasDue&&<div style={{fontSize:"0.6em",color:isToday?"rgba(255,255,255,.8)":"#ef4444",fontWeight:700}}>฿{fmt(hasDue.total)}</div>}
            </div>
          );
        })}
      </div>
      {Object.keys(dueMap).length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:24,fontSize:"0.9em"}}>ไม่มีวันทวงในเดือนนี้ ✨</div>}
    </div>
  );
}

// ══ Due Summary ════════════════════════════════════
function DueSummary({customers,transactions}){
  const now=new Date();
  const overdue=[];
  const upcoming=[];
  customers.forEach(c=>{
    const unpaid=transactions.filter(t=>t.customerId===c.id&&!t.paid);
    if(!unpaid.length)return;
    const due=c.dueDate;
    if(!due)return;
    const dueD=new Date(due);
    const interest=unpaid.reduce((s,t)=>s+calcInterest(t),0);
    const entry={...c,unpaidTx:unpaid,interest,daysLeft:Math.ceil((dueD-now)/(1000*60*60*24))};
    if(dueD<now) overdue.push(entry);
    else upcoming.push(entry);
  });
  overdue.sort((a,b)=>a.daysLeft-b.daysLeft);
  upcoming.sort((a,b)=>a.daysLeft-b.daysLeft);
  const Card=({c,past})=>(
    <div style={{background:"#fff",borderRadius:14,padding:14,marginBottom:10,boxShadow:"0 2px 8px rgba(0,0,0,.06)",borderLeft:`4px solid ${past?"#ef4444":"#f59e0b"}`}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <Avatar c={c} size={40}/>
        <div style={{flex:1}}>
          <div style={{fontWeight:700}}>{c.name}</div>
          <div style={{fontSize:"0.8em",color:past?"#ef4444":"#92400e"}}>{past?`เกินกำหนด ${Math.abs(c.daysLeft)} วัน`:`อีก ${c.daysLeft} วัน`} · ทวง {thDate(c.dueDate)}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontWeight:800,color:"#ef4444",fontSize:"1.1em"}}>฿{fmt(c.totalDebt)}</div>
          {c.interest>0&&<div style={{fontSize:"0.75em",color:"#dc2626"}}>ดอกเบี้ย +฿{fmt(c.interest)}</div>}
        </div>
      </div>
      {c.unpaidTx.map(tx=>(
        <div key={tx.id} style={{fontSize:"0.82em",color:"#6b7280",display:"flex",justifyContent:"space-between",padding:"2px 0"}}>
          <span>📅 {tx.date} ({tx.items?.length||0} รายการ)</span>
          <span style={{fontWeight:600}}>฿{fmt(tx.total)}{tx.interestRate?` (${tx.interestRate}%/เดือน)`:""}</span>
        </div>
      ))}
    </div>
  );
  return(
    <div style={{padding:16}}>
      {overdue.length>0&&<>
        <div style={{fontWeight:800,color:"#ef4444",marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
          <span>🔴</span><span>เกินกำหนดแล้ว ({overdue.length} ราย)</span>
        </div>
        {overdue.map(c=><Card key={c.id} c={c} past/>)}
      </>}
      {upcoming.length>0&&<>
        <div style={{fontWeight:800,color:"#f59e0b",margin:"16px 0 10px",display:"flex",alignItems:"center",gap:6}}>
          <span>🟡</span><span>ใกล้ถึงกำหนด ({upcoming.length} ราย)</span>
        </div>
        {upcoming.map(c=><Card key={c.id} c={c} past={false}/>)}
      </>}
      {overdue.length===0&&upcoming.length===0&&(
        <div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>✨ ไม่มีลูกหนี้ค้างกำหนด</div>
      )}
    </div>
  );
}

// ══ Report System ══════════════════════════════════
// A4 at 96dpi = 794 × 1123px

function loadHtml2Canvas(){
  return new Promise((resolve,reject)=>{
    if(window.html2canvas){resolve(window.html2canvas);return;}
    const s=document.createElement("script");
    s.src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload=()=>resolve(window.html2canvas);
    s.onerror=reject;
    document.head.appendChild(s);
  });
}

const REPORT_TYPES=[
  {id:"debtors",  label:"📋 รายชื่อลูกหนี้",  icon:"👥"},
  {id:"overdue",  label:"🔴 ค้างเกินกำหนด",  icon:"⚠️"},
  {id:"expenses", label:"🚛 รายจ่ายซื้อสด",   icon:"💸"},
  {id:"summary",  label:"📊 สรุปภาพรวม",      icon:"📈"},
];

function ReportView({customers,transactions,onClose,settings}){
  const [type,    setType]    = useState("debtors");
  const [month,   setMonth]   = useState(new Date().toISOString().slice(0,7));
  const [expenses,setExpenses]= useState([]);
  const [saving,  setSaving]  = useState(false);
  const [msg,     setMsg]     = useState("");
  const reportRef = useRef();

  const thMonths=["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  const [my,mm]=month.split("-");
  const monthLabel=`${thMonths[parseInt(mm)-1]} ${parseInt(my)+543}`;
  const today=new Date().toLocaleDateString("th-TH",{day:"numeric",month:"long",year:"numeric"});
  const genDate=`พิมพ์: ${today}`;

  // load expenses for month when needed
  useEffect(()=>{
    if(type!=="expenses") return;
    fetch(`${GAS_URL}?action=getExpenses&month=${month}`)
      .then(r=>r.json()).then(d=>{ if(d.ok) setExpenses(d.expenses||[]); }).catch(()=>{});
  },[type,month]);

  // ── Computed data ──
  const debtors     = customers.filter(c=>c.totalDebt>0).sort((a,b)=>b.totalDebt-a.totalDebt);
  const overdue     = customers.filter(c=>c.totalDebt>0&&c.dueDate&&c.dueDate<=TODAY).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const totalDebt   = debtors.reduce((s,c)=>s+c.totalDebt,0);
  const totalOver   = overdue.reduce((s,c)=>s+c.totalDebt,0);
  const totalExp    = expenses.reduce((s,e)=>s+e.total,0);

  // ── Print ──
  const doPrint=()=>{
    const orig=document.title;
    document.title=`รายงาน_${type}_${month}`;
    window.print();
    document.title=orig;
  };

  // ── Save JPG ──
  const doSaveJpg=async()=>{
    setSaving(true); setMsg("กำลังสร้างรูปภาพ...");
    try{
      const h2c=await loadHtml2Canvas();
      const canvas=await h2c(reportRef.current,{
        scale:2, useCORS:true, backgroundColor:"#ffffff",
        width:794, windowWidth:794,
        onclone:(doc)=>{
          const el=doc.getElementById("report-page");
          if(el){ el.style.boxShadow="none"; el.style.margin="0"; }
        }
      });
      const link=document.createElement("a");
      link.download=`รายงาน_${type}_${month}.jpg`;
      link.href=canvas.toDataURL("image/jpeg",0.95);
      link.click();
      setMsg("✅ บันทึกไฟล์แล้ว!");
    }catch(e){
      setMsg("❌ เกิดข้อผิดพลาด: "+e.message);
    }
    setSaving(false);
    setTimeout(()=>setMsg(""),3000);
  };

  // ── Shared styles ──
  const A4={
    width:794,minHeight:1123,background:"#fff",
    fontFamily:"'Sarabun',sans-serif",fontSize:13,
    color:"#111",lineHeight:1.5,
    padding:"40px 48px",boxSizing:"border-box",
  };
  const headerStyle={
    borderBottom:"3px solid #1a3a2a",paddingBottom:12,marginBottom:20,
    display:"flex",justifyContent:"space-between",alignItems:"flex-end"
  };
  const tableStyle={width:"100%",borderCollapse:"collapse",fontSize:12.5};
  const th={background:"#1a3a2a",color:"#fff",padding:"7px 10px",textAlign:"left",fontWeight:700};
  const td={padding:"6px 10px",borderBottom:"1px solid #e5e7eb"};
  const tdR={...td,textAlign:"right"};
  const altRow={background:"#f9fafb"};

  // ── Report Pages ──
  const ReportHeader=({title,subtitle})=>(
    <div style={headerStyle}>
      <div>
        <div style={{fontWeight:800,fontSize:18,color:"#1a3a2a"}}>🏪 {SHOP_NAME}</div>
        <div style={{fontWeight:700,fontSize:15,marginTop:2}}>{title}</div>
        {subtitle&&<div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{subtitle}</div>}
      </div>
      <div style={{textAlign:"right",fontSize:11,color:"#9ca3af"}}>
        <div>{genDate}</div>
        <div>{APP_VERSION}</div>
      </div>
    </div>
  );

  const ReportFooter=({rows,totalLabel,totalVal,color="#1a3a2a"})=>(
    <div style={{borderTop:"2px solid #1a3a2a",marginTop:8,paddingTop:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{fontSize:12,color:"#6b7280"}}>รวมทั้งหมด {rows} รายการ</div>
      <div style={{fontWeight:800,fontSize:16,color}}>{totalLabel}: ฿{fmt(totalVal)}</div>
    </div>
  );

  return(
    <div style={{position:"fixed",inset:0,background:"#e5e7eb",zIndex:989,display:"flex",flexDirection:"column",fontFamily:"'Sarabun',sans-serif"}}>

      {/* ── Control bar ── */}
      <div className="no-print" style={{background:"#1a3a2a",color:"#fff",padding:"12px 16px",display:"flex",alignItems:"center",gap:10,flexShrink:0,flexWrap:"wrap"}}>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer",flexShrink:0}}>←</button>
        <span style={{fontWeight:800,fontSize:"1em",marginRight:8}}>📄 รายงาน</span>

        {/* Report type */}
        <div style={{display:"flex",gap:6,flex:1,flexWrap:"wrap"}}>
          {REPORT_TYPES.map(r=>(
            <button key={r.id} onClick={()=>setType(r.id)}
              style={{padding:"5px 12px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.8em",fontWeight:type===r.id?700:400,
                background:type===r.id?"#fff":"rgba(255,255,255,.15)",color:type===r.id?"#1a3a2a":"rgba(255,255,255,.8)"}}>
              {r.icon} {r.label.replace(/^[^ ]+ /,"")}
            </button>
          ))}
        </div>

        {/* Month picker (for expenses) */}
        {(type==="expenses")&&(
          <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
            style={{padding:"4px 8px",borderRadius:8,border:"none",fontFamily:"'Sarabun',sans-serif",fontSize:"0.85em",cursor:"pointer"}}/>
        )}

        {/* Action buttons */}
        <div style={{display:"flex",gap:8,flexShrink:0}}>
          {msg&&<span style={{fontSize:"0.82em",padding:"4px 10px",background:"rgba(255,255,255,.15)",borderRadius:8}}>{msg}</span>}
          <button onClick={doPrint}
            style={{padding:"8px 16px",background:"rgba(255,255,255,.15)",border:"1.5px solid rgba(255,255,255,.4)",borderRadius:10,color:"#fff",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:"0.9em",display:"flex",alignItems:"center",gap:6}}>
            🖨️ พิมพ์
          </button>
          <button onClick={doSaveJpg} disabled={saving}
            style={{padding:"8px 16px",background:"#22c55e",border:"none",borderRadius:10,color:"#fff",cursor:saving?"wait":"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:"0.9em",display:"flex",alignItems:"center",gap:6,opacity:saving?.7:1}}>
            {saving?"⏳":"📸"} บันทึก JPG
          </button>
        </div>
      </div>

      {/* ── A4 Preview ── */}
      <div style={{flex:1,overflowY:"auto",padding:"24px",display:"flex",justifyContent:"center",alignItems:"flex-start"}}>
        <div ref={reportRef} id="report-page" style={{...A4,boxShadow:"0 8px 40px rgba(0,0,0,.2)",borderRadius:4}}>

          {/* ════ REPORT: DEBTORS ════ */}
          {type==="debtors"&&(
            <>
              <ReportHeader title="รายงานลูกหนี้ทั้งหมด" subtitle={`ณ วันที่ ${today}`}/>
              {debtors.length===0?(
                <div style={{textAlign:"center",padding:60,color:"#9ca3af"}}>✅ ไม่มีลูกหนี้ค้างชำระ</div>
              ):(
                <>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={{...th,width:28}}>#</th>
                        <th style={th}>ชื่อ-สกุล</th>
                        <th style={th}>เบอร์โทร</th>
                        <th style={{...th,textAlign:"right"}}>ยอดค้าง (฿)</th>
                        <th style={{...th,textAlign:"center"}}>วันทวง</th>
                        <th style={{...th,textAlign:"center"}}>สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {debtors.map((c,i)=>{
                        const isOv=c.dueDate&&c.dueDate<=TODAY;
                        return(
                          <tr key={c.id} style={i%2===1?altRow:{}}>
                            <td style={{...td,color:"#9ca3af",textAlign:"center"}}>{i+1}</td>
                            <td style={{...td,fontWeight:600}}>{c.name}</td>
                            <td style={{...td,color:"#6b7280"}}>{c.phone||"-"}</td>
                            <td style={{...tdR,fontWeight:700,color:"#ef4444"}}>฿{fmt(c.totalDebt)}</td>
                            <td style={{...td,textAlign:"center",color:isOv?"#ef4444":"#374151"}}>{thDate(c.dueDate)||"-"}</td>
                            <td style={{...td,textAlign:"center"}}>
                              <span style={{background:isOv?"#fef2f2":"#fff7ed",color:isOv?"#ef4444":"#f59e0b",padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:700}}>
                                {isOv?"เกินกำหนด":"ค้างชำระ"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <ReportFooter rows={debtors.length} totalLabel="รวมยอดค้าง" totalVal={totalDebt} color="#ef4444"/>
                  {/* Note area */}
                  <div style={{marginTop:40,borderTop:"1px dashed #e5e7eb",paddingTop:16}}>
                    <div style={{fontSize:11,color:"#9ca3af",marginBottom:8}}>หมายเหตุ / Note:</div>
                    <div style={{height:60,borderBottom:"1px solid #e5e7eb"}}/>
                  </div>
                  <div style={{marginTop:32,display:"grid",gridTemplateColumns:"1fr 1fr",gap:40}}>
                    <div style={{textAlign:"center"}}>
                      <div style={{height:1,background:"#374151",marginBottom:8}}/>
                      <div style={{fontSize:11,color:"#6b7280"}}>ผู้จัดทำรายงาน</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{height:1,background:"#374151",marginBottom:8}}/>
                      <div style={{fontSize:11,color:"#6b7280"}}>ผู้ตรวจสอบ</div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* ════ REPORT: OVERDUE ════ */}
          {type==="overdue"&&(
            <>
              <ReportHeader title="รายงานลูกหนี้ค้างเกินกำหนด" subtitle={`ณ วันที่ ${today}`}/>
              {overdue.length===0?(
                <div style={{textAlign:"center",padding:60,color:"#22c55e",fontSize:16}}>✅ ไม่มีลูกหนี้เกินกำหนด!</div>
              ):(
                <>
                  <div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#b91c1c"}}>
                    ⚠️ พบลูกหนี้ที่เกินกำหนดชำระทั้งหมด {overdue.length} ราย รวมยอด ฿{fmt(totalOver)}
                  </div>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={{...th,width:28}}>#</th>
                        <th style={th}>ชื่อ-สกุล</th>
                        <th style={th}>เบอร์โทร</th>
                        <th style={{...th,textAlign:"right"}}>ยอดค้าง (฿)</th>
                        <th style={{...th,textAlign:"center"}}>กำหนดชำระ</th>
                        <th style={{...th,textAlign:"center"}}>เกิน (วัน)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overdue.map((c,i)=>{
                        const days=c.dueDate?Math.floor((new Date()-new Date(c.dueDate))/(86400000)):0;
                        return(
                          <tr key={c.id} style={{background:i%2===1?"#fff5f5":"#fef2f2"}}>
                            <td style={{...td,textAlign:"center",color:"#9ca3af"}}>{i+1}</td>
                            <td style={{...td,fontWeight:700,color:"#b91c1c"}}>{c.name}</td>
                            <td style={{...td,color:"#6b7280"}}>{c.phone||"-"}</td>
                            <td style={{...tdR,fontWeight:800,color:"#ef4444"}}>฿{fmt(c.totalDebt)}</td>
                            <td style={{...td,textAlign:"center",color:"#ef4444"}}>{thDate(c.dueDate)||"-"}</td>
                            <td style={{...td,textAlign:"center"}}>
                              <span style={{background:"#ef4444",color:"#fff",padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:700}}>{days} วัน</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <ReportFooter rows={overdue.length} totalLabel="รวมยอดค้างเกินกำหนด" totalVal={totalOver} color="#ef4444"/>
                </>
              )}
            </>
          )}

          {/* ════ REPORT: EXPENSES ════ */}
          {type==="expenses"&&(
            <>
              <ReportHeader title={`รายงานรายจ่ายซื้อสด — ${monthLabel}`} subtitle="โหมดรถส่งของ"/>
              {expenses.length===0?(
                <div style={{textAlign:"center",padding:60,color:"#9ca3af"}}>ไม่มีรายจ่ายในเดือนนี้</div>
              ):(
                <>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={{...th,width:28}}>#</th>
                        <th style={{...th,width:90}}>วันที่</th>
                        <th style={th}>ร้านค้า / ซัพพลายเออร์</th>
                        <th style={th}>รายการ</th>
                        <th style={{...th,textAlign:"right"}}>จำนวน (฿)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...expenses].sort((a,b)=>a.date.localeCompare(b.date)).map((e,i)=>(
                        <tr key={e.id} style={i%2===1?altRow:{}}>
                          <td style={{...td,textAlign:"center",color:"#9ca3af"}}>{i+1}</td>
                          <td style={{...td,color:"#6b7280",fontSize:11}}>{thDate(e.date)}</td>
                          <td style={{...td,fontWeight:600}}>{e.supplier||"-"}</td>
                          <td style={{...td,color:"#374151",fontSize:11}}>
                            {(e.items||[]).slice(0,3).map(it=>it.name).join(", ")}
                            {(e.items||[]).length>3?`... +${(e.items||[]).length-3}`:""}{e.note?` (${e.note})`:""}
                          </td>
                          <td style={{...tdR,fontWeight:700}}>฿{fmt(e.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <ReportFooter rows={expenses.length} totalLabel="รวมจ่ายออก" totalVal={totalExp} color="#2563eb"/>
                </>
              )}
            </>
          )}

          {/* ════ REPORT: SUMMARY ════ */}
          {type==="summary"&&(
            <>
              <ReportHeader title="รายงานสรุปภาพรวม" subtitle={`ณ วันที่ ${today}`}/>
              {/* KPI boxes */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:20}}>
                {[
                  {label:"ลูกหนี้ทั้งหมด",value:`${debtors.length} ราย`,color:"#f59e0b",bg:"#fffbeb"},
                  {label:"ยอดค้างรวม",value:`฿${fmt(totalDebt)}`,color:"#ef4444",bg:"#fef2f2"},
                  {label:"เกินกำหนด",value:`${overdue.length} ราย`,color:"#dc2626",bg:"#fff5f5"},
                  {label:"ลูกค้าทั้งหมด",value:`${customers.length} คน`,color:"#1a3a2a",bg:"#f0fdf4"},
                  {label:"บันทึกวันนี้",value:`${transactions.filter(t=>t.date===TODAY).length} รายการ`,color:"#2563eb",bg:"#eff6ff"},
                  {label:"ชำระครบแล้ว",value:`${customers.filter(c=>c.totalDebt===0).length} คน`,color:"#22c55e",bg:"#f0fdf4"},
                ].map((k,i)=>(
                  <div key={i} style={{background:k.bg,borderRadius:10,padding:"12px 14px",border:`1px solid ${k.color}33`}}>
                    <div style={{fontSize:11,color:"#6b7280",marginBottom:4}}>{k.label}</div>
                    <div style={{fontWeight:800,fontSize:16,color:k.color}}>{k.value}</div>
                  </div>
                ))}
              </div>
              {/* Top debtors */}
              <div style={{marginBottom:16}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:"#1a3a2a"}}>🔴 TOP ลูกหนี้ยอดสูงสุด</div>
                <table style={tableStyle}>
                  <thead><tr>
                    <th style={{...th,width:28}}>#</th>
                    <th style={th}>ชื่อ</th>
                    <th style={{...th,textAlign:"right"}}>ยอดค้าง</th>
                    <th style={{...th,textAlign:"center"}}>กำหนดชำระ</th>
                  </tr></thead>
                  <tbody>
                    {debtors.slice(0,10).map((c,i)=>(
                      <tr key={c.id} style={i%2===1?altRow:{}}>
                        <td style={{...td,textAlign:"center",color:"#9ca3af"}}>{i+1}</td>
                        <td style={{...td,fontWeight:600}}>{c.name}</td>
                        <td style={{...tdR,color:"#ef4444",fontWeight:700}}>฿{fmt(c.totalDebt)}</td>
                        <td style={{...td,textAlign:"center",color:c.dueDate&&c.dueDate<=TODAY?"#ef4444":"#374151"}}>{thDate(c.dueDate)||"-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Recent transactions */}
              <div>
                <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:"#1a3a2a"}}>📋 รายการล่าสุด (10 รายการ)</div>
                <table style={tableStyle}>
                  <thead><tr>
                    <th style={th}>วันที่</th>
                    <th style={th}>ลูกค้า</th>
                    <th style={th}>รายการ</th>
                    <th style={{...th,textAlign:"right"}}>ยอด</th>
                    <th style={{...th,textAlign:"center"}}>สถานะ</th>
                  </tr></thead>
                  <tbody>
                    {[...transactions].sort((a,b)=>b.id-a.id).slice(0,10).map((t,i)=>{
                      const c=customers.find(x=>x.id===t.customerId);
                      return(
                        <tr key={t.id} style={i%2===1?altRow:{}}>
                          <td style={{...td,fontSize:11,color:"#6b7280"}}>{thDate(t.date)}</td>
                          <td style={{...td,fontWeight:600}}>{c?.name||"-"}</td>
                          <td style={{...td,fontSize:11,color:"#374151"}}>{(t.items||[]).slice(0,2).map(it=>it.name).join(", ")}{(t.items||[]).length>2?"...":""}</td>
                          <td style={{...tdR,fontWeight:700}}>฿{fmt(t.total)}</td>
                          <td style={{...td,textAlign:"center"}}>
                            <span style={{background:t.paid?"#f0fdf4":"#fff7ed",color:t.paid?"#15803d":"#f59e0b",padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:700}}>
                              {t.paid?"จ่ายแล้ว":"ค้างอยู่"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Footer */}
          <div style={{marginTop:32,paddingTop:12,borderTop:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",fontSize:10,color:"#d1d5db"}}>
            <span>🏪 {SHOP_NAME} · ระบบสมุดหนี้โชห่วย {APP_VERSION}</span>
            <span>{genDate}</span>
          </div>
        </div>
      </div>

      {/* Print CSS */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; margin: 0 !important; }
          #report-page {
            box-shadow: none !important;
            margin: 0 !important;
            border-radius: 0 !important;
            width: 210mm !important;
            min-height: 297mm !important;
            padding: 15mm 20mm !important;
            font-size: 11pt !important;
          }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>
    </div>
  );
}

// ══ CashOut View — โหมดรถส่งของ ══════════════════
function CashOutView({onClose,showToast,settings}){
  const [step,  setStep]  = useState("form"); // form|confirm|done
  const [supplier,setSupplier]=useState("");
  const [items, setItems] = useState([{name:"",price:""}]);
  const [note,  setNote]  = useState("");
  const [hist,  setHist]  = useState(null);   // {expenses,todayTotal,monthTotal}
  const [tab,   setTab]   = useState("new");  // new|history
  const [saving,setSaving]= useState(false);
  const [dateFilter,setDateFilter]=useState(new Date().toISOString().slice(0,7));

  const total = items.reduce((s,it)=>s+(parseFloat(it.price)||0),0);
  const addItem = ()=>setItems(p=>[...p,{name:"",price:""}]);
  const removeItem=i=>setItems(p=>p.filter((_,idx)=>idx!==i));
  const updItem=(i,f,v)=>setItems(p=>{const a=[...p];a[i]={...a[i],[f]:v};return a;});

  const loadHistory=async(month)=>{
    try{
      const res=await fetch(`${GAS_URL}?action=getExpenses&month=${month||dateFilter}`);
      const d=await res.json();
      if(d.ok) setHist(d);
    }catch{}
  };

  useEffect(()=>{ if(tab==="history") loadHistory(dateFilter); },[tab,dateFilter]);

  const submit=async()=>{
    setSaving(true);
    const expItems=items.filter(it=>it.name||it.price).map(it=>({name:it.name||"รายการ",price:parseFloat(it.price)||0}));
    const today=new Date().toISOString().slice(0,10);
    try{
      fetch(GAS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"addExpense",supplier,items:expItems,total,date:today,note})}).catch(()=>{});
      setTimeout(()=>{
        setSaving(false);
        setStep("done");
        if(tab==="history") loadHistory(dateFilter);
      },600);
    }catch{ setSaving(false); }
  };

  const reset=()=>{ setSupplier(""); setItems([{name:"",price:""}]); setNote(""); setStep("form"); };
  const thMonths=["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

  return(
    <div style={{position:"fixed",inset:0,background:"#f4f6f0",zIndex:990,display:"flex",flexDirection:"column",fontFamily:"'Sarabun',sans-serif"}}>

      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#1e3a5f,#2563eb)",color:"#fff",padding:"20px 16px 0",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
          <span style={{fontWeight:800,fontSize:"1.15em",flex:1}}>🚛 รถส่งของ — จ่ายเงินสด</span>
        </div>
        {/* Tabs */}
        <div style={{display:"flex",gap:0}}>
          {[["new","➕ บันทึกใหม่"],["history","📋 ประวัติจ่าย"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{flex:1,padding:"10px 0",border:"none",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:"0.9em",
                background:tab===t?"#fff":"transparent",
                color:tab===t?"#1e3a5f":"rgba(255,255,255,.7)",
                borderRadius:tab===t?"12px 12px 0 0":"0"}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ── TAB: NEW EXPENSE ── */}
      {tab==="new"&&(
        <div style={{flex:1,overflowY:"auto",padding:16}}>
          {step==="done"?(
            <div style={{textAlign:"center",padding:"40px 20px"}}>
              <div style={{fontSize:56,marginBottom:16}}>✅</div>
              <div style={{fontWeight:800,fontSize:"1.2em",color:"#15803d",marginBottom:6}}>บันทึกแล้ว!</div>
              <div style={{color:"#6b7280",marginBottom:8}}>จ่ายให้ <b>{supplier||"ซัพพลายเออร์"}</b></div>
              <div style={{fontWeight:800,fontSize:"1.8em",color:"#1e3a5f",marginBottom:24}}>฿{fmt(total)}</div>
              <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                <button onClick={reset} style={{padding:"12px 24px",background:"#2563eb",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"1em"}}>+ บันทึกอีกครั้ง</button>
                <button onClick={()=>{setTab("history");loadHistory(dateFilter);}} style={{padding:"12px 24px",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"1em"}}>📋 ดูประวัติ</button>
              </div>
            </div>
          ):step==="confirm"?(
            <div>
              <div style={{background:"#fff",borderRadius:16,padding:20,marginBottom:14,boxShadow:"0 4px 20px rgba(0,0,0,.08)",textAlign:"center"}}>
                <div style={{fontSize:36,marginBottom:8}}>🚛</div>
                <div style={{fontWeight:800,fontSize:"1.15em",color:"#1e3a5f"}}>{supplier||"ไม่ระบุร้านค้า"}</div>
              </div>
              <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
                {items.filter(it=>it.name||it.price).map((it,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f3f4f6"}}>
                    <span>{it.name||"รายการ"}</span><span style={{fontWeight:600}}>฿{fmt(parseFloat(it.price)||0)}</span>
                  </div>
                ))}
                <div style={{display:"flex",justifyContent:"space-between",marginTop:10,paddingTop:10,borderTop:"2px solid #1e3a5f"}}>
                  <span style={{fontWeight:800}}>💸 รวมจ่าย</span>
                  <span style={{fontWeight:800,fontSize:"1.2em",color:"#2563eb"}}>฿{fmt(total)}</span>
                </div>
              </div>
              {note&&<div style={{background:"#eff6ff",borderRadius:12,padding:"10px 14px",marginBottom:14,fontSize:"0.85em",color:"#1e40af"}}>📝 {note}</div>}
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setStep("form")} style={{flex:1,padding:"14px 0",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:14,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"1em"}}>← แก้ไข</button>
                <button onClick={submit} disabled={saving} style={{flex:2,padding:"14px 0",background:saving?"#9ca3af":"#2563eb",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.05em",cursor:saving?"default":"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 16px rgba(37,99,235,.4)"}}>
                  {saving?"⏳ กำลังบันทึก...":"✅ ยืนยันจ่ายเงิน"}
                </button>
              </div>
            </div>
          ):(
            /* Form */
            <>
              {/* Supplier */}
              <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
                <div style={{fontWeight:700,marginBottom:10,color:"#1e3a5f",display:"flex",alignItems:"center",gap:6}}>🚛 ร้านค้า / ซัพพลายเออร์</div>
                <input value={supplier} onChange={e=>setSupplier(e.target.value)} placeholder="เช่น ร้านค้าส่งตลาด, บริษัทน้ำ, โรงงานข้าวสาร..."
                  style={{width:"100%",padding:"11px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}}/>
                {/* Quick supplier buttons */}
                <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                  {["ร้านค้าส่ง","บริษัทน้ำ","โรงงานข้าวสาร","บริษัทน้ำมัน","ตลาด"].map(s=>(
                    <button key={s} onClick={()=>setSupplier(s)}
                      style={{padding:"5px 10px",background:supplier===s?"#2563eb":"#eff6ff",color:supplier===s?"#fff":"#1e40af",border:"1.5px solid #bfdbfe",borderRadius:20,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.8em",fontWeight:supplier===s?700:400}}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Items */}
              <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
                <div style={{fontWeight:700,marginBottom:10,color:"#1e3a5f"}}>📦 รายการสินค้า</div>
                {items.map((it,i)=>(
                  <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
                    <input value={it.name} onChange={e=>updItem(i,"name",e.target.value)} placeholder="ชื่อสินค้า/รายการ"
                      style={{flex:2,padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",outline:"none"}}/>
                    <input value={it.price} onChange={e=>updItem(i,"price",e.target.value)} placeholder="฿" type="number" inputMode="decimal"
                      style={{flex:1,padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",outline:"none"}}/>
                    {items.length>1&&<button onClick={()=>removeItem(i)} style={{background:"#fee2e2",border:"none",borderRadius:8,padding:"8px 10px",cursor:"pointer",color:"#ef4444",fontWeight:700}}>🗑</button>}
                  </div>
                ))}
                <button onClick={addItem} style={{width:"100%",padding:"9px 0",background:"#eff6ff",border:"1.5px dashed #2563eb",borderRadius:10,color:"#1e40af",fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em",marginTop:4}}>+ เพิ่มรายการ</button>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:14,padding:"12px",background:"#eff6ff",borderRadius:10,border:"1.5px solid #bfdbfe"}}>
                  <span style={{fontWeight:700,color:"#1e3a5f"}}>💸 รวมจ่าย</span>
                  <span style={{fontWeight:800,fontSize:"1.2em",color:"#2563eb"}}>฿{fmt(total)}</span>
                </div>
              </div>

              {/* Note */}
              <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:20,boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
                <div style={{fontWeight:700,marginBottom:8,color:"#1e3a5f"}}>📝 หมายเหตุ (ถ้ามี)</div>
                <input value={note} onChange={e=>setNote(e.target.value)} placeholder="เช่น จ่ายเงินสด, โอน, ใบส่งของเลขที่..."
                  style={{width:"100%",padding:"9px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em",boxSizing:"border-box",outline:"none"}}/>
              </div>

              <button onClick={()=>{if(total>0)setStep("confirm");}} disabled={total<=0}
                style={{width:"100%",padding:"16px 0",background:total>0?"#2563eb":"#d1d5db",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.1em",cursor:total>0?"pointer":"not-allowed",fontFamily:"'Sarabun',sans-serif",boxShadow:total>0?"0 4px 16px rgba(37,99,235,.4)":"none"}}>
                ถัดไป → ยืนยัน
              </button>
            </>
          )}
        </div>
      )}

      {/* ── TAB: HISTORY ── */}
      {tab==="history"&&(
        <div style={{flex:1,overflowY:"auto",padding:16}}>
          {/* Month picker */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <button onClick={()=>{const[y,m]=dateFilter.split("-");const d=new Date(Number(y),Number(m)-2,1);setDateFilter(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);loadHistory(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);}} style={{background:"#f3f4f6",border:"none",borderRadius:10,padding:"8px 14px",cursor:"pointer",fontWeight:700,fontSize:"1em"}}>←</button>
            <div style={{flex:1,textAlign:"center",fontWeight:700,color:"#1e3a5f"}}>
              {dateFilter&&`${thMonths[parseInt(dateFilter.split("-")[1])-1]} ${parseInt(dateFilter.split("-")[0])+543}`}
            </div>
            <button onClick={()=>{const[y,m]=dateFilter.split("-");const d=new Date(Number(y),Number(m),1);setDateFilter(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);loadHistory(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);}} style={{background:"#f3f4f6",border:"none",borderRadius:10,padding:"8px 14px",cursor:"pointer",fontWeight:700,fontSize:"1em"}}>→</button>
          </div>

          {/* Summary */}
          {hist&&(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <div style={{background:"#fff",borderRadius:14,padding:14,boxShadow:"0 2px 8px rgba(0,0,0,.06)",borderLeft:"4px solid #2563eb"}}>
                <div style={{fontSize:"0.78em",color:"#6b7280"}}>จ่ายออกวันนี้</div>
                <div style={{fontWeight:800,fontSize:"1.3em",color:"#2563eb"}}>฿{fmt(hist.todayTotal)}</div>
              </div>
              <div style={{background:"#fff",borderRadius:14,padding:14,boxShadow:"0 2px 8px rgba(0,0,0,.06)",borderLeft:"4px solid #1e3a5f"}}>
                <div style={{fontSize:"0.78em",color:"#6b7280"}}>จ่ายออกเดือนนี้</div>
                <div style={{fontWeight:800,fontSize:"1.3em",color:"#1e3a5f"}}>฿{fmt(hist.monthTotal)}</div>
              </div>
            </div>
          )}

          {!hist&&<div style={{textAlign:"center",padding:32,color:"#9ca3af"}}>⏳ กำลังโหลด...</div>}
          {hist&&hist.expenses.length===0&&<div style={{textAlign:"center",padding:32,color:"#9ca3af"}}>ไม่มีรายจ่ายเดือนนี้</div>}

          {hist&&hist.expenses.map(e=>(
            <div key={e.id} style={{background:"#fff",borderRadius:14,padding:14,marginBottom:10,boxShadow:"0 2px 8px rgba(0,0,0,.06)",borderLeft:"4px solid #bfdbfe"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                <div>
                  <div style={{fontWeight:700,color:"#1e3a5f"}}>🚛 {e.supplier||"ไม่ระบุ"}</div>
                  <div style={{fontSize:"0.8em",color:"#9ca3af"}}>📅 {e.date}</div>
                </div>
                <div style={{fontWeight:800,fontSize:"1.1em",color:"#2563eb"}}>฿{fmt(e.total)}</div>
              </div>
              {e.items&&e.items.length>0&&(
                <div style={{borderTop:"1px solid #f3f4f6",paddingTop:6,marginTop:4}}>
                  {e.items.map((it,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:"0.85em",color:"#374151",paddingBottom:2}}>
                      <span>• {it.name}</span><span>฿{fmt(it.price)}</span>
                    </div>
                  ))}
                </div>
              )}
              {e.note&&<div style={{marginTop:6,fontSize:"0.78em",color:"#6b7280",background:"#f9fafb",borderRadius:6,padding:"3px 8px"}}>📝 {e.note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══ Help Modal ═══════════════════════════════════
const HELP_SECTIONS = [
  {
    icon:"➕", title:"บันทึกหนี้ใหม่",
    steps:[
      "กดปุ่ม + บันทึก ที่แถบล่าง",
      "เลือกลูกค้า หรือพิมพ์ชื่อเพื่อเพิ่มใหม่",
      "ถ่ายรูปลูกหนี้ได้ตอนเพิ่มใหม่",
      "ใส่รายการสินค้าและราคา",
      "ตั้งวันทวง และดอกเบี้ย (ถ้ามี)",
      "กด ถัดไป → ยืนยัน → บันทึก",
    ]
  },
  {
    icon:"💳", title:"รับชำระเงิน (QR)",
    steps:[
      "เปิดหน้าลูกค้า → กด 💳 QR รับเงิน",
      "ใส่จำนวนเงิน หรือกด เต็ม",
      "ให้ลูกหนี้สแกน QR PromptPay",
      "กด ✅ ยืนยันรับเงิน",
      "ระบบจะแจ้งเตือน Email + LINE อัตโนมัติ",
    ]
  },
  {
    icon:"📷", title:"รูปภาพลูกหนี้",
    steps:[
      "เพิ่มใหม่: ถ่ายรูปตอนเพิ่มลูกค้า",
      "แก้ไขรูป: เปิดหน้าลูกค้า → กด 📷",
      "รูปเก็บบน Google Drive อัตโนมัติ",
      "รูปจะแสดงใน LINE แจ้งเตือนด้วย",
    ]
  },
  {
    icon:"📝", title:"Note & เบอร์โทร",
    steps:[
      "เปิดหน้าลูกค้า → แตะ 📞 เพื่อเพิ่มเบอร์",
      "เลื่อนลงหา Note → กด + เพิ่ม Note",
      "Note ใช้จดข้อมูลพิเศษเช่น บ้านใกล้วัด",
      "Note จะแสดงย่อๆ ในรายการลูกหนี้",
    ]
  },
  {
    icon:"📊", title:"ดูยอดและปฏิทิน",
    steps:[
      "หน้าหลัก: ดูยอดค้างรวม + รายการล่าสุด",
      "แท็บ 👥 ลูกหนี้: เฉพาะคนที่ยังค้างอยู่",
      "เรียงได้: ยอดมาก/น้อย, ชื่อ, ใกล้ทวง",
      "แท็บ 📅 ปฏิทิน: กดวันเพื่อดูรายชื่อ",
      "แท็บ 📊 สรุป: ดูยอดค้างพร้อมดอกเบี้ย",
    ]
  },
  {
    icon:"💬", title:"LINE OA Chatbot",
    steps:[
      "เจ้าหนี้ Admin พิมพ์คำสั่งใน LINE ได้เลย",
      "บันทึก [ชื่อ] [฿] [รายการ] — จดหนี้",
      "รับ [ชื่อ] [฿] — รับชำระเงิน",
      "ยอด [ชื่อ] — เช็คยอดค้าง",
      "รายการ — ดูลูกหนี้ทั้งหมด",
      "วันนี้ — ดูครบกำหนดวันนี้",
    ]
  },
  {
    icon:"⚙️", title:"ตั้งค่า (Admin เท่านั้น)",
    steps:[
      "กดไอคอน ⚙️ มุมขวาบน",
      "ใส่รหัส 4 หลัก เพื่อเข้าตั้งค่า",
      "ตั้งค่า PromptPay, Email, LINE OA",
      "เพิ่มผู้ช่วย Admin และอนุมัติคำขอ",
      "Backup ข้อมูลขึ้น Google Sheets",
    ]
  },
];

function HelpModal({onClose}){
  const [section, setSection] = useState(0);
  const s = HELP_SECTIONS[section];
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",zIndex:2000,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:480,maxHeight:"88vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 20px 16px",borderRadius:"24px 24px 0 0",flexShrink:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div>
              <div style={{fontWeight:800,fontSize:"1.1em"}}>📖 วิธีใช้งาน</div>
              <div style={{fontSize:"0.78em",opacity:.6,marginTop:2}}>สมุดหนี้โชห่วย · {APP_VERSION}</div>
            </div>
            <button onClick={onClose} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:"50%",width:36,height:36,cursor:"pointer",fontSize:18,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          </div>
          {/* Tab pills */}
          <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:2}}>
            {HELP_SECTIONS.map((sec,i)=>(
              <button key={i} onClick={()=>setSection(i)}
                style={{padding:"5px 12px",borderRadius:20,border:"none",cursor:"pointer",flexShrink:0,fontFamily:"'Sarabun',sans-serif",fontSize:"0.8em",fontWeight:section===i?700:400,
                  background:section===i?"#fff":"rgba(255,255,255,.15)",
                  color:section===i?"#1a3a2a":"rgba(255,255,255,.8)"}}>
                {sec.icon}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{padding:"20px",overflowY:"auto",flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <div style={{width:44,height:44,borderRadius:"50%",background:"#f0fdf4",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>
              {s.icon}
            </div>
            <div style={{fontWeight:800,fontSize:"1.1em",color:"#1a3a2a"}}>{s.title}</div>
          </div>
          <div>
            {s.steps.map((step,i)=>(
              <div key={i} style={{display:"flex",gap:12,marginBottom:14,alignItems:"flex-start"}}>
                <div style={{width:26,height:26,borderRadius:"50%",background:"#1a3a2a",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:"0.8em",flexShrink:0,marginTop:1}}>
                  {i+1}
                </div>
                <div style={{fontSize:"0.95em",color:"#374151",lineHeight:1.6,paddingTop:3}}>{step}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Navigation */}
        <div style={{padding:"12px 20px 28px",display:"flex",gap:10,flexShrink:0,borderTop:"1px solid #f3f4f6"}}>
          <button onClick={()=>setSection(s=>Math.max(0,s-1))} disabled={section===0}
            style={{flex:1,padding:"11px 0",background:section===0?"#f3f4f6":"#f0fdf4",border:`1.5px solid ${section===0?"#e5e7eb":"#22c55e"}`,borderRadius:12,fontWeight:600,cursor:section===0?"default":"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em",color:section===0?"#9ca3af":"#15803d"}}>
            ← ก่อนหน้า
          </button>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            {HELP_SECTIONS.map((_,i)=>(
              <div key={i} onClick={()=>setSection(i)} style={{width:i===section?20:6,height:6,borderRadius:3,background:i===section?"#1a7a4a":"#d1d5db",transition:"width .2s",cursor:"pointer"}}/>
            ))}
          </div>
          {section<HELP_SECTIONS.length-1?(
            <button onClick={()=>setSection(s=>Math.min(HELP_SECTIONS.length-1,s+1))}
              style={{flex:1,padding:"11px 0",background:"#1a7a4a",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em",color:"#fff"}}>
              ถัดไป →
            </button>
          ):(
            <button onClick={onClose}
              style={{flex:1,padding:"11px 0",background:"#1a7a4a",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em",color:"#fff"}}>
              ✅ เข้าใจแล้ว!
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ══ Support Page ══════════════════════════════════
function SupportPage({settings,onClose}){
  const [tab,setTab]          = useState("pay");      // pay | compare
  const [name,setName]        = useState("");
  const [slip,setSlip]        = useState(null);
  const [slipPreview,setSlipPreview] = useState(null);
  const [slipLoading,setSlipLoading] = useState(false);
  const [state,setState]      = useState("idle");     // idle|sending|done|error
  const slipRef = useRef();
  const amount  = settings?.supportAmount||399;
  const ppId    = settings?.supportPromptpay||SUPPORT_QR;
  const payload = genQR(ppId,amount);
  const imgUrl  = qrUrl(payload);

  const handleSlip=async e=>{
    const f=e.target.files[0];
    if(!f)return;
    setSlipLoading(true);
    try{
      const b64=await compressImage(f,800);
      setSlip(b64); setSlipPreview(b64);
    }catch{ /* ignore */ }
    setSlipLoading(false);
  };

  const removeSlip=()=>{ setSlip(null); setSlipPreview(null); if(slipRef.current)slipRef.current.value=""; };

  const submit=async()=>{
    if(!name.trim()) return;
    setState("sending");
    try{
      // fire-and-forget — don't block UI waiting for Drive upload
      gasPostRead({action:"supportPayment",name,amount,slip:slip||null});
      // show success immediately
      setTimeout(()=>setState("done"),800);
    }catch{
      setState("error");
      setTimeout(()=>setState("idle"),2500);
    }
  };

  const canSend=name.trim()&&slip;

  // ── Version comparison data ──
  const FREE_FEATURES=[
    "บันทึกลูกหนี้ไม่จำกัด",
    "QR PromptPay รับชำระ",
    "แจ้งเตือนทาง Email",
    "Backup ขึ้น Google Sheets",
    "ปฏิทินวันทวง",
    "Note & เบอร์โทรลูกค้า",
    "รูปภาพลูกหนี้",
    "เรียงลำดับลูกหนี้",
  ];
  const FULL_FEATURES=[
    ...FREE_FEATURES,
    "แจ้งเตือน LINE OA ทันที",
    "รูปลูกหนี้ใน LINE แจ้งเตือน",
    "LINE Chatbot บันทึก/เช็คยอด",
    "อนุมัติผู้ช่วย Admin ผ่าน LINE",
    "ดอกเบี้ยอัตโนมัติ",
    "Due Summary ละเอียด",
    "Full Version Badge 🎉",
  ];

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",zIndex:997,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:480,boxShadow:"0 -8px 40px rgba(0,0,0,.2)",maxHeight:"92vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>

        {/* Header with tabs */}
        <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 20px 0",borderRadius:"24px 24px 0 0",flexShrink:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontWeight:800,fontSize:"1.1em"}}>☕ สนับสนุนการพัฒนา</div>
            <button onClick={onClose} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:"50%",width:34,height:34,cursor:"pointer",fontSize:16,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          </div>
          <div style={{display:"flex",gap:0}}>
            {[["pay","💳 ชำระเงิน"],["compare","📋 เปรียบเทียบ"]].map(([t,l])=>(
              <button key={t} onClick={()=>setTab(t)}
                style={{flex:1,padding:"10px 0",border:"none",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:"0.9em",
                  background:tab===t?"#fff":"transparent",
                  color:tab===t?"#1a3a2a":"rgba(255,255,255,.65)",
                  borderRadius:tab===t?"12px 12px 0 0":"0",marginBottom:tab===t?0:0}}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* ── TAB: COMPARE ── */}
        {tab==="compare"&&(
          <div style={{overflowY:"auto",flex:1,padding:"20px 16px 24px"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              {/* Free */}
              <div style={{borderRadius:16,border:"2px solid #e5e7eb",overflow:"hidden"}}>
                <div style={{background:"#f9fafb",padding:"12px 14px",textAlign:"center",borderBottom:"2px solid #e5e7eb"}}>
                  <div style={{fontWeight:800,fontSize:"1em",color:"#374151"}}>ทดลองใช้</div>
                  <div style={{fontWeight:800,fontSize:"1.4em",color:"#374151",marginTop:2}}>ฟรี</div>
                  <div style={{fontSize:"0.75em",color:"#9ca3af"}}>ไม่มีค่าใช้จ่าย</div>
                </div>
                <div style={{padding:"12px 10px"}}>
                  {FREE_FEATURES.map((f,i)=>(
                    <div key={i} style={{display:"flex",gap:6,marginBottom:8,alignItems:"flex-start"}}>
                      <span style={{color:"#22c55e",flexShrink:0,fontSize:"0.9em",marginTop:1}}>✓</span>
                      <span style={{fontSize:"0.8em",color:"#374151",lineHeight:1.4}}>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Full */}
              <div style={{borderRadius:16,border:"2px solid #f59e0b",overflow:"hidden",boxShadow:"0 4px 16px rgba(245,158,11,.2)"}}>
                <div style={{background:"linear-gradient(135deg,#f59e0b,#d97706)",padding:"12px 14px",textAlign:"center",borderBottom:"2px solid #f59e0b"}}>
                  <div style={{fontWeight:800,fontSize:"1em",color:"#fff"}}>Full Version 🎉</div>
                  <div style={{fontWeight:800,fontSize:"1.4em",color:"#fff",marginTop:2}}>฿{fmt(amount)}</div>
                  <div style={{fontSize:"0.75em",color:"rgba(255,255,255,.8)"}}>จ่ายครั้งเดียว</div>
                </div>
                <div style={{padding:"12px 10px"}}>
                  {FULL_FEATURES.map((f,i)=>(
                    <div key={i} style={{display:"flex",gap:6,marginBottom:8,alignItems:"flex-start"}}>
                      <span style={{color:i<FREE_FEATURES.length?"#22c55e":"#f59e0b",flexShrink:0,fontSize:"0.9em",marginTop:1}}>{i<FREE_FEATURES.length?"✓":"★"}</span>
                      <span style={{fontSize:"0.8em",color:i<FREE_FEATURES.length?"#374151":"#92400e",fontWeight:i<FREE_FEATURES.length?400:600,lineHeight:1.4}}>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={()=>setTab("pay")} style={{width:"100%",marginTop:16,padding:"13px 0",background:"linear-gradient(135deg,#f59e0b,#d97706)",color:"#fff",border:"none",borderRadius:12,fontWeight:800,fontSize:"1em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 16px rgba(245,158,11,.4)"}}>
              ☕ สนับสนุน ฿{fmt(amount)} → รับ Full Version
            </button>
          </div>
        )}

        {/* ── TAB: PAY ── */}
        {tab==="pay"&&(
          <div style={{overflowY:"auto",flex:1,padding:"20px 16px"}}>
            {state==="done"?(
              <div style={{textAlign:"center",padding:"24px 0"}}>
                <div style={{fontSize:52,marginBottom:12}}>✅</div>
                <div style={{fontWeight:800,color:"#15803d",fontSize:"1.1em",marginBottom:8}}>ขอบคุณมากครับ!</div>
                <div style={{color:"#6b7280",fontSize:"0.85em",lineHeight:1.6}}>แจ้ง Admin แล้ว<br/>Admin จะส่งรหัส Full Version ให้ภายใน 24 ชม.<br/>ทาง Email ที่แจ้งไว้</div>
                <button onClick={onClose} style={{marginTop:20,padding:"11px 32px",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em"}}>ปิด</button>
              </div>
            ):(
              <>
                {/* QR */}
                <div style={{textAlign:"center",marginBottom:16}}>
                  <div style={{fontWeight:800,fontSize:"1.6em",color:"#1a3a2a"}}>฿{fmt(amount)}</div>
                  {imgUrl?(
                    <div style={{display:"inline-block",padding:10,background:"#fff",borderRadius:16,boxShadow:"0 4px 20px rgba(0,0,0,.12)",border:"3px solid #f59e0b",marginTop:8}}>
                      <img src={imgUrl} alt="QR" width={180} height={180} style={{display:"block",borderRadius:8}}/>
                    </div>
                  ):(
                    <div style={{width:200,height:200,background:"#f3f4f6",borderRadius:16,margin:"8px auto",display:"flex",alignItems:"center",justifyContent:"center",color:"#9ca3af",fontSize:"0.85em"}}>กำลังโหลด QR...</div>
                  )}
                  <div style={{fontSize:"0.8em",color:"#6b7280",marginTop:6}}>PromptPay: {ppId}</div>
                </div>

                {/* Name */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:"0.85em",color:"#6b7280",marginBottom:6}}>ชื่อ-สกุล <span style={{color:"#ef4444"}}>*</span></div>
                  <input value={name} onChange={e=>setName(e.target.value)} placeholder="ชื่อของคุณ"
                    style={{width:"100%",padding:"10px 12px",border:`1.5px solid ${name.trim()?"#1a7a4a":"#e5e7eb"}`,borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none",transition:"border .15s"}}/>
                </div>

                {/* Slip */}
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:"0.85em",color:"#6b7280",marginBottom:6}}>📎 แนบ Slip การโอน <span style={{color:"#ef4444"}}>*</span></div>
                  <input ref={slipRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handleSlip}/>
                  {!slipPreview?(
                    <button onClick={()=>slipRef.current?.click()} disabled={slipLoading}
                      style={{width:"100%",padding:"18px 0",background:"#fffbeb",border:"2px dashed #f59e0b",borderRadius:12,cursor:slipLoading?"wait":"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:600,color:"#92400e",fontSize:"0.95em",display:"flex",flexDirection:"column",alignItems:"center",gap:6,transition:"background .15s"}}>
                      <span style={{fontSize:28}}>{slipLoading?"⏳":"📷"}</span>
                      <span>{slipLoading?"กำลังโหลดรูป...":"ถ่ายรูป หรือ เลือก Slip จากคลัง"}</span>
                      {!slipLoading&&<span style={{fontSize:"0.78em",color:"#b45309",fontWeight:400}}>รองรับ JPG, PNG</span>}
                    </button>
                  ):(
                    <div style={{position:"relative"}}>
                      <img src={slipPreview} alt="slip" style={{width:"100%",borderRadius:12,border:"2px solid #22c55e",maxHeight:220,objectFit:"contain",background:"#f9fafb"}}/>
                      <button onClick={removeSlip} style={{position:"absolute",top:8,right:8,background:"rgba(239,68,68,.9)",border:"none",borderRadius:"50%",width:30,height:30,color:"#fff",cursor:"pointer",fontWeight:700,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                      <div style={{marginTop:6,fontSize:"0.8em",color:"#15803d",textAlign:"center",display:"flex",justifyContent:"center",gap:10}}>
                        <span>✅ แนบ Slip แล้ว</span>
                        <span style={{cursor:"pointer",color:"#3b82f6",textDecoration:"underline"}} onClick={()=>slipRef.current?.click()}>เปลี่ยน</span>
                      </div>
                    </div>
                  )}
                </div>

                {!canSend&&<div style={{background:"#fff7ed",borderRadius:8,padding:"8px 12px",fontSize:"0.82em",color:"#92400e",marginBottom:10,textAlign:"center"}}>⚠️ ใส่ชื่อ + แนบ Slip ก่อนส่ง</div>}

                <button onClick={submit} disabled={!canSend||state==="sending"}
                  style={{width:"100%",padding:"14px 0",background:canSend&&state==="idle"?"linear-gradient(135deg,#f59e0b,#d97706)":"#e5e7eb",color:canSend&&state==="idle"?"#fff":"#9ca3af",border:"none",borderRadius:12,fontWeight:800,fontSize:"1em",cursor:canSend&&state==="idle"?"pointer":"default",fontFamily:"'Sarabun',sans-serif",boxShadow:canSend?"0 4px 16px rgba(245,158,11,.4)":"none",transition:"all .2s"}}>
                  {state==="sending"?"⏳ กำลังส่ง...":state==="error"?"❌ ส่งไม่สำเร็จ ลองใหม่":"📤 ส่ง Slip → รับ Full Version"}
                </button>
                <button onClick={()=>setTab("compare")} style={{width:"100%",marginTop:8,padding:"10px 0",background:"none",border:"none",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.85em",color:"#6b7280",textDecoration:"underline"}}>
                  📋 ดูความแตกต่าง ทดลอง vs Full
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App(){
  const [customers,    setCustomers]    = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [settings,     setSettings]     = useState({promptpayId:DEFAULT_QR,adminEmails:[],adminLineUids:[],channelToken:"",supportAmount:399,supportPromptpay:DEFAULT_QR});
  const [initState,    setInitState]    = useState("loading");
  const [refreshing,   setRefreshing]   = useState(false);
  const [lastSync,     setLastSync]     = useState(null);
  const [toast,        setToast]        = useState(null);
  const [view,         setView]         = useState("dashboard");
  const [selectedCid,  setSelectedCid]  = useState(null);
  const [fontSize,     setFontSize]     = useState("md");
  const [searchQ,      setSearchQ]      = useState("");
  const [newDebt,      setNewDebt]      = useState({customer:null,items:[{name:"",price:""}],dueDate:"",interestRate:""});
  const [boxOrder,     setBoxOrder]     = useState(["due","all","today","paid"]);
  const [dragBox,      setDragBox]      = useState(null);
  const [showQR,       setShowQR]       = useState(false);
  const [showPin,      setShowPin]      = useState(false);
  const [pinUnlocked,  setPinUnlocked]  = useState(false);
  const [draft,        setDraft]        = useState({promptpayId:DEFAULT_QR,adminEmails:[],adminLineUids:[],channelToken:"",lineOAId:"",supportAmount:399,supportPromptpay:DEFAULT_QR});
  const [editingTx,    setEditingTx]    = useState(null);
  const [pendingHelpers,setPendingHelpers]=useState([]);
  const [showSupport,  setShowSupport]  = useState(false);
  const [showHelp,     setShowHelp]     = useState(false);
  const [showCashOut,  setShowCashOut]  = useState(false);
  const [showReport,   setShowReport]   = useState(false);
  const [versionCode,  setVersionCode]  = useState("");
  const [calDayInfo,   setCalDayInfo]   = useState(null);
  const [listSort,     setListSort]     = useState("debtDesc"); // debtDesc|debtAsc|nameAsc|nameDesc|dueSoon
  const [showHistory,  setShowHistory]  = useState(false);     // toggle paid customers
  const [backupState,  setBackupState]  = useState("idle");
  // new customer form
  const [newCustName,  setNewCustName]  = useState("");
  const [newCustPhoto, setNewCustPhoto] = useState(null);
  const [showNewCust,  setShowNewCust]  = useState(false);
  const ncPhotoRef = useRef();

  const FS={sm:"13px",md:"15px",lg:"17px",xl:"20px"};

  // Responsive
  const [winW, setWinW] = useState(window.innerWidth);
  useEffect(()=>{
    const h=()=>setWinW(window.innerWidth);
    window.addEventListener("resize",h);
    return()=>window.removeEventListener("resize",h);
  },[]);
  const isMobile  = winW < 640;
  const isTablet  = winW >= 640 && winW < 1024;
  const isDesktop = winW >= 1024;

  const S={fontSize:FS[fontSize],fontFamily:"'Sarabun',sans-serif"};

  const showToast=(msg,icon="✅",ms=2200)=>{ setToast({msg,icon}); setTimeout(()=>setToast(null),ms); };

  const applyData=data=>{ if(data?.ok){ setCustomers(data.customers||[]); setTransactions(data.transactions||[]); setLastSync(new Date().toLocaleTimeString("th-TH")); setInitState("ready"); } };

  const loadAll=useCallback(async(isRef=false)=>{
    isRef?setRefreshing(true):setInitState("loading");
    try{
      const [dr,sr,pr]=await Promise.all([gasGet("getData"),gasGet("getSettings"),gasGet("getPending")]);
      applyData(dr);
      if(sr.ok&&sr.settings){ setSettings(s=>({...s,...sr.settings})); setDraft(d=>({...d,...sr.settings})); }
      if(pr.ok) setPendingHelpers(pr.pending||[]);
    }catch{setInitState("error");}
    setRefreshing(false);
  },[]);

  useEffect(()=>{ loadAll(); },[]);

  // Computed
  const totalDebt  = customers.reduce((s,c)=>s+c.totalDebt,0);
  const debtors    = customers.filter(c=>c.totalDebt>0);
  const dueToday   = customers.filter(c=>c.dueDate===TODAY&&c.totalDebt>0);
  const todayCids  = [...new Set(transactions.filter(t=>t.date===TODAY).map(t=>t.customerId))];
  const todayCusts = customers.filter(c=>todayCids.includes(c.id));
  const paidMonth  = customers.filter(c=>c.totalDebt===0&&c.phone);
  const recentTx   = [...transactions].sort((a,b)=>b.id-a.id).slice(0,5).map(t=>({...t,customer:customers.find(c=>c.id===t.customerId)}));
  const filtered   = customers.filter(c=>c.name.includes(searchQ));
  const BOXES={
    due:  {label:"ครบกำหนดวันนี้",count:dueToday.length,   color:"#ef4444",icon:"🔴"},
    all:  {label:"ลูกหนี้ทั้งหมด",count:debtors.length,     color:"#f59e0b",icon:"🟡"},
    today:{label:"เพิ่งซื้อวันนี้",count:todayCusts.length, color:"#3b82f6",icon:"🔵"},
    paid: {label:"จ่ายแล้วเดือนนี้",count:paidMonth.length, color:"#22c55e",icon:"✅"},
  };

  const onDragStart=k=>setDragBox(k);
  const onDragOver=(e,k)=>{e.preventDefault();if(!dragBox||dragBox===k)return;const a=[...boxOrder],f=a.indexOf(dragBox),t=a.indexOf(k);a.splice(f,1);a.splice(t,0,dragBox);setBoxOrder(a);};
  const onDragEnd=()=>setDragBox(null);

  const debtTotal=newDebt.items.reduce((s,it)=>s+(parseFloat(it.price)||0),0);
  const addItem=()=>setNewDebt(d=>({...d,items:[...d.items,{name:"",price:""}]}));
  const removeItem=i=>setNewDebt(d=>({...d,items:d.items.filter((_,idx)=>idx!==i)}));
  const updItem=(i,f,v)=>setNewDebt(d=>{const it=[...d.items];it[i]={...it[i],[f]:v};return{...d,items:it};});

  const doAddCustomer=async()=>{
    if(!newCustName.trim())return;
    const id=Date.now();
    const nc={id,name:newCustName,phone:"",totalDebt:0,dueDate:null,photo:newCustPhoto};
    setCustomers(p=>[...p,nc]);
    setNewDebt(d=>({...d,customer:nc}));
    setSearchQ("");setNewCustName("");setNewCustPhoto(null);setShowNewCust(false);
    showToast("เพิ่มลูกค้าใหม่แล้ว","👤");
    gasSync({action:"addCustomer",name:nc.name,phone:"",txId:id}).then(applyData);
    if(newCustPhoto){ gasPostRead({action:"savePhoto",customerId:id,base64:newCustPhoto,mimeType:"image/jpeg"}).then(res=>{ if(res.ok&&res.photoUrl) setCustomers(p=>p.map(c=>c.id===id?{...c,photo:res.photoUrl}:c)); }); }
  };

  const confirmDebt=async()=>{
    if(!newDebt.customer||debtTotal<=0)return;
    const items=newDebt.items.filter(it=>it.name||it.price).map(it=>({name:it.name||"รายการ",price:parseFloat(it.price)||0}));
    const txId=Date.now();
    const cid=newDebt.customer.id;
    const due=newDebt.dueDate||"";
    const ir=parseFloat(newDebt.interestRate)||0;
    setTransactions(p=>[...p,{id:txId,customerId:cid,date:TODAY,items,total:debtTotal,paid:false,interestRate:ir,dueDate:due}]);
    setCustomers(p=>p.map(c=>c.id===cid?{...c,totalDebt:c.totalDebt+debtTotal,dueDate:due||c.dueDate}:c));
    setView("dashboard");
    showToast("บันทึกแล้ว ☁️ sync...");
    const ec=newDebt.customer;
    setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:"",interestRate:""});
    gasNotify({...buildDebtEmail(ec,items,debtTotal,due,ir),extraEmails:settings.adminEmails||[]});
    if(settings.channelToken&&(settings.adminLineUids||[]).length>0){
      gasNotifyLine({channelToken:settings.channelToken,uids:settings.adminLineUids,
        message:lineDebtMsg(ec,items,debtTotal,due,ir)});
    }
    gasSync({action:"addDebt",txId,customerId:cid,date:TODAY,items,total:debtTotal,dueDate:due,interestRate:ir}).then(data=>{applyData(data);showToast("✅ sync สำเร็จ");});
  };

  const handleMarkPaid=async(cid,amount)=>{
    const c=customers.find(x=>x.id===cid);
    const newT=Math.max(0,(c?.totalDebt||0)-amount);
    const full=amount>=(c?.totalDebt||0);
    setCustomers(p=>p.map(x=>x.id===cid?{...x,totalDebt:newT,dueDate:newT===0?null:x.dueDate}:x));
    if(full) setTransactions(p=>p.map(t=>t.customerId===cid?{...t,paid:true}:t));
    setShowQR(false);
    showToast("รับชำระแล้ว ☁️ sync...");
    gasSync({action:"markPaid",customerId:cid,amount,fullPay:full}).then(data=>{applyData(data);showToast("✅ sync สำเร็จ");});
  };

  const handleUpdateDebt=async(txId,items,newTotal,ir,due)=>{
    if(!editingTx)return;
    const cid=editingTx.customerId;
    setTransactions(p=>p.map(t=>t.id===txId?{...t,items,total:newTotal,interestRate:ir,dueDate:due}:t));
    const allU=[...transactions.filter(t=>t.id!==txId&&t.customerId===cid&&!t.paid),{id:txId,total:newTotal,paid:false}];
    setCustomers(p=>p.map(c=>c.id===cid?{...c,totalDebt:allU.reduce((s,t)=>s+t.total,0)}:c));
    setEditingTx(null);
    showToast("แก้ไขแล้ว ☁️ sync...");
    gasSync({action:"updateDebt",transactionId:txId,customerId:cid,items,newTotal,interestRate:ir,dueDate:due}).then(data=>{applyData(data);showToast("✅ sync สำเร็จ");});
  };

  const handlePhotoUploaded=(cid,url)=>{ setCustomers(p=>p.map(c=>c.id===cid?{...c,photo:url}:c)); showToast("อัปโหลดรูปแล้ว"); };

  const doSaveSettings=async()=>{
    showToast("กำลังบันทึก...","⏳",10000);
    await gasPostRead({action:"saveSettings",settings:draft});
    setSettings(draft);
    showToast("บันทึกตั้งค่าแล้ว");
  };

  const doBackup=async()=>{
    setBackupState("loading");
    const res=await gasPostRead({action:"backup"});
    if(res.ok){ showToast(`Backup สำเร็จ! ${res.customers} ลูกค้า ${res.transactions} รายการ → Sheet: ${res.sheet}`,"☁️",4000); setBackupState("done"); }
    else{ showToast("Backup ล้มเหลว","❌"); setBackupState("error"); }
    setTimeout(()=>setBackupState("idle"),4000);
  };

  const doVerifyVersion=async()=>{
    if(!versionCode.trim())return;
    const res=await gasPostRead({action:"verifyVersion",code:versionCode});
    if(res.isFullVersion){ showToast(res.message||"Full Version!","🎉"); setSettings(s=>({...s,isFullVersion:true})); }
    else showToast("รหัสไม่ถูกต้อง","❌");
  };

  const doApproveHelper=async(uid)=>{
    await gasPostRead({action:"approveHelper",uid});
    setPendingHelpers(p=>p.filter(h=>h.uid!==uid));
    showToast("อนุมัติแล้ว! ส่ง LINE แล้ว","✅");
    loadAll(true);
  };
  const doRejectHelper=async(uid)=>{
    await gasPostRead({action:"rejectHelper",uid});
    setPendingHelpers(p=>p.filter(h=>h.uid!==uid));
    showToast("ปฏิเสธแล้ว","❌");
  };

  const goToSettings=()=>{ if(pinUnlocked){setDraft({...settings});setView("settings");}else{setShowPin(true);} };

  // ── Container style ──────────────────────────
  const containerStyle={
    ...S,
    maxWidth: isDesktop?"1200px":isTablet?"768px":"100%",
    margin:"0 auto",
    minHeight:"100vh",
    background:"#f4f6f0",
    display: isDesktop?"flex":"block",
  };

  // ── Sidebar for Desktop ──────────────────────
  const SidebarNav=()=>(
    <div style={{width:220,background:"#1a3a2a",minHeight:"100vh",padding:"24px 12px",flexShrink:0,position:"sticky",top:0}}>
      <div style={{color:"#fff",fontWeight:800,fontSize:"1.1em",marginBottom:4}}>🏪 สมุดหนี้</div>
      <div style={{color:"rgba(255,255,255,.4)",fontSize:"0.72em",marginBottom:24}}>{APP_VERSION}{settings.isFullVersion?" · Full":""}</div>
      {[["dashboard","🏠","หน้าหลัก"],["list","👥","ลูกหนี้"],["addDebt","➕","บันทึกหนี้"],["calendar","📅","ปฏิทินทวง"],["dueSummary","📊","สรุปยอดค้าง"]].map(([v,icon,label])=>(
        <button key={v} onClick={()=>{setSearchQ("");setView(v);if(v==="addDebt")setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:"",interestRate:""}); }}
          style={{width:"100%",padding:"10px 14px",marginBottom:4,background:view===v?"rgba(255,255,255,.15)":"transparent",border:"none",borderRadius:10,color:view===v?"#fff":"rgba(255,255,255,.6)",cursor:"pointer",textAlign:"left",fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em",fontWeight:view===v?700:400,display:"flex",alignItems:"center",gap:10}}>
          <span>{icon}</span><span>{label}</span>
        </button>
      ))}
      <button onClick={()=>setShowCashOut(true)}
        style={{width:"100%",padding:"10px 14px",marginBottom:4,background:"rgba(37,99,235,.15)",border:"1.5px solid rgba(37,99,235,.3)",borderRadius:10,color:"#93c5fd",cursor:"pointer",textAlign:"left",fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em",fontWeight:600,display:"flex",alignItems:"center",gap:10}}>
        <span>🚛</span><span>รถส่งของ / ซื้อสด</span>
      </button>
      <button onClick={()=>setShowReport(true)}
        style={{width:"100%",padding:"10px 14px",marginBottom:4,background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.2)",borderRadius:10,color:"rgba(255,255,255,.8)",cursor:"pointer",textAlign:"left",fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em",fontWeight:600,display:"flex",alignItems:"center",gap:10}}>
        <span>📄</span><span>รายงาน / พิมพ์</span>
      </button>
      <div style={{position:"absolute",bottom:24,left:12,right:12}}>
        <button onClick={()=>setShowSupport(true)} style={{width:"100%",padding:"8px 14px",background:"rgba(245,158,11,.2)",border:"1px solid rgba(245,158,11,.4)",borderRadius:10,color:"#fbbf24",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.85em",marginBottom:8}}>☕ สนับสนุนค่ากาแฟ</button>
        <button onClick={goToSettings} style={{width:"100%",padding:"8px 14px",background:"rgba(255,255,255,.1)",border:"none",borderRadius:10,color:"rgba(255,255,255,.7)",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.85em",display:"flex",alignItems:"center",gap:8}}>⚙️ ตั้งค่า{pendingHelpers.filter(h=>h.status==="pending").length>0&&<span style={{background:"#ef4444",color:"#fff",borderRadius:"50%",width:18,height:18,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.75em",fontWeight:700}}>{pendingHelpers.filter(h=>h.status==="pending").length}</span>}</button>
      </div>
    </div>
  );

  // ── Bottom Nav for Mobile/Tablet ─────────────
  const BottomNav=()=>(
    <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderTop:"1px solid #e5e7eb",display:"flex",zIndex:100,maxWidth:"100%"}}>
      {[["dashboard","🏠","หน้าหลัก"],["list","👥","ลูกหนี้"],["addDebt","➕","บันทึก"],["calendar","📅","ปฏิทิน"],["dueSummary","📊","สรุป"]].map(([v,icon,label])=>(
        <button key={v} onClick={()=>{setSearchQ("");if(v==="addDebt")setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:"",interestRate:""});setView(v);}}
          style={{flex:1,padding:"8px 0 6px",background:"none",border:"none",cursor:"pointer",color:view===v?"#1a7a4a":"#9ca3af",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
          <span style={{fontSize:18}}>{icon}</span>
          <span style={{fontSize:"0.65em",fontFamily:"'Sarabun',sans-serif",fontWeight:view===v?700:400}}>{label}</span>
        </button>
      ))}
      <button onClick={()=>setShowCashOut(true)}
        style={{flex:1,padding:"8px 0 6px",background:"none",border:"none",cursor:"pointer",color:"#2563eb",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
        <span style={{fontSize:18}}>🚛</span>
        <span style={{fontSize:"0.65em",fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>ซื้อสด</span>
      </button>
    </div>
  );

  // ── Loading/Error screens ────────────────────
  if(initState==="loading") return(
    <div style={{...S,minHeight:"100vh",background:"linear-gradient(160deg,#1a3a2a,#0d1f17)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <div style={{fontSize:52,marginBottom:16}}>🏪</div>
      <div style={{color:"#fff",fontWeight:800,fontSize:"1.3em",marginBottom:6}}>สมุดหนี้โชห่วย</div>
      <div style={{color:"rgba(255,255,255,.5)",fontSize:"0.82em",marginBottom:24}}>กำลังโหลดข้อมูลจาก Server... {APP_VERSION}</div>
      <div style={{width:32,height:32,border:"3px solid rgba(255,255,255,.2)",borderTop:"3px solid #22c55e",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
  if(initState==="error") return(
    <div style={{...S,minHeight:"100vh",background:"#f4f6f0",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:16}}>⚠️</div>
      <div style={{fontWeight:700,color:"#ef4444",marginBottom:8}}>โหลดข้อมูลไม่สำเร็จ</div>
      <button onClick={()=>loadAll()} style={{padding:"12px 28px",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"1em"}}>🔄 ลองใหม่</button>
    </div>
  );
  if(showPin) return <PinScreen onSuccess={()=>{setShowPin(false);setPinUnlocked(true);setDraft({...settings});setView("settings");}} onCancel={()=>setShowPin(false)}/>;

  // ── SETTINGS ────────────────────────────────
  if(view==="settings") return(
    <div style={{...containerStyle}}>
      {isDesktop&&<SidebarNav/>}
      <div style={{flex:1,paddingBottom:isDesktop?0:80}}>
        {toast&&<Toast msg={toast.msg} icon={toast.icon}/>}
        <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10}}>
          <button onClick={()=>{setPinUnlocked(false);setView("dashboard");}} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
          <span style={{fontWeight:700,fontSize:"1.1em",flex:1}}>⚙️ ตั้งค่า</span>
          <span style={{background:"rgba(255,255,255,.15)",borderRadius:8,padding:"3px 10px",fontSize:"0.72em"}}>{APP_VERSION}{settings.isFullVersion?" 🎉 Full":""}</span>
        </div>
        <div style={{padding:16,maxWidth:600}}>

          {/* PromptPay */}
          <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{background:"#004f9f",color:"#fff",borderRadius:6,padding:"2px 10px",fontSize:"0.8em",fontWeight:700}}>PromptPay</span>
              <span style={{fontWeight:700}}>เบอร์รับเงิน</span>
            </div>
            <input value={draft.promptpayId||""} onChange={e=>setDraft(s=>({...s,promptpayId:e.target.value}))}
              placeholder="0871407251" inputMode="numeric"
              style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}}/>
            {(draft.promptpayId||"").length>=10&&(
              <div style={{marginTop:10,textAlign:"center"}}>
                {qrUrl(genQR(draft.promptpayId,0),120)&&<img src={qrUrl(genQR(draft.promptpayId,0),120)} alt="preview" style={{borderRadius:10,border:"2px solid #e5e7eb"}}/>}
              </div>
            )}
          </div>

          {/* Admin Emails */}
          <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
            <div style={{fontWeight:700,marginBottom:12,display:"flex",alignItems:"center",gap:6}}>
              <span>📧</span><span>อีเมลแจ้งเตือน</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#f0fdf4",borderRadius:10,marginBottom:8,border:"1.5px solid #22c55e"}}>
              <div style={{width:28,height:28,borderRadius:"50%",background:"#15803d",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:12,fontWeight:700,flexShrink:0}}>👑</div>
              <div style={{flex:1,fontSize:"0.85em"}}><b style={{color:"#15803d"}}>Admin หลัก</b><br/>{MAIN_ADMIN}</div>
              <span style={{background:"#bbf7d0",borderRadius:6,padding:"2px 8px",fontSize:"0.72em",fontWeight:700,color:"#15803d"}}>เสมอ</span>
            </div>
            {(draft.adminEmails||[]).map(e=>(
              <div key={e} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"#fff",borderRadius:10,marginBottom:8,border:"1.5px solid #e5e7eb"}}>
                <div style={{flex:1,fontSize:"0.85em",wordBreak:"break-all"}}>{e}</div>
                <button onClick={()=>setDraft(s=>({...s,adminEmails:s.adminEmails.filter(x=>x!==e)}))} style={{background:"#fee2e2",border:"none",borderRadius:8,padding:"5px 10px",cursor:"pointer",color:"#ef4444",fontWeight:700,fontSize:"0.82em"}}>ลบ</button>
              </div>
            ))}
            <div style={{display:"flex",gap:8}}>
              <input id="addEmail" placeholder="เพิ่มอีเมล..." style={{flex:1,padding:"9px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.88em",outline:"none"}}/>
              <button onClick={()=>{const v=document.getElementById("addEmail").value.trim().toLowerCase();if(v.includes("@")&&!draft.adminEmails.includes(v)){setDraft(s=>({...s,adminEmails:[...(s.adminEmails||[]),v]}));document.getElementById("addEmail").value="";} }}
                style={{padding:"9px 14px",background:"#3b82f6",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.88em"}}>+ เพิ่ม</button>
            </div>
          </div>

          {/* LINE OA Section */}
          <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <span style={{background:"#06c755",color:"#fff",borderRadius:6,padding:"2px 10px",fontSize:"0.8em",fontWeight:700}}>LINE</span>
              <span style={{fontWeight:700}}>แจ้งเตือนผ่าน LINE OA</span>
            </div>
            {/* LINE OA ID */}
            <div style={{marginBottom:10}}>
              <div style={{fontSize:"0.82em",color:"#6b7280",marginBottom:4}}>LINE OA ID (@username)</div>
              <div style={{display:"flex",gap:8}}>
                <input value={draft.lineOAId||""} onChange={e=>setDraft(s=>({...s,lineOAId:e.target.value}))}
                  placeholder="@xxxxxxxxx"
                  style={{flex:1,padding:"9px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em",outline:"none"}}/>
                {draft.lineOAId&&(
                  <button onClick={()=>window.open("https://line.me/R/ti/p/"+draft.lineOAId,"_blank")}
                    style={{padding:"9px 14px",background:"#06c755",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.85em",flexShrink:0,whiteSpace:"nowrap"}}>
                    ✅ ทดสอบ
                  </button>
                )}
              </div>
            </div>

            {/* Add Friend Button Preview */}
            {draft.lineOAId&&(
              <div style={{background:"#f0fdf4",borderRadius:12,padding:14,marginBottom:10,textAlign:"center",border:"1.5px solid #22c55e"}}>
                <div style={{fontSize:"0.8em",color:"#15803d",marginBottom:8}}>ปุ่มนี้จะแสดงในหน้าสมัครรับแจ้งเตือน</div>
                <a href={"https://line.me/R/ti/p/"+draft.lineOAId} target="_blank" rel="noreferrer"
                  style={{display:"inline-flex",alignItems:"center",gap:10,background:"#06c755",color:"#fff",padding:"12px 24px",borderRadius:50,textDecoration:"none",fontWeight:700,fontSize:"1em",boxShadow:"0 4px 14px rgba(6,199,85,.4)"}}>
                  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/LINE_logo.svg/1200px-LINE_logo.svg.png" alt="LINE" width={22} height={22} style={{borderRadius:4}}/>
                  เพิ่ม LINE OA เป็นเพื่อน
                </a>
              </div>
            )}

            {/* Channel Token */}
            <div style={{marginBottom:10}}>
              <div style={{fontSize:"0.82em",color:"#6b7280",marginBottom:4}}>Channel Access Token</div>
              <input value={draft.channelToken||""} onChange={e=>setDraft(s=>({...s,channelToken:e.target.value}))}
                placeholder="วาง Long-lived Channel Access Token..."
                style={{width:"100%",padding:"9px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",boxSizing:"border-box",outline:"none"}}/>
            </div>

            {/* Send Registration Link */}
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <button onClick={()=>window.open(getLineRegisterPage(draft.lineOAId),"_blank")}
                style={{flex:1,padding:"10px 0",background:"#06c755",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.85em"}}>
                📤 หน้าสมัคร LINE (ส่งให้ผู้ช่วย)
              </button>
              <button onClick={()=>{const url=getLineRegisterPage(draft.lineOAId);navigator.clipboard?.writeText(url).then(()=>alert("Copy แล้ว!\n"+url)).catch(()=>alert("URL: "+url));}}
                style={{padding:"10px 14px",background:"#eff6ff",border:"1.5px solid #3b82f6",borderRadius:10,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.85em",color:"#3b82f6",flexShrink:0}}>
                📋 Copy
              </button>
            </div>

            <div style={{fontSize:"0.8em",color:"#6b7280",background:"#eff6ff",borderRadius:8,padding:"8px 12px",lineHeight:1.6}}>
              <b>Webhook URL สำหรับ LINE Developers:</b><br/>
              <code style={{fontSize:"0.85em",wordBreak:"break-all",color:"#1e40af",userSelect:"all"}}>{GAS_URL}</code>
            </div>
            {/* Pending helpers */}
            {pendingHelpers.filter(h=>h.status==="pending").length>0&&(
              <div style={{marginTop:12}}>
                <div style={{fontWeight:700,marginBottom:8,color:"#f59e0b"}}>⏳ รออนุมัติ ({pendingHelpers.filter(h=>h.status==="pending").length} คน)</div>
                {pendingHelpers.filter(h=>h.status==="pending").map(h=>(
                  <div key={h.uid} style={{background:"#fff7ed",borderRadius:10,padding:"10px 12px",marginBottom:8,display:"flex",alignItems:"center",gap:10}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:"0.8em",fontWeight:600}}>LINE UID:</div>
                      <div style={{fontSize:"0.75em",color:"#374151",wordBreak:"break-all",fontFamily:"monospace"}}>{h.uid}</div>
                      <div style={{fontSize:"0.72em",color:"#9ca3af"}}>{h.timestamp}</div>
                    </div>
                    <button onClick={()=>doApproveHelper(h.uid)} style={{padding:"6px 12px",background:"#22c55e",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:600,fontSize:"0.82em",fontFamily:"'Sarabun',sans-serif",flexShrink:0}}>✅ อนุมัติ</button>
                    <button onClick={()=>doRejectHelper(h.uid)} style={{padding:"6px 10px",background:"#fee2e2",color:"#ef4444",border:"none",borderRadius:8,cursor:"pointer",fontWeight:600,fontSize:"0.82em",fontFamily:"'Sarabun',sans-serif",flexShrink:0}}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{marginTop:12}}>
              <div style={{fontSize:"0.82em",color:"#6b7280",marginBottom:4}}>LINE UIDs ที่อนุมัติแล้ว ({(draft.adminLineUids||[]).length} คน)</div>
              {(draft.adminLineUids||[]).map(uid=>(
                <div key={uid} style={{display:"flex",gap:8,alignItems:"center",marginBottom:6,padding:"6px 10px",background:"#f9fafb",borderRadius:8}}>
                  <div style={{flex:1,fontFamily:"monospace",fontSize:"0.78em",color:"#374151",wordBreak:"break-all"}}>{uid}{uid===("Ub41fc0cdada0f290836a5b8258baccd1")?" 👑":""}</div>
                  {uid!=="Ub41fc0cdada0f290836a5b8258baccd1"&&<button onClick={()=>setDraft(s=>({...s,adminLineUids:s.adminLineUids.filter(x=>x!==uid)}))} style={{background:"#fee2e2",border:"none",borderRadius:6,padding:"4px 8px",cursor:"pointer",color:"#ef4444",fontSize:"0.78em",flexShrink:0}}>ลบ</button>}
                </div>
              ))}
            </div>
          </div>

          {/* Support settings */}
          <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
            <div style={{fontWeight:700,marginBottom:12}}>☕ ตั้งค่าสนับสนุน</div>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <div style={{flex:1}}>
                <div style={{fontSize:"0.82em",color:"#6b7280",marginBottom:4}}>จำนวนเงิน (บาท)</div>
                <input type="number" value={draft.supportAmount||399} onChange={e=>setDraft(s=>({...s,supportAmount:Number(e.target.value)||399}))}
                  style={{width:"100%",padding:"9px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:"0.82em",color:"#6b7280",marginBottom:4}}>PromptPay รับค่ากาแฟ</div>
                <input value={draft.supportPromptpay||draft.promptpayId||""} onChange={e=>setDraft(s=>({...s,supportPromptpay:e.target.value}))}
                  placeholder="เบอร์" style={{width:"100%",padding:"9px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em",boxSizing:"border-box",outline:"none"}}/>
              </div>
            </div>
          </div>

          {/* Backup */}
          <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
            <div style={{fontWeight:700,marginBottom:12}}>☁️ Backup ข้อมูล</div>
            <button onClick={doBackup} disabled={backupState==="loading"}
              style={{width:"100%",padding:"12px 0",background:backupState==="done"?"#22c55e":backupState==="error"?"#ef4444":backupState==="loading"?"#9ca3af":"#0f9d58",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em"}}>
              {backupState==="loading"?"⏳ กำลัง Backup...":backupState==="done"?"✅ Backup สำเร็จ!":backupState==="error"?"❌ ล้มเหลว":"☁️ Backup ขึ้น Google Sheets ทันที"}
            </button>
          </div>

          {/* Version */}
          <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
            <div style={{fontWeight:700,marginBottom:12}}>🔑 รหัส Full Version</div>
            {settings.isFullVersion?(
              <div style={{background:"#f0fdf4",borderRadius:10,padding:10,textAlign:"center",color:"#15803d",fontWeight:700}}>🎉 Full Version Activated!</div>
            ):(
              <div style={{display:"flex",gap:8}}>
                <input value={versionCode} onChange={e=>setVersionCode(e.target.value)} placeholder="กรอกรหัส..."
                  style={{flex:1,padding:"9px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em",outline:"none"}}/>
                <button onClick={doVerifyVersion} style={{padding:"9px 14px",background:"#1a3a2a",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.88em"}}>ยืนยัน</button>
              </div>
            )}
          </div>

          <button onClick={doSaveSettings} style={{width:"100%",padding:"14px 0",background:"#1a3a2a",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",marginBottom:14,boxShadow:"0 4px 16px rgba(26,58,42,.3)"}}>
            💾 บันทึกการตั้งค่าขึ้น Server
          </button>

          <div style={{background:"#fff",borderRadius:14,padding:16}}>
            <div style={{fontWeight:700,marginBottom:12,color:"#1a3a2a"}}>🔤 ขนาดตัวอักษร</div>
            <div style={{display:"flex",gap:8}}>
              {[["sm","เล็ก"],["md","กลาง"],["lg","ใหญ่"],["xl","ใหญ่มาก"]].map(([k,l])=>(
                <button key={k} onClick={()=>setFontSize(k)} style={{flex:1,padding:"10px 4px",borderRadius:10,border:`2px solid ${fontSize===k?"#1a7a4a":"#e5e7eb"}`,background:fontSize===k?"#f0fdf4":"#fff",fontWeight:fontSize===k?700:400,color:fontSize===k?"#1a7a4a":"#6b7280",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:FS[k]}}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {!isDesktop&&<BottomNav/>}
    </div>
  );

  // ── CUSTOMER ────────────────────────────────
  if(view==="customer"&&selectedCid){
    const c=customers.find(x=>x.id===selectedCid);
    if(!c){setView("list");return null;}
    const txList=[...transactions].filter(t=>t.customerId===c.id).sort((a,b)=>b.id-a.id);
    const totalInterest=txList.filter(t=>!t.paid).reduce((s,t)=>s+calcInterest(t),0);
    return(
      <div style={{...containerStyle}}>
        {isDesktop&&<SidebarNav/>}
        <div style={{flex:1,paddingBottom:isDesktop?0:80}}>
          {toast&&<Toast msg={toast.msg} icon={toast.icon}/>}
          {editingTx&&<EditDebtModal tx={editingTx} customer={c} onSave={handleUpdateDebt} onClose={()=>setEditingTx(null)}/>}
          {showQR&&<QRModal c={c} settings={settings} onPaid={async amt=>{await handleMarkPaid(c.id,amt);}} onClose={()=>setShowQR(false)}/>}
          <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 24px",position:"sticky",top:0,zIndex:10}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
              <button onClick={()=>setView("list")} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
              <span style={{fontWeight:700,fontSize:"1.1em",flex:1}}>ประวัติลูกค้า</span>
              <button onClick={()=>loadAll(true)} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:10,padding:"6px 12px",color:"#fff",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",fontWeight:600}}>{refreshing?"⏳":"🔄"}</button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:14}}>
              <div style={{position:"relative",width:64,height:64,flexShrink:0}}>
                <Avatar c={c} size={64}/>
                <PhotoUploadBtn customerId={c.id} onUploaded={url=>handlePhotoUploaded(c.id,url)}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:"1.2em"}}>{c.name}</div>
                <PhoneEdit phone={c.phone} onSave={phone=>handleSavePhone(c.id,phone)}/>
              </div>
            </div>
          </div>
          <div style={{padding:16}}>
            <div style={{background:"#fff",borderRadius:16,padding:16,boxShadow:"0 4px 20px rgba(0,0,0,.08)",marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{color:"#6b7280",fontSize:"0.85em"}}>ยอดค้างรวม</div>
                  <div style={{fontWeight:800,fontSize:"1.8em",color:c.totalDebt>0?"#ef4444":"#22c55e"}}>฿{fmt(c.totalDebt)}</div>
                  {totalInterest>0&&<div style={{fontSize:"0.82em",color:"#dc2626"}}>+ ดอกเบี้ย ฿{fmt(totalInterest)}</div>}
                </div>
                {c.dueDate&&<div style={{textAlign:"right"}}><div style={{color:"#6b7280",fontSize:"0.85em"}}>วันทวง</div><div style={{fontWeight:600,color:c.dueDate<=TODAY?"#ef4444":"#374151"}}>{thDate(c.dueDate)}</div></div>}
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              {c.totalDebt>0&&<button onClick={()=>setShowQR(true)} style={{flex:1,padding:"12px 8px",background:"linear-gradient(135deg,#06c755,#04a344)",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em",boxShadow:"0 4px 14px rgba(6,199,85,.35)"}}>💳 QR รับเงิน</button>}
              <button onClick={()=>{setNewDebt({customer:c,items:[{name:"",price:""}],dueDate:"",interestRate:""});setView("addDebt");}} style={{flex:1,padding:"12px 8px",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em"}}>+ บันทึกหนี้</button>
            </div>
            {/* Note */}
            <NoteSection c={c} onSave={(note)=>handleSaveNote(c.id,note)}/>
            <div style={{fontWeight:700,marginBottom:10,color:"#1a3a2a"}}>ประวัติการซื้อ</div>
            {txList.length===0&&<div style={{color:"#9ca3af",textAlign:"center",padding:24}}>ยังไม่มีประวัติ</div>}
            {txList.map(tx=>{
              const interest=calcInterest(tx);
              return(
                <div key={tx.id} style={{background:"#fff",borderRadius:14,padding:14,marginBottom:10,boxShadow:"0 2px 8px rgba(0,0,0,.06)",opacity:tx.paid?.5:1}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,alignItems:"center"}}>
                    <div>
                      <span style={{color:"#6b7280",fontSize:"0.85em"}}>📅 {tx.date}</span>
                      {tx.dueDate&&<span style={{fontSize:"0.78em",color:tx.dueDate<=TODAY&&!tx.paid?"#ef4444":"#9ca3af",marginLeft:8}}>⏰ {thDate(tx.dueDate)}</span>}
                      {tx.interestRate>0&&<span style={{fontSize:"0.75em",background:"#fff7ed",color:"#f59e0b",borderRadius:4,padding:"1px 5px",marginLeft:6}}>{tx.interestRate}%/เดือน</span>}
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <span style={{fontWeight:700,color:tx.paid?"#22c55e":"#ef4444"}}>{tx.paid?"✅ จ่ายแล้ว":`฿${fmt(tx.total)}`}</span>
                      {!tx.paid&&<button onClick={()=>setEditingTx(tx)} style={{background:"#eff6ff",border:"none",borderRadius:8,padding:"3px 8px",cursor:"pointer",color:"#3b82f6",fontWeight:600,fontSize:"0.78em",fontFamily:"'Sarabun',sans-serif"}}>✏️</button>}
                    </div>
                  </div>
                  {(tx.items||[]).map((it,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:"0.9em",color:"#374151",paddingBottom:4}}>
                      <span>{it.name}</span><span>฿{fmt(it.price)}</span>
                    </div>
                  ))}
                  {interest>0&&<div style={{marginTop:6,padding:"4px 8px",background:"#fff7ed",borderRadius:6,fontSize:"0.78em",color:"#b45309"}}>ดอกเบี้ยสะสม: ฿{fmt(interest)}</div>}
                </div>
              );
            })}
          </div>
        </div>
        {!isDesktop&&<BottomNav/>}
      </div>
    );
  }

  // ── CONFIRM ────────────────────────────────
  if(view==="confirm"){const c=newDebt.customer;return(
    <div style={{...containerStyle}}>
      {isDesktop&&<SidebarNav/>}
      <div style={{flex:1,paddingBottom:isDesktop?0:80}}>
        {toast&&<Toast msg={toast.msg} icon={toast.icon}/>}
        <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px",display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>setView("addDebt")} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
          <span style={{fontWeight:700,fontSize:"1.1em"}}>✅ ยืนยันก่อนบันทึก</span>
        </div>
        <div style={{padding:16,maxWidth:600}}>
          <div style={{background:"#fff",borderRadius:16,padding:20,marginBottom:14,boxShadow:"0 4px 20px rgba(0,0,0,.08)",textAlign:"center"}}>
            <div style={{display:"inline-block",marginBottom:12}}><Avatar c={c} size={80}/></div>
            <div style={{fontWeight:800,fontSize:"1.3em",color:"#1a3a2a"}}>{c.name}</div>
          </div>
          <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
            {newDebt.items.filter(it=>it.name||it.price).map((it,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f3f4f6"}}>
                <span>{it.name||"รายการ"}</span><span style={{fontWeight:600}}>฿{fmt(parseFloat(it.price)||0)}</span>
              </div>
            ))}
            {newDebt.interestRate>0&&<div style={{padding:"6px 0",color:"#f59e0b",fontSize:"0.85em"}}>💰 ดอกเบี้ย {newDebt.interestRate}% / เดือน</div>}
            {newDebt.dueDate&&<div style={{padding:"6px 0",color:"#6b7280",fontSize:"0.85em"}}>📅 วันทวง {thDate(newDebt.dueDate)}</div>}
            <div style={{display:"flex",justifyContent:"space-between",marginTop:10,paddingTop:10,borderTop:"2px solid #1a3a2a"}}>
              <span style={{fontWeight:700}}>รวมครั้งนี้</span><span style={{fontWeight:800,color:"#ef4444",fontSize:"1.1em"}}>฿{fmt(debtTotal)}</span>
            </div>
          </div>
          <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
            <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",color:"#6b7280"}}><span>ยอดค้างเดิม</span><span>฿{fmt(c.totalDebt)}</span></div>
            <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",color:"#6b7280"}}><span>เพิ่มวันนี้</span><span style={{color:"#ef4444"}}>+฿{fmt(debtTotal)}</span></div>
            <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0 0",borderTop:"2px dashed #e5e7eb",marginTop:6}}>
              <span style={{fontWeight:800}}>ยอดค้างรวมใหม่</span><span style={{fontWeight:800,fontSize:"1.2em",color:"#ef4444"}}>฿{fmt(c.totalDebt+debtTotal)}</span>
            </div>
          </div>
          <div style={{background:"#eff6ff",borderRadius:12,padding:"10px 14px",marginBottom:16,fontSize:"0.82em",color:"#1e40af"}}>
            📧 แจ้ง {1+(settings.adminEmails||[]).length} อีเมล{settings.channelToken?` + LINE ${(settings.adminLineUids||[]).length} คน`:""}
          </div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>setView("addDebt")} style={{flex:1,padding:"14px 0",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:14,fontWeight:700,fontSize:"1em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>← แก้ไข</button>
            <button onClick={confirmDebt} style={{flex:2,padding:"14px 0",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.05em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 16px rgba(26,122,74,.4)"}}>✅ ยืนยัน + แจ้งเตือน</button>
          </div>
        </div>
      </div>
      {!isDesktop&&<BottomNav/>}
    </div>
  );}

  // ── ADD DEBT ────────────────────────────────
  if(view==="addDebt") return(
    <div style={{...containerStyle}}>
      {isDesktop&&<SidebarNav/>}
      <div style={{flex:1,paddingBottom:isDesktop?0:80}}>
        {toast&&<Toast msg={toast.msg} icon={toast.icon}/>}
        <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px",display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>{setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:"",interestRate:""});setView("dashboard");setShowNewCust(false);}} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
          <span style={{fontWeight:700,fontSize:"1.1em"}}>+ บันทึกหนี้ใหม่</span>
        </div>
        <div style={{padding:16,maxWidth:600}}>
          {/* Customer select */}
          <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
            <div style={{fontWeight:700,marginBottom:10,color:"#1a3a2a"}}>① เลือกลูกค้า</div>
            <input value={searchQ} onChange={e=>{setSearchQ(e.target.value);setShowNewCust(false);}} placeholder="🔍 พิมพ์ชื่อลูกค้า..."
              style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}}/>
            <div style={{maxHeight:220,overflowY:"auto",marginTop:8}}>
              {filtered.map(c=>(
                <div key={c.id} onClick={()=>{setNewDebt(d=>({...d,customer:c}));setSearchQ("");}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 8px",borderRadius:10,cursor:"pointer",background:newDebt.customer?.id===c.id?"#f0fdf4":"transparent",border:newDebt.customer?.id===c.id?"1.5px solid #22c55e":"1.5px solid transparent",marginBottom:4}}>
                  <Avatar c={c} size={36}/>
                  <div style={{flex:1}}><div style={{fontWeight:600}}>{c.name}</div><div style={{fontSize:"0.82em",color:c.totalDebt>0?"#ef4444":"#6b7280"}}>{c.totalDebt>0?`ค้างอยู่ ฿${fmt(c.totalDebt)}`:"ไม่มียอดค้าง"}</div></div>
                  {newDebt.customer?.id===c.id&&<span style={{color:"#22c55e",fontWeight:700}}>✓</span>}
                </div>
              ))}
              {searchQ&&!filtered.find(c=>c.name===searchQ)&&!showNewCust&&(
                <div onClick={()=>{setNewCustName(searchQ);setShowNewCust(true);}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 8px",borderRadius:10,cursor:"pointer",background:"#eff6ff",border:"1.5px dashed #3b82f6",marginTop:4}}>
                  <span style={{fontSize:20}}>➕</span><span style={{color:"#3b82f6",fontWeight:600}}>เพิ่ม "{searchQ}" เป็นลูกค้าใหม่</span>
                </div>
              )}
              {showNewCust&&(
                <div style={{background:"#eff6ff",borderRadius:12,padding:14,marginTop:8,border:"1.5px solid #3b82f6"}}>
                  <div style={{fontWeight:700,color:"#1e40af",marginBottom:10}}>👤 เพิ่มลูกค้าใหม่</div>
                  <input value={newCustName} onChange={e=>setNewCustName(e.target.value)} placeholder="ชื่อลูกค้า"
                    style={{width:"100%",padding:"9px 12px",border:"1.5px solid #93c5fd",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none",marginBottom:10}}/>
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:"0.85em",color:"#1e40af",marginBottom:6}}>📷 รูปภาพ (ไม่บังคับ)</div>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      {newCustPhoto?<img src={newCustPhoto} alt="" style={{width:52,height:52,borderRadius:"50%",objectFit:"cover",border:"2px solid #3b82f6"}}/>:<div style={{width:52,height:52,borderRadius:"50%",background:"#dbeafe",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>👤</div>}
                      <input ref={ncPhotoRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={async e=>{const f=e.target.files[0];if(f){const b=await compressImage(f,300);setNewCustPhoto(b);}}}/>
                      <button onClick={()=>ncPhotoRef.current?.click()} style={{padding:"7px 12px",background:"#3b82f6",color:"#fff",border:"none",borderRadius:8,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.85em"}}>📷 ถ่ายรูป</button>
                      {newCustPhoto&&<button onClick={()=>setNewCustPhoto(null)} style={{padding:"7px 10px",background:"#fee2e2",color:"#ef4444",border:"none",borderRadius:8,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em"}}>✕</button>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{setShowNewCust(false);setNewCustPhoto(null);}} style={{flex:1,padding:"9px 0",background:"#f3f4f6",border:"none",borderRadius:10,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",color:"#374151",fontSize:"0.9em"}}>ยกเลิก</button>
                    <button onClick={doAddCustomer} style={{flex:2,padding:"9px 0",background:"#3b82f6",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em"}}>✅ เพิ่มลูกค้า</button>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Items */}
          <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
            <div style={{fontWeight:700,marginBottom:10,color:"#1a3a2a"}}>② รายการสินค้า</div>
            {newDebt.items.map((it,i)=>(
              <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
                <input value={it.name} onChange={e=>updItem(i,"name",e.target.value)} placeholder="ชื่อสินค้า" style={{flex:2,padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",outline:"none"}}/>
                <input value={it.price} onChange={e=>updItem(i,"price",e.target.value)} placeholder="฿" type="number" inputMode="decimal" style={{flex:1,padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",outline:"none"}}/>
                {newDebt.items.length>1&&<button onClick={()=>removeItem(i)} style={{background:"#fee2e2",border:"none",borderRadius:8,padding:"8px 10px",cursor:"pointer",color:"#ef4444",fontWeight:700}}>🗑</button>}
              </div>
            ))}
            <button onClick={addItem} style={{width:"100%",padding:"10px 0",background:"#f0fdf4",border:"1.5px dashed #22c55e",borderRadius:10,color:"#15803d",fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"1em",marginTop:4}}>+ เพิ่มรายการ</button>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:14,padding:"10px 12px",background:"#f9fafb",borderRadius:10}}>
              <span style={{fontWeight:700}}>รวม</span><span style={{fontWeight:800,fontSize:"1.15em"}}>฿{fmt(debtTotal)}</span>
            </div>
          </div>
          {/* Due + Interest */}
          <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:20,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
            <div style={{display:"flex",gap:8}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,marginBottom:8,color:"#1a3a2a"}}>📅 วันทวง</div>
                <input type="date" value={newDebt.dueDate} onChange={e=>setNewDebt(d=>({...d,dueDate:e.target.value}))} style={{width:"100%",padding:"9px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em",boxSizing:"border-box",outline:"none"}}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,marginBottom:8,color:"#1a3a2a"}}>💰 ดอกเบี้ย %/เดือน</div>
                <input type="number" inputMode="decimal" value={newDebt.interestRate} onChange={e=>setNewDebt(d=>({...d,interestRate:e.target.value}))} placeholder="0 = ไม่มี" style={{width:"100%",padding:"9px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em",boxSizing:"border-box",outline:"none"}}/>
              </div>
            </div>
          </div>
          <button onClick={()=>{if(newDebt.customer&&debtTotal>0)setView("confirm");}} disabled={!newDebt.customer||debtTotal<=0}
            style={{width:"100%",padding:"16px 0",background:newDebt.customer&&debtTotal>0?"#1a7a4a":"#d1d5db",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.1em",cursor:newDebt.customer&&debtTotal>0?"pointer":"not-allowed",fontFamily:"'Sarabun',sans-serif"}}>
            ถัดไป → ยืนยัน
          </button>
        </div>
      </div>
      {!isDesktop&&<BottomNav/>}
    </div>
  );

  // ── LIST ────────────────────────────────────
  if(view==="list") {
    // ── Sort & filter logic ──
    const sortFns = {
      debtDesc: (a,b) => b.totalDebt - a.totalDebt,
      debtAsc:  (a,b) => a.totalDebt - b.totalDebt,
      nameAsc:  (a,b) => a.name.localeCompare(b.name,"th"),
      nameDesc: (a,b) => b.name.localeCompare(a.name,"th"),
      dueSoon:  (a,b) => {
        if(!a.dueDate&&!b.dueDate) return 0;
        if(!a.dueDate) return 1;
        if(!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      },
    };
    const allFiltered     = customers.filter(c=>c.name.includes(searchQ));
    const activeDebtors   = allFiltered.filter(c=>c.totalDebt>0).sort(sortFns[listSort]);
    const paidCustomers   = allFiltered.filter(c=>c.totalDebt===0).sort(sortFns["nameAsc"]);
    const sortLabels = {
      debtDesc:"฿ มากสุด",debtAsc:"฿ น้อยสุด",
      nameAsc:"ก–ฮ",nameDesc:"ฮ–ก",dueSoon:"ใกล้ทวง",
    };
    const sortKeys = Object.keys(sortLabels);

    const CustomerCard = ({c}) => {
      const isOverdue = c.dueDate && c.dueDate <= TODAY && c.totalDebt > 0;
      return (
        <div onClick={()=>{setSelectedCid(c.id);setView("customer");}}
          style={{background:"#fff",borderRadius:14,padding:14,marginBottom:isDesktop?0:10,
            boxShadow:isOverdue?"0 2px 10px rgba(239,68,68,.2)":"0 2px 8px rgba(0,0,0,.06)",
            display:"flex",alignItems:"center",gap:12,cursor:"pointer",
            borderLeft:`4px solid ${isOverdue?"#ef4444":c.totalDebt>0?"#f59e0b":"#22c55e"}`}}>
          <Avatar c={c} size={48}/>
          <div style={{flex:1}}>
            <div style={{fontWeight:700}}>{c.name}</div>
            <div style={{fontSize:"0.82em",color:"#6b7280",display:"flex",gap:8,flexWrap:"wrap"}}>
              {c.phone&&<span>📞 {c.phone}</span>}
              {c.dueDate&&c.totalDebt>0&&(
                <span style={{color:isOverdue?"#ef4444":"#9ca3af"}}>
                  {isOverdue?"🔴 เกิน":"⏰"} {thDate(c.dueDate)}
                </span>
              )}
            </div>
            {c.note&&(
              <div style={{fontSize:"0.76em",color:"#92400e",background:"#fffbeb",borderRadius:6,padding:"2px 8px",marginTop:4,display:"inline-block",maxWidth:"95%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",border:"1px solid #fde68a"}}>
                📝 {c.note.length>38?c.note.slice(0,38)+"…":c.note}
              </div>
            )}
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontWeight:800,fontSize:"1.05em",
              color:c.totalDebt>0?(isOverdue?"#ef4444":"#e07b39"):"#22c55e"}}>
              ฿{fmt(c.totalDebt)}
            </div>
            {c.totalDebt===0&&<div style={{fontSize:"0.72em",color:"#22c55e"}}>✅ ชำระครบ</div>}
          </div>
        </div>
      );
    };

    return(
      <div style={{...containerStyle}}>
        {isDesktop&&<SidebarNav/>}
        <div style={{flex:1,paddingBottom:isDesktop?0:80}}>
          {toast&&<Toast msg={toast.msg} icon={toast.icon}/>}

          {/* Header */}
          <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 12px",position:"sticky",top:0,zIndex:10}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
              {!isDesktop&&<button onClick={()=>setView("dashboard")} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>}
              <span style={{fontWeight:700,fontSize:"1.1em",flex:1}}>
                💸 ค้างชำระ <span style={{opacity:.7,fontWeight:400,fontSize:"0.85em"}}>({activeDebtors.length} ราย)</span>
              </span>
              <button onClick={()=>loadAll(true)} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:10,padding:"6px 12px",color:"#fff",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",fontWeight:600}}>
                {refreshing?"⏳":"🔄"}
              </button>
            </div>
            {/* Search */}
            <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="🔍 ค้นหาชื่อ..."
              style={{width:"100%",padding:"9px 14px",borderRadius:12,border:"none",background:"rgba(255,255,255,.15)",color:"#fff",fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none",marginBottom:10}}/>
            {/* Sort bar */}
            <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:2}}>
              <span style={{color:"rgba(255,255,255,.5)",fontSize:"0.78em",flexShrink:0,lineHeight:"28px"}}>เรียง:</span>
              {sortKeys.map(k=>(
                <button key={k} onClick={()=>setListSort(k)}
                  style={{padding:"4px 12px",borderRadius:20,border:"none",cursor:"pointer",flexShrink:0,fontFamily:"'Sarabun',sans-serif",fontSize:"0.78em",fontWeight:listSort===k?700:400,
                    background:listSort===k?"#fff":"rgba(255,255,255,.15)",
                    color:listSort===k?"#1a3a2a":"rgba(255,255,255,.75)"}}>
                  {sortLabels[k]}
                </button>
              ))}
            </div>
          </div>

          <div style={{padding:16}}>
            {/* Active debtors */}
            {activeDebtors.length===0&&!searchQ&&(
              <div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>
                <div style={{fontSize:48,marginBottom:12}}>✅</div>
                <div style={{fontWeight:700,color:"#22c55e",fontSize:"1.1em"}}>ไม่มียอดค้างชำระ!</div>
                <div style={{fontSize:"0.85em",marginTop:6}}>ลูกค้าทุกคนชำระครบแล้ว 🎉</div>
              </div>
            )}
            {activeDebtors.length===0&&searchQ&&(
              <div style={{textAlign:"center",padding:32,color:"#9ca3af"}}>ไม่พบลูกค้าที่ค้างชำระ "{searchQ}"</div>
            )}
            <div style={{display:isDesktop?"grid":"block",gridTemplateColumns:isDesktop?"1fr 1fr":undefined,gap:isDesktop?12:undefined}}>
              {activeDebtors.map(c=><CustomerCard key={c.id} c={c}/>)}
            </div>

            {/* Summary bar */}
            {activeDebtors.length>0&&(
              <div style={{background:"#fff",borderRadius:12,padding:"12px 16px",marginTop:8,marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
                <span style={{color:"#6b7280",fontSize:"0.85em"}}>รวมยอดค้างทั้งหมด</span>
                <span style={{fontWeight:800,fontSize:"1.15em",color:"#ef4444"}}>฿{fmt(activeDebtors.reduce((s,c)=>s+c.totalDebt,0))}</span>
              </div>
            )}

            {/* History toggle */}
            <button onClick={()=>setShowHistory(h=>!h)}
              style={{width:"100%",padding:"11px 16px",background:showHistory?"#f0fdf4":"#f9fafb",border:`1.5px solid ${showHistory?"#22c55e":"#e5e7eb"}`,borderRadius:12,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:600,fontSize:"0.9em",color:showHistory?"#15803d":"#6b7280",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:showHistory?12:0}}>
              <span>📂 ประวัติลูกหนี้ที่ชำระครบแล้ว ({paidCustomers.length} ราย)</span>
              <span style={{fontSize:"1.1em"}}>{showHistory?"▲":"▼"}</span>
            </button>

            {showHistory&&(
              <div>
                {paidCustomers.length===0&&<div style={{textAlign:"center",padding:20,color:"#9ca3af",fontSize:"0.85em"}}>ยังไม่มีประวัติ</div>}
                <div style={{display:isDesktop?"grid":"block",gridTemplateColumns:isDesktop?"1fr 1fr":undefined,gap:isDesktop?10:undefined}}>
                  {paidCustomers.map(c=><CustomerCard key={c.id} c={c}/>)}
                </div>
              </div>
            )}
          </div>

          {/* FAB */}
          {!isDesktop&&(
            <div style={{position:"fixed",bottom:70,left:"50%",transform:"translateX(-50%)",width:"calc(100% - 32px)",maxWidth:388}}>
              <button onClick={()=>{setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:"",interestRate:""});setView("addDebt");}} style={{width:"100%",padding:"14px 0",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.05em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 20px rgba(26,122,74,.4)"}}>+ บันทึกหนี้ใหม่</button>
            </div>
          )}
        </div>
        {!isDesktop&&<BottomNav/>}
      </div>
    );
  }

  // ── CALENDAR ──────────────────────────────────
  if(view==="calendar") return(
    <div style={{...containerStyle}}>
      {isDesktop&&<SidebarNav/>}
      <div style={{flex:1,paddingBottom:isDesktop?0:80}}>
        {toast&&<Toast msg={toast.msg} icon={toast.icon}/>}
        <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px",position:"sticky",top:0,zIndex:10}}>
          <div style={{fontWeight:700,fontSize:"1.1em"}}>📅 ปฏิทินวันทวงหนี้</div>
          {lastSync&&<div style={{fontSize:"0.72em",opacity:.5}}>sync {lastSync}</div>}
        </div>
        <CalendarView customers={customers} transactions={transactions} onSelectDate={(y,m,d,info)=>setCalDayInfo({y,m,d,info})}/>
        {calDayInfo&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:997,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setCalDayInfo(null)}>
            <div style={{background:"#fff",borderRadius:20,padding:20,width:"100%",maxWidth:380}} onClick={e=>e.stopPropagation()}>
              <div style={{fontWeight:800,marginBottom:12}}>📅 {calDayInfo.d}/{calDayInfo.m+1}/{calDayInfo.y+543} ({calDayInfo.info.count} ราย)</div>
              {calDayInfo.info.customers.map((name,i)=>{
                const c=customers.find(x=>x.name===name);
                return c?(
                  <div key={i} onClick={()=>{setSelectedCid(c.id);setView("customer");setCalDayInfo(null);}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #f3f4f6",cursor:"pointer"}}>
                    <Avatar c={c} size={36}/><div style={{flex:1,fontWeight:600}}>{c.name}</div>
                    <div style={{fontWeight:700,color:"#ef4444"}}>฿{fmt(c.totalDebt)}</div>
                  </div>
                ):null;
              })}
              <button onClick={()=>setCalDayInfo(null)} style={{width:"100%",marginTop:14,padding:"10px 0",background:"#f3f4f6",border:"none",borderRadius:10,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>ปิด</button>
            </div>
          </div>
        )}
      </div>
      {!isDesktop&&<BottomNav/>}
    </div>
  );

  // ── DUE SUMMARY ────────────────────────────
  if(view==="dueSummary") return(
    <div style={{...containerStyle}}>
      {isDesktop&&<SidebarNav/>}
      <div style={{flex:1,paddingBottom:isDesktop?0:80}}>
        {toast&&<Toast msg={toast.msg} icon={toast.icon}/>}
        <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px",position:"sticky",top:0,zIndex:10}}>
          <div style={{fontWeight:700,fontSize:"1.1em"}}>📊 สรุปยอดค้างทั้งหมด</div>
        </div>
        <DueSummary customers={customers} transactions={transactions}/>
      </div>
      {!isDesktop&&<BottomNav/>}
    </div>
  );

  // ── DASHBOARD ─────────────────────────────────
  return(
    <div style={{...containerStyle}}>
      {isDesktop&&<SidebarNav/>}
      <div style={{flex:1,paddingBottom:isDesktop?0:80}}>
        {toast&&<Toast msg={toast.msg} icon={toast.icon}/>}
        {showSupport&&<SupportPage settings={settings} onClose={()=>setShowSupport(false)}/> }
        {showHelp&&<HelpModal onClose={()=>setShowHelp(false)}/>}
        {showCashOut&&<CashOutView onClose={()=>setShowCashOut(false)} showToast={showToast} settings={settings}/>}
        {showReport&&<ReportView customers={customers} transactions={transactions} onClose={()=>setShowReport(false)} settings={settings}/>}
        {showQR&&<QRModal c={customers[0]||{name:"?",totalDebt:0,id:0}} settings={settings} onPaid={()=>{}} onClose={()=>setShowQR(false)}/>}
        <div style={{background:"linear-gradient(135deg,#1a3a2a 0%,#1a7a4a 100%)",color:"#fff",padding:"24px 16px 32px",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:-20,right:-20,width:120,height:120,borderRadius:"50%",background:"rgba(255,255,255,.06)"}}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",position:"relative"}}>
            <div>
              <div style={{fontSize:"0.85em",opacity:.75,marginBottom:2}}>🏪 สมุดหนี้โชห่วย</div>
              <div style={{fontSize:"0.7em",opacity:.45}}>{lastSync?`🌐 ${lastSync}`:""} · {APP_VERSION}{settings.isFullVersion?" 🎉":""}</div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <button onClick={()=>setShowReport(true)}
                style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:10,padding:"6px 12px",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.78em",fontWeight:700,color:"#fff",display:"flex",alignItems:"center",gap:4}}>
                📄 รายงาน
              </button>
              <button onClick={()=>setShowHelp(true)}
                style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:"50%",width:38,height:38,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700}}>?</button>
              <button onClick={()=>setShowSupport(true)} style={{background:"rgba(245,158,11,.3)",border:"1px solid rgba(245,158,11,.5)",borderRadius:10,padding:"6px 10px",color:"#fbbf24",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.78em",fontWeight:600}}>☕ สนับสนุน</button>
              <button onClick={()=>loadAll(true)} disabled={refreshing} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:10,padding:"7px 12px",color:"#fff",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.8em",fontWeight:700,opacity:refreshing?.6:1}}>
                <span style={{display:"inline-block",animation:refreshing?"spin 1s linear infinite":"none"}}>🔄</span> {refreshing?"...":"Refresh"}
              </button>
              <button onClick={goToSettings} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:"50%",width:38,height:38,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                ⚙️
                {pendingHelpers.filter(h=>h.status==="pending").length>0&&<span style={{position:"absolute",top:-2,right:-2,background:"#ef4444",color:"#fff",borderRadius:"50%",width:14,height:14,fontSize:"0.6em",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{pendingHelpers.filter(h=>h.status==="pending").length}</span>}
              </button>
            </div>
          </div>
          <div style={{marginTop:16}}>
            <div style={{fontSize:"0.85em",opacity:.75}}>ยอดค้างรวมทั้งหมด</div>
            <div style={{fontSize:"2.2em",fontWeight:800,letterSpacing:"-0.5px"}}>฿{fmt(totalDebt)}</div>
            <div style={{fontSize:"0.8em",opacity:.65}}>จาก {debtors.length} ราย · {customers.length} ลูกค้า</div>
          </div>
        </div>

        <div style={{padding:"16px 16px 0"}}>
          <div style={{fontSize:"0.78em",color:"#9ca3af",marginBottom:8}}>📌 ลากจัดลำดับ box ได้</div>
          <div style={{display:"grid",gridTemplateColumns:isDesktop?"repeat(4,1fr)":"1fr 1fr",gap:10,marginBottom:16}}>
            {boxOrder.map(key=>{const b=BOXES[key];return(
              <div key={key} draggable onDragStart={()=>onDragStart(key)} onDragOver={e=>onDragOver(e,key)} onDragEnd={onDragEnd} onClick={()=>{setSearchQ("");setView("list");}} style={{background:"#fff",borderRadius:16,padding:"14px 14px",cursor:"pointer",boxShadow:"0 2px 10px rgba(0,0,0,.07)",borderLeft:`4px solid ${b.color}`,opacity:dragBox===key?.5:1,userSelect:"none"}}>
                <div style={{fontSize:"1.2em",marginBottom:4}}>{b.icon}</div>
                <div style={{fontSize:"1.6em",fontWeight:800,color:b.color}}>{b.count}</div>
                <div style={{fontSize:"0.8em",color:"#6b7280",lineHeight:1.3}}>{b.label}</div>
              </div>
            );})}
          </div>

          {/* Recent */}
          <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:16,boxShadow:"0 2px 10px rgba(0,0,0,.07)"}}>
            <div style={{fontWeight:700,marginBottom:12,color:"#1a3a2a",display:"flex",justifyContent:"space-between"}}>
              <span>📋 ล่าสุด</span>
              <span onClick={()=>setView("list")} style={{fontSize:"0.8em",color:"#1a7a4a",cursor:"pointer",fontWeight:400}}>ดูทั้งหมด →</span>
            </div>
            {recentTx.length===0&&<div style={{color:"#9ca3af",textAlign:"center",padding:16,fontSize:"0.9em"}}>ยังไม่มีรายการ</div>}
            {recentTx.map(tx=>(
              <div key={tx.id} onClick={()=>{if(tx.customer){setSelectedCid(tx.customer.id);setView("customer");}}} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #f3f4f6",cursor:"pointer"}}>
                {tx.customer?<Avatar c={tx.customer} size={36}/>:<div style={{width:36,height:36,borderRadius:"50%",background:"#e5e7eb",flexShrink:0}}/>}
                <div style={{flex:1}}><div style={{fontWeight:600}}>{tx.customer?.name||"?"}</div><div style={{fontSize:"0.8em",color:"#9ca3af"}}>{tx.date}{tx.dueDate?` · ทวง ${thDate(tx.dueDate)}`:""}</div></div>
                <div style={{fontWeight:700,color:"#ef4444"}}>฿{fmt(tx.total)}</div>
              </div>
            ))}
          </div>

          {/* Calendar mini */}
          <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:16,boxShadow:"0 2px 10px rgba(0,0,0,.07)"}}>
            <div style={{fontWeight:700,marginBottom:12,color:"#1a3a2a",display:"flex",justifyContent:"space-between"}}>
              <span>📅 ปฏิทินทวงหนี้</span>
              <span onClick={()=>setView("calendar")} style={{fontSize:"0.8em",color:"#1a7a4a",cursor:"pointer",fontWeight:400}}>เต็มหน้าจอ →</span>
            </div>
            <CalendarView customers={customers} transactions={transactions} onSelectDate={(y,m,d,info)=>{setCalDayInfo({y,m,d,info});setView("calendar");}}/>
          </div>
        </div>

        {/* FAB */}
        {!isDesktop&&(
          <div style={{position:"fixed",bottom:72,right:16}}>
            <button onClick={()=>{setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:"",interestRate:""});setSearchQ("");setView("addDebt");}} style={{width:56,height:56,borderRadius:"50%",background:"#1a7a4a",border:"none",color:"#fff",fontSize:26,cursor:"pointer",boxShadow:"0 6px 24px rgba(26,122,74,.5)",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
          </div>
        )}
      </div>
      {!isDesktop&&<BottomNav/>}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
