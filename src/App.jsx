import { useState, useRef, useEffect, useCallback } from "react";

// ── Version & Config ──────────────────────────────────
const APP_VERSION = "v2.0";
const GAS_URL = "https://script.google.com/macros/s/AKfycbxrCd34oeytvV3nogkJjJRVLWObLCUpWmE9yR9i2oHdFo-SYOqbU-T9tnzKrFA-5gcM/exec";
const MAIN_ADMIN = "thitiphankk@gmail.com";
const CORRECT_PIN = "4207";
const LINE_ID_PAGE = GAS_URL.replace("/exec","") + "/exec?action=lineIdPage";

const fontLink = document.createElement("link");
fontLink.href = "https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap";
fontLink.rel = "stylesheet";
document.head.appendChild(fontLink);

// ══════════════════════════════════════════
//  PromptPay QR
// ══════════════════════════════════════════
function crc16(s){let c=0xFFFF;for(let i=0;i<s.length;i++){c^=s.charCodeAt(i)<<8;for(let j=0;j<8;j++)c=c&0x8000?(c<<1)^0x1021:c<<1;}return(c&0xFFFF).toString(16).toUpperCase().padStart(4,"0");}
function tlv(t,v){return t+String(v.length).padStart(2,"0")+v;}
function genQR(target,amount){
  const raw=target.replace(/[^0-9]/g,"");
  const proxy=raw.length===10&&raw.startsWith("0")?"0066"+raw.slice(1):raw;
  const mi=tlv("00","A000000677010111")+tlv("01",proxy);
  const body=tlv("00","01")+tlv("01",amount>0?"12":"11")+tlv("29",mi)+tlv("53","764")+(amount>0?tlv("54",Number(amount).toFixed(2)):"")+tlv("58","TH")+"6304";
  return body+crc16(body);
}
const qrUrl=(p,s=220)=>`https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&data=${encodeURIComponent(p)}`;

// ══════════════════════════════════════════
//  GAS API — Optimistic pattern
//  gasGet: read data from server
//  gasSync: fire-and-forget POST, then background refresh
// ══════════════════════════════════════════
async function gasGet(action="getData"){
  const res = await fetch(`${GAS_URL}?action=${action}`);
  return res.json();
}
function gasSync(payload){
  // Fire POST (no-cors, non-blocking)
  fetch(GAS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).catch(()=>{});
  // Background: wait then re-read to confirm
  return new Promise(resolve=>{
    setTimeout(async()=>{
      try{ resolve(await gasGet()); }catch{ resolve({ok:false}); }
    }, 2000);
  });
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
const gasNotify=payload=>fetch(GAS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"notifyEmail",...payload})}).catch(()=>{});

// ══════════════════════════════════════════
//  Image compression
// ══════════════════════════════════════════
function compressImage(file,maxPx=400){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const s=Math.min(1,maxPx/Math.max(img.width,img.height));
      const c=document.createElement("canvas");
      c.width=Math.round(img.width*s); c.height=Math.round(img.height*s);
      c.getContext("2d").drawImage(img,0,0,c.width,c.height);
      resolve(c.toDataURL("image/jpeg",0.75));
    };
    img.src=URL.createObjectURL(file);
  });
}

// ══════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════
const TODAY  = new Date().toISOString().slice(0,10);
const fmt    = n=>Number(n).toLocaleString("th-TH");
const initial= name=>name.trim().charAt(0);
const aColor = name=>["#e07b39","#3b82f6","#22c55e","#a855f7","#ef4444","#f59e0b","#06b6d4"][name.charCodeAt(0)%7];

// Email builders
function buildDebtEmail(c,items,total,dueDate){
  const rows=items.map(it=>`<tr><td style="padding:4px 0;">${it.name}</td><td style="text-align:right;font-weight:600;">฿${fmt(it.price)}</td></tr>`).join("");
  return{subject:`📝 บันทึกหนี้ใหม่ — ${c.name} ฿${fmt(total)}`,
    htmlBody:`<h3 style="color:#1a3a2a;margin:0 0 12px;">📝 บันทึกหนี้ใหม่</h3>
      <table style="width:100%;"><tr><td style="color:#6b7280;">ลูกค้า</td><td style="text-align:right;font-weight:700;">${c.name}</td></tr>
      <tr><td style="color:#6b7280;">วันที่</td><td style="text-align:right;">${TODAY}</td></tr>
      ${dueDate?`<tr><td style="color:#6b7280;">วันทวง</td><td style="text-align:right;color:#f59e0b;">${dueDate}</td></tr>`:""}</table>
      <hr style="border:none;border-top:1px solid #f3f4f6;margin:10px 0;">
      <table style="width:100%;">${rows}</table>
      <hr style="border:none;border-top:2px solid #1a3a2a;margin:10px 0;">
      <table style="width:100%;"><tr><td style="font-weight:800;">รวม</td><td style="text-align:right;color:#ef4444;font-weight:800;">฿${fmt(total)}</td></tr>
      <tr><td style="color:#6b7280;">ยอดค้างรวมใหม่</td><td style="text-align:right;color:#ef4444;font-weight:700;">฿${fmt((c.totalDebt||0)+total)}</td></tr></table>`,
    body:`บันทึกหนี้ใหม่\nลูกค้า: ${c.name}\nรวม: ฿${fmt(total)}`};
}
function buildPaidEmail(c,amt){
  const r=Math.max(0,(c.totalDebt||0)-amt);
  return{subject:`💰 รับชำระ — ${c.name} ฿${fmt(amt)}`,
    htmlBody:`<h3 style="color:#15803d;">💰 รับชำระแล้ว</h3>
      <table style="width:100%;"><tr><td>ลูกค้า</td><td style="text-align:right;font-weight:700;">${c.name}</td></tr>
      <tr><td>จำนวน</td><td style="text-align:right;font-weight:800;color:#15803d;font-size:18px;">฿${fmt(amt)}</td></tr>
      <tr><td>ยอดคงเหลือ</td><td style="text-align:right;color:${r>0?"#ef4444":"#15803d"};font-weight:700;">${r>0?"฿"+fmt(r):"✅ ชำระครบ!"}</td></tr></table>`,
    body:`รับชำระ ${c.name} ฿${fmt(amt)}`};
}

// ══════════════════════════════════════════
//  Toast notification
// ══════════════════════════════════════════
function Toast({msg,icon="✅"}){
  return(
    <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",background:"#1a3a2a",color:"#fff",padding:"10px 20px",borderRadius:100,fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em",fontWeight:600,zIndex:2000,boxShadow:"0 4px 20px rgba(0,0,0,.3)",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:8}}>
      {icon} {msg}
    </div>
  );
}

// ══════════════════════════════════════════
//  PIN Screen
// ══════════════════════════════════════════
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
      <div style={{color:"#fff",fontWeight:700,fontSize:"1.2em",marginBottom:4}}>รหัสผ่าน ตั้งค่า</div>
      <div style={{color:"rgba(255,255,255,.5)",fontSize:"0.85em",marginBottom:36}}>กรุณาใส่รหัส 4 หลัก</div>
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

// ══════════════════════════════════════════
//  Avatar component
// ══════════════════════════════════════════
function Avatar({c,size=48}){
  return(
    <div style={{width:size,height:size,borderRadius:"50%",background:aColor(c.name),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:Math.round(size*.4),flexShrink:0,overflow:"hidden",border:`2px solid ${aColor(c.name)}55`}}>
      {c.photo?<img src={c.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>e.target.style.display="none"} />:initial(c.name)}
    </div>
  );
}

// ══════════════════════════════════════════
//  Photo Upload button (on customer page)
// ══════════════════════════════════════════
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
  const bg=state==="done"?"#22c55e":state==="error"?"#ef4444":"rgba(0,0,0,.6)";
  return(
    <>
      <input ref={ref} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handle} />
      <button onClick={()=>ref.current?.click()} disabled={state==="uploading"}
        style={{position:"absolute",bottom:0,right:0,background:bg,border:"2px solid #fff",borderRadius:"50%",width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:12,zIndex:2}}>
        {state==="uploading"?"⏳":state==="done"?"✅":state==="error"?"❌":"📷"}
      </button>
    </>
  );
}

// ══════════════════════════════════════════
//  QR Modal
// ══════════════════════════════════════════
function QRModal({c,settings,onPaid,onClose}){
  const [amount,setAmount]=useState(c.totalDebt>0?String(c.totalDebt):"");
  const [state,setState]=useState("idle");
  const handleConfirm=async()=>{
    const amt=Number(amount)||c.totalDebt;
    setState("sending");
    gasNotify({...buildPaidEmail(c,amt),extraEmails:settings.adminEmails||[]});
    await onPaid(amt);
    setState("done");
  };
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",zIndex:999,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:420,padding:24,paddingBottom:40}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div><div style={{fontWeight:800,fontSize:"1.15em",color:"#1a3a2a"}}>💳 QR รับชำระ</div><div style={{color:"#6b7280",fontSize:"0.85em"}}>{c.name} • ค้างอยู่ ฿{fmt(c.totalDebt)}</div></div>
          <button onClick={onClose} style={{background:"#f3f4f6",border:"none",borderRadius:"50%",width:36,height:36,cursor:"pointer",fontSize:18}}>✕</button>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          <input type="number" inputMode="numeric" value={amount} onChange={e=>setAmount(e.target.value)}
            style={{flex:1,padding:"12px 14px",border:"2px solid #1a7a4a",borderRadius:12,fontFamily:"'Sarabun',sans-serif",fontSize:"1.3em",fontWeight:700,color:"#1a3a2a",outline:"none"}} />
          <button onClick={()=>setAmount(String(c.totalDebt))} style={{padding:"10px 12px",background:"#f0fdf4",border:"1.5px solid #22c55e",borderRadius:10,color:"#15803d",fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",lineHeight:1.4}}>เต็ม<br/>฿{fmt(c.totalDebt)}</button>
        </div>
        {!settings.promptpayId?(
          <div style={{background:"#fff7ed",borderRadius:14,padding:16,textAlign:"center",marginBottom:14}}>
            <div style={{fontSize:28}}>⚠️</div><div style={{fontWeight:700,color:"#92400e"}}>ยังไม่ได้ตั้งค่า PromptPay</div>
          </div>
        ):(
          <div style={{textAlign:"center",marginBottom:14}}>
            <div style={{display:"inline-block",padding:10,background:"#fff",borderRadius:16,boxShadow:"0 4px 20px rgba(0,0,0,.12)",border:"3px solid #06c755"}}>
              <img src={qrUrl(genQR(settings.promptpayId,Number(amount)||0))} alt="QR" width={200} height={200} style={{display:"block",borderRadius:8}} />
            </div>
            <div style={{marginTop:8,fontWeight:700,fontSize:"1.1em"}}>{Number(amount)>0?`฿${Number(amount).toLocaleString("th-TH")}`:"ไม่ระบุจำนวน"}</div>
          </div>
        )}
        <button onClick={handleConfirm} disabled={state!=="idle"}
          style={{width:"100%",padding:"14px 0",background:state==="idle"?"#1a7a4a":state==="done"?"#22c55e":"#9ca3af",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.05em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>
          {state==="idle"?"✅ ยืนยันรับเงิน + แจ้ง Email":state==="done"?"✅ บันทึกแล้ว!":"⏳ กำลังบันทึก..."}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
//  Edit Debt Items Modal
// ══════════════════════════════════════════
function EditDebtModal({tx,customer,onSave,onClose}){
  const [items,setItems]=useState(tx.items.map(it=>({...it,price:String(it.price)})));
  const total=items.reduce((s,it)=>s+(parseFloat(it.price)||0),0);
  const addItem=()=>setItems(p=>[...p,{name:"",price:""}]);
  const removeItem=i=>setItems(p=>p.filter((_,idx)=>idx!==i));
  const upd=(i,f,v)=>setItems(p=>{const a=[...p];a[i]={...a[i],[f]:v};return a;});
  const save=()=>onSave(tx.id,items.filter(it=>it.name||it.price).map(it=>({name:it.name||"รายการ",price:parseFloat(it.price)||0})),total);
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:998,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:420,padding:20,paddingBottom:36,maxHeight:"85vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div><div style={{fontWeight:800,color:"#1a3a2a"}}>✏️ แก้ไขรายการ</div><div style={{color:"#6b7280",fontSize:"0.82em"}}>📅 {tx.date}</div></div>
          <button onClick={onClose} style={{background:"#f3f4f6",border:"none",borderRadius:"50%",width:36,height:36,cursor:"pointer",fontSize:18}}>✕</button>
        </div>
        {items.map((it,i)=>(
          <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
            <input value={it.name} onChange={e=>upd(i,"name",e.target.value)} placeholder="ชื่อสินค้า"
              style={{flex:2,padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",outline:"none"}} />
            <input value={it.price} onChange={e=>upd(i,"price",e.target.value)} placeholder="฿" type="number" inputMode="numeric"
              style={{flex:1,padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",outline:"none"}} />
            <button onClick={()=>removeItem(i)} style={{background:"#fee2e2",border:"none",borderRadius:8,padding:"8px 10px",cursor:"pointer",color:"#ef4444",fontWeight:700}}>🗑</button>
          </div>
        ))}
        <button onClick={addItem} style={{width:"100%",padding:"9px 0",background:"#f0fdf4",border:"1.5px dashed #22c55e",borderRadius:10,color:"#15803d",fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em",marginTop:4}}>+ เพิ่มรายการ</button>
        <div style={{display:"flex",justifyContent:"space-between",padding:"12px",background:"#f9fafb",borderRadius:10,margin:"12px 0",fontWeight:700}}>
          <span>รวม</span><span style={{color:"#1a3a2a",fontSize:"1.1em"}}>฿{fmt(total)}</span>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:"12px 0",background:"#f3f4f6",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",color:"#374151"}}>ยกเลิก</button>
          <button onClick={save} style={{flex:2,padding:"12px 0",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>💾 บันทึก</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
//  Admin Email Manager
// ══════════════════════════════════════════
function AdminEmailManager({emails,onChange}){
  const [input,setInput]=useState("");
  const [err,setErr]=useState("");
  const add=()=>{
    const e=input.trim().toLowerCase();
    if(!e.includes("@")){setErr("รูปแบบ email ไม่ถูกต้อง");return;}
    if(e===MAIN_ADMIN){setErr("เป็น admin หลักอยู่แล้ว");return;}
    if(emails.includes(e)){setErr("มีแล้ว");return;}
    onChange([...emails,e]);setInput("");setErr("");
  };
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#f0fdf4",borderRadius:10,marginBottom:8,border:"1.5px solid #22c55e"}}>
        <div style={{width:30,height:30,borderRadius:"50%",background:"#15803d",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14,fontWeight:700,flexShrink:0}}>👑</div>
        <div style={{flex:1}}><div style={{fontWeight:700,fontSize:"0.88em",color:"#15803d"}}>Admin หลัก</div><div style={{fontSize:"0.8em",color:"#166534"}}>{MAIN_ADMIN}</div></div>
        <span style={{background:"#bbf7d0",borderRadius:6,padding:"2px 8px",fontSize:"0.72em",fontWeight:700,color:"#15803d"}}>เสมอ</span>
      </div>
      {emails.map(e=>(
        <div key={e} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#fff",borderRadius:10,marginBottom:8,border:"1.5px solid #e5e7eb"}}>
          <div style={{width:30,height:30,borderRadius:"50%",background:"#3b82f6",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14,fontWeight:700,flexShrink:0}}>👤</div>
          <div style={{flex:1,fontSize:"0.85em",wordBreak:"break-all"}}>{e}</div>
          <button onClick={()=>onChange(emails.filter(x=>x!==e))} style={{background:"#fee2e2",border:"none",borderRadius:8,padding:"5px 10px",cursor:"pointer",color:"#ef4444",fontWeight:700,fontSize:"0.85em"}}>ลบ</button>
        </div>
      ))}
      <div style={{display:"flex",gap:8,marginTop:4}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()}
          placeholder="เพิ่มอีเมลผู้ช่วย..." style={{flex:1,padding:"9px 12px",border:`1.5px solid ${err?"#ef4444":"#e5e7eb"}`,borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.88em",outline:"none"}} />
        <button onClick={add} style={{padding:"9px 14px",background:"#3b82f6",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.88em"}}>+ เพิ่ม</button>
      </div>
      {err&&<div style={{color:"#ef4444",fontSize:"0.8em",marginTop:4}}>{err}</div>}
    </div>
  );
}

// ══════════════════════════════════════════
//  LINE UID Modal
// ══════════════════════════════════════════
function LineUidModal({onClose}){
  const [uid,setUid]=useState("");
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:998,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:20,padding:24,width:"100%",maxWidth:400,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}} onClick={e=>e.stopPropagation()}>
        <div style={{fontWeight:800,fontSize:"1.1em",color:"#1a3a2a",marginBottom:4}}>🔍 หา LINE User ID</div>
        <div style={{color:"#6b7280",fontSize:"0.85em",marginBottom:16,lineHeight:1.5}}>วิธีหา LINE User ID ของผู้ช่วย:</div>
        {[
          ["1","ส่งลิงก์นี้ให้ผู้ช่วยเปิดใน LINE Browser"],
          ["2","หรือให้ผู้ช่วย Add LINE Bot แล้วพิมพ์ 'uid'"],
          ["3","Copy User ID มาใส่ด้านล่าง"],
        ].map(([n,t])=>(
          <div key={n} style={{display:"flex",gap:10,marginBottom:10,alignItems:"flex-start"}}>
            <div style={{background:"#1a3a2a",color:"#fff",borderRadius:"50%",width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0}}>{n}</div>
            <div style={{fontSize:"0.85em",color:"#374151",lineHeight:1.5}}>{t}</div>
          </div>
        ))}
        <button onClick={()=>window.open(LINE_ID_PAGE,"_blank")} style={{width:"100%",padding:"10px 0",background:"#06c755",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",marginBottom:14,fontSize:"0.9em"}}>
          📱 เปิดหน้า หา LINE UID
        </button>
        <div style={{fontSize:"0.82em",color:"#6b7280",marginBottom:8}}>Admin หลัก LINE UID:</div>
        <div style={{background:"#f9fafb",borderRadius:8,padding:"8px 12px",fontFamily:"monospace",fontSize:"0.8em",color:"#374151",marginBottom:14,wordBreak:"break-all"}}>Ub41fc0cdada0f290836a5b8258baccd1</div>
        <button onClick={onClose} style={{width:"100%",padding:"10px 0",background:"#f3f4f6",border:"none",borderRadius:10,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",color:"#374151",fontSize:"0.9em"}}>ปิด</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
//  Main App
// ══════════════════════════════════════════
export default function App(){
  const [customers,    setCustomers]    = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [settings,     setSettings]     = useState({promptpayId:"",adminEmails:[],adminLineUids:[]});
  const [initState,    setInitState]    = useState("loading");
  const [refreshing,   setRefreshing]   = useState(false);
  const [lastSync,     setLastSync]     = useState(null);
  const [toast,        setToast]        = useState(null);
  const [view,         setView]         = useState("dashboard");
  const [selectedCid,  setSelectedCid]  = useState(null);
  const [fontSize,     setFontSize]     = useState("md");
  const [searchQ,      setSearchQ]      = useState("");
  const [newDebt,      setNewDebt]      = useState({customer:null,items:[{name:"",price:""}],dueDate:""});
  const [boxOrder,     setBoxOrder]     = useState(["due","all","today","paid"]);
  const [dragBox,      setDragBox]      = useState(null);
  const [showQR,       setShowQR]       = useState(false);
  const [showPin,      setShowPin]      = useState(false);
  const [pinUnlocked,  setPinUnlocked]  = useState(false);
  const [settingsDraft,setSettingsDraft]= useState({promptpayId:"",adminEmails:[],adminLineUids:[]});
  const [editingTx,    setEditingTx]    = useState(null);
  const [showLineUid,  setShowLineUid]  = useState(false);
  // New customer photo
  const [newCustName,  setNewCustName]  = useState("");
  const [newCustPhoto, setNewCustPhoto] = useState(null); // base64
  const [showNewCustForm, setShowNewCustForm] = useState(false);
  const newCustPhotoRef = useRef();

  const FS={sm:"13px",md:"15px",lg:"17px",xl:"20px"};
  const S={fontSize:FS[fontSize],fontFamily:"'Sarabun',sans-serif"};

  const showToast=(msg,icon="✅",ms=2000)=>{
    setToast({msg,icon});
    setTimeout(()=>setToast(null),ms);
  };

  const applyData=data=>{
    if(data&&data.ok){
      setCustomers(data.customers||[]);
      setTransactions(data.transactions||[]);
      setLastSync(new Date().toLocaleTimeString("th-TH"));
      setInitState("ready");
    }
  };

  const loadAll=useCallback(async(isRefresh=false)=>{
    isRefresh?setRefreshing(true):setInitState("loading");
    try{
      const [dr,sr]=await Promise.all([gasGet("getData"),gasGet("getSettings")]);
      applyData(dr);
      if(sr.ok&&sr.settings){setSettings(sr.settings);setSettingsDraft(sr.settings);}
    }catch{setInitState("error");}
    setRefreshing(false);
  },[]);

  useEffect(()=>{ loadAll(); },[]);

  // ── Computed ──
  const totalDebt  =customers.reduce((s,c)=>s+c.totalDebt,0);
  const debtors    =customers.filter(c=>c.totalDebt>0);
  const dueToday   =customers.filter(c=>c.dueDate===TODAY&&c.totalDebt>0);
  const todayCids  =[...new Set(transactions.filter(t=>t.date===TODAY).map(t=>t.customerId))];
  const todayCusts =customers.filter(c=>todayCids.includes(c.id));
  const paidMonth  =customers.filter(c=>c.totalDebt===0&&c.phone);
  const recentTx   =[...transactions].sort((a,b)=>b.id-a.id).slice(0,5).map(t=>({...t,customer:customers.find(c=>c.id===t.customerId)}));
  const filtered   =customers.filter(c=>c.name.includes(searchQ));
  const BOXES={
    due:  {label:"ครบกำหนดวันนี้", count:dueToday.length,   color:"#ef4444",icon:"🔴"},
    all:  {label:"ลูกหนี้ทั้งหมด", count:debtors.length,     color:"#f59e0b",icon:"🟡"},
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

  // ── Add new customer with optional photo ──
  const doAddCustomer=async()=>{
    if(!newCustName.trim())return;
    const txId=Date.now();
    const nc={id:txId,name:newCustName,phone:"",totalDebt:0,dueDate:null,photo:newCustPhoto};
    // Optimistic
    setCustomers(p=>[...p,nc]);
    setNewDebt(d=>({...d,customer:nc}));
    setSearchQ("");setNewCustName("");setNewCustPhoto(null);setShowNewCustForm(false);
    showToast("เพิ่มลูกค้าใหม่แล้ว","👤");
    // Sync
    gasSync({action:"addCustomer",name:nc.name,phone:"",txId}).then(data=>applyData(data));
    // Upload photo if any
    if(newCustPhoto){
      gasPostRead({action:"savePhoto",customerId:txId,base64:newCustPhoto,mimeType:"image/jpeg"}).then(res=>{
        if(res.ok&&res.photoUrl) setCustomers(p=>p.map(c=>c.id===txId?{...c,photo:res.photoUrl}:c));
      });
    }
  };

  // ── Confirm debt (optimistic) ──
  const confirmDebt=async()=>{
    if(!newDebt.customer||debtTotal<=0)return;
    const items=newDebt.items.filter(it=>it.name||it.price).map(it=>({name:it.name||"รายการ",price:parseFloat(it.price)||0}));
    const txId=Date.now();
    const cid=newDebt.customer.id;
    const due=newDebt.dueDate||"";
    // Optimistic update
    setTransactions(p=>[...p,{id:txId,customerId:cid,date:TODAY,items,total:debtTotal,paid:false}]);
    setCustomers(p=>p.map(c=>c.id===cid?{...c,totalDebt:c.totalDebt+debtTotal,dueDate:due||c.dueDate}:c));
    setView("dashboard");
    showToast("บันทึกหนี้แล้ว ☁️ กำลัง sync...");
    setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:""});
    // Email notify
    gasNotify({...buildDebtEmail(newDebt.customer,items,debtTotal,due),extraEmails:settings.adminEmails||[]});
    // Sync to server background
    gasSync({action:"addDebt",txId,customerId:cid,date:TODAY,items,total:debtTotal,dueDate:due}).then(data=>{
      applyData(data);showToast("✅ sync สำเร็จ");
    });
  };

  // ── Mark paid (optimistic) ──
  const handleMarkPaid=async(cid,amount)=>{
    const c=customers.find(x=>x.id===cid);
    const newTotal=Math.max(0,(c?.totalDebt||0)-amount);
    const fullPay=amount>=(c?.totalDebt||0);
    // Optimistic
    setCustomers(p=>p.map(x=>x.id===cid?{...x,totalDebt:newTotal,dueDate:newTotal===0?null:x.dueDate}:x));
    if(fullPay) setTransactions(p=>p.map(t=>t.customerId===cid?{...t,paid:true}:t));
    setShowQR(false);
    showToast("รับชำระแล้ว ☁️ sync...");
    gasSync({action:"markPaid",customerId:cid,amount,fullPay}).then(data=>{
      applyData(data);showToast("✅ sync สำเร็จ");
    });
  };

  // ── Update debt items (edit) ──
  const handleUpdateDebt=async(txId,items,newTotal)=>{
    if(!editingTx)return;
    const cid=editingTx.customerId;
    // Optimistic
    setTransactions(p=>p.map(t=>t.id===txId?{...t,items,total:newTotal}:t));
    // Recalc customer totalDebt
    const allUnpaid=[...transactions.filter(t=>t.id!==txId&&t.customerId===cid&&!t.paid),{id:txId,total:newTotal,paid:false}];
    const newDebtTotal=allUnpaid.reduce((s,t)=>s+t.total,0);
    setCustomers(p=>p.map(c=>c.id===cid?{...c,totalDebt:newDebtTotal}:c));
    setEditingTx(null);
    showToast("แก้ไขแล้ว ☁️ sync...");
    gasSync({action:"updateDebt",transactionId:txId,customerId:cid,items,newTotal}).then(data=>{
      applyData(data);showToast("✅ sync สำเร็จ");
    });
  };

  const handlePhotoUploaded=(cid,url)=>{
    setCustomers(p=>p.map(c=>c.id===cid?{...c,photo:url}:c));
    showToast("อัปโหลดรูปแล้ว");
  };

  const doSaveSettings=async()=>{
    showToast("กำลังบันทึก...","⏳",60000);
    await gasPostRead({action:"saveSettings",settings:settingsDraft});
    setSettings(settingsDraft);
    showToast("บันทึกตั้งค่าแล้ว");
  };

  const goToSettings=()=>{ if(pinUnlocked){setSettingsDraft({...settings});setView("settings");}else{setShowPin(true);} };

  // ── Loading screens ──
  if(initState==="loading") return(
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"linear-gradient(160deg,#1a3a2a,#0d1f17)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <div style={{fontSize:52,marginBottom:16}}>🏪</div>
      <div style={{color:"#fff",fontWeight:800,fontSize:"1.3em",marginBottom:6}}>สมุดหนี้โชห่วย</div>
      <div style={{color:"rgba(255,255,255,.5)",fontSize:"0.82em",marginBottom:24}}>กำลังโหลดข้อมูลจาก Server...</div>
      <div style={{width:32,height:32,border:"3px solid rgba(255,255,255,.2)",borderTop:"3px solid #22c55e",borderRadius:"50%",animation:"spin 1s linear infinite"}} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
  if(initState==="error") return(
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f4f6f0",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:16}}>⚠️</div>
      <div style={{fontWeight:700,color:"#ef4444",marginBottom:8}}>โหลดข้อมูลไม่สำเร็จ</div>
      <div style={{color:"#6b7280",fontSize:"0.85em",marginBottom:24}}>ตรวจสอบการเชื่อมต่อ internet</div>
      <button onClick={()=>loadAll()} style={{padding:"12px 28px",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"1em"}}>🔄 ลองใหม่</button>
    </div>
  );

  if(showPin) return <PinScreen onSuccess={()=>{setShowPin(false);setPinUnlocked(true);setSettingsDraft({...settings});setView("settings");}} onCancel={()=>setShowPin(false)} />;

  // ══ SETTINGS ════════════════════════════════
  if(view==="settings") return(
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f9fafb",paddingBottom:40}}>
      {toast&&<Toast msg={toast.msg} icon={toast.icon} />}
      {showLineUid&&<LineUidModal onClose={()=>setShowLineUid(false)} />}
      <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>{setPinUnlocked(false);setView("dashboard");}} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
        <span style={{fontWeight:700,fontSize:"1.1em",flex:1}}>⚙️ ตั้งค่า</span>
        <span style={{background:"rgba(255,255,255,.15)",borderRadius:8,padding:"3px 10px",fontSize:"0.72em"}}>{APP_VERSION}</span>
      </div>
      <div style={{padding:16}}>

        {/* PromptPay */}
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{background:"#004f9f",color:"#fff",borderRadius:6,padding:"2px 10px",fontSize:"0.8em",fontWeight:700}}>PromptPay</span>
            <span style={{fontWeight:700,color:"#1a3a2a"}}>เบอร์รับเงิน</span>
            <span style={{marginLeft:"auto",color:"#22c55e",fontSize:"0.75em",fontWeight:600}}>🌐 Server</span>
          </div>
          <input value={settingsDraft.promptpayId} onChange={e=>setSettingsDraft(s=>({...s,promptpayId:e.target.value}))}
            placeholder="0812345678" inputMode="numeric"
            style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}} />
          {settingsDraft.promptpayId&&(
            <div style={{marginTop:10,textAlign:"center"}}>
              <img src={qrUrl(genQR(settingsDraft.promptpayId,0),120)} alt="preview" style={{borderRadius:10,border:"2px solid #e5e7eb"}} />
            </div>
          )}
        </div>

        {/* Admin Emails */}
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}>
            <span style={{fontSize:"1.1em"}}>📧</span>
            <span style={{fontWeight:700,color:"#1a3a2a"}}>อีเมลแจ้งเตือน</span>
            <span style={{marginLeft:"auto",color:"#22c55e",fontSize:"0.75em",fontWeight:600}}>🌐 Server</span>
          </div>
          <div style={{background:"#fff7ed",borderRadius:10,padding:"8px 12px",marginBottom:12,fontSize:"0.8em",color:"#92400e",display:"flex",gap:6}}>
            <span>ℹ️</span><span>LINE Notify ปิดแล้ว ใช้ <b>Email</b> แทน</span>
          </div>
          <AdminEmailManager emails={settingsDraft.adminEmails||[]} onChange={emails=>setSettingsDraft(s=>({...s,adminEmails:emails}))} />
          <div style={{marginTop:10,background:"#f0fdf4",borderRadius:10,padding:"6px 12px",fontSize:"0.8em",color:"#15803d"}}>
            📬 รวมผู้รับ: <b>{1+(settingsDraft.adminEmails||[]).length} คน</b>
          </div>
        </div>

        {/* LINE UID Helper */}
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <span style={{background:"#06c755",color:"#fff",borderRadius:6,padding:"2px 10px",fontSize:"0.8em",fontWeight:700}}>LINE</span>
            <span style={{fontWeight:700,color:"#1a3a2a"}}>LINE User ID ผู้ช่วย</span>
          </div>
          <div style={{color:"#6b7280",fontSize:"0.82em",marginBottom:10}}>สำหรับส่งแจ้งเตือนผ่าน LINE Messaging API ในอนาคต</div>
          <button onClick={()=>setShowLineUid(true)}
            style={{width:"100%",padding:"10px 0",background:"#06c755",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em",marginBottom:10}}>
            🔍 วิธีหา LINE User ID ของผู้ช่วย
          </button>
          <div style={{background:"#f9fafb",borderRadius:8,padding:"8px 12px",fontSize:"0.78em",color:"#6b7280"}}>
            Admin หลัก LINE UID:<br/><code style={{color:"#374151",wordBreak:"break-all"}}>Ub41fc0cdada0f290836a5b8258baccd1</code>
          </div>
        </div>

        <button onClick={doSaveSettings} style={{width:"100%",padding:"14px 0",background:"#1a3a2a",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",marginBottom:14,boxShadow:"0 4px 16px rgba(26,58,42,.3)"}}>
          💾 บันทึกการตั้งค่าขึ้น Server
        </button>

        {/* Font Size */}
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
  );

  // ══ CUSTOMER ════════════════════════════════
  if(view==="customer"&&selectedCid){
    const c=customers.find(x=>x.id===selectedCid);
    if(!c){setView("list");return null;}
    const txList=[...transactions].filter(t=>t.customerId===c.id).sort((a,b)=>b.id-a.id);
    return(
      <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f9fafb",paddingBottom:80}}>
        {toast&&<Toast msg={toast.msg} icon={toast.icon} />}
        {editingTx&&<EditDebtModal tx={editingTx} customer={c} onSave={handleUpdateDebt} onClose={()=>setEditingTx(null)} />}
        {showQR&&<QRModal c={c} settings={settings} onPaid={async amt=>{await handleMarkPaid(c.id,amt);}} onClose={()=>setShowQR(false)} />}
        <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 24px"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
            <button onClick={()=>setView("list")} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
            <span style={{fontWeight:700,fontSize:"1.1em",flex:1}}>ประวัติลูกค้า</span>
            <button onClick={()=>loadAll(true)} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:10,padding:"6px 12px",color:"#fff",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",fontWeight:600}}>{refreshing?"⏳":"🔄"}</button>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{position:"relative",width:64,height:64,flexShrink:0}}>
              <Avatar c={c} size={64} />
              <PhotoUploadBtn customerId={c.id} onUploaded={url=>handlePhotoUploaded(c.id,url)} />
            </div>
            <div><div style={{fontWeight:700,fontSize:"1.2em"}}>{c.name}</div><div style={{opacity:.8,fontSize:"0.9em"}}>📞 {c.phone||"ไม่มีเบอร์"}</div></div>
          </div>
        </div>
        <div style={{margin:"0 16px",marginTop:-16,background:"#fff",borderRadius:16,padding:16,boxShadow:"0 4px 20px rgba(0,0,0,.08)",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
            <div><div style={{color:"#6b7280",fontSize:"0.85em"}}>ยอดค้างรวม</div><div style={{fontWeight:800,fontSize:"1.8em",color:c.totalDebt>0?"#ef4444":"#22c55e"}}>฿{fmt(c.totalDebt)}</div></div>
            {c.dueDate&&<div style={{textAlign:"right"}}><div style={{color:"#6b7280",fontSize:"0.85em"}}>วันทวง</div><div style={{fontWeight:600,color:c.dueDate<=TODAY?"#ef4444":"#374151"}}>{c.dueDate}</div></div>}
          </div>
        </div>
        <div style={{display:"flex",gap:8,margin:"0 16px 16px"}}>
          {c.totalDebt>0&&<button onClick={()=>setShowQR(true)} style={{flex:1,padding:"12px 8px",background:"linear-gradient(135deg,#06c755,#04a344)",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em",boxShadow:"0 4px 14px rgba(6,199,85,.35)"}}>💳 QR รับเงิน</button>}
          <button onClick={()=>{setNewDebt({customer:c,items:[{name:"",price:""}],dueDate:""});setView("addDebt");}} style={{flex:1,padding:"12px 8px",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em"}}>+ บันทึกหนี้</button>
        </div>
        <div style={{padding:"0 16px"}}>
          <div style={{fontWeight:700,marginBottom:10,color:"#1a3a2a"}}>ประวัติการซื้อ</div>
          {txList.length===0&&<div style={{color:"#9ca3af",textAlign:"center",padding:24}}>ยังไม่มีประวัติ</div>}
          {txList.map(tx=>(
            <div key={tx.id} style={{background:"#fff",borderRadius:14,padding:14,marginBottom:10,boxShadow:"0 2px 8px rgba(0,0,0,.06)",opacity:tx.paid?.5:1}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,alignItems:"center"}}>
                <span style={{color:"#6b7280",fontSize:"0.85em"}}>📅 {tx.date}</span>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontWeight:700,color:tx.paid?"#22c55e":"#ef4444"}}>{tx.paid?"✅ จ่ายแล้ว":`฿${fmt(tx.total)}`}</span>
                  {!tx.paid&&<button onClick={()=>setEditingTx(tx)} style={{background:"#eff6ff",border:"none",borderRadius:8,padding:"4px 10px",cursor:"pointer",color:"#3b82f6",fontWeight:600,fontSize:"0.8em",fontFamily:"'Sarabun',sans-serif"}}>✏️ แก้</button>}
                </div>
              </div>
              {(tx.items||[]).map((it,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:"0.9em",color:"#374151",paddingBottom:4}}>
                  <span>{it.name}</span><span>฿{fmt(it.price)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ══ CONFIRM ══════════════════════════════════
  if(view==="confirm"){const c=newDebt.customer;return(
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f9fafb",paddingBottom:80}}>
      {toast&&<Toast msg={toast.msg} icon={toast.icon} />}
      <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>setView("addDebt")} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
        <span style={{fontWeight:700,fontSize:"1.1em"}}>✅ ยืนยันก่อนบันทึก</span>
      </div>
      <div style={{padding:16}}>
        <div style={{background:"#fff",borderRadius:16,padding:20,marginBottom:14,boxShadow:"0 4px 20px rgba(0,0,0,.08)",textAlign:"center"}}>
          <div style={{margin:"0 auto 12px",display:"inline-block"}}><Avatar c={c} size={80} /></div>
          <div style={{fontWeight:800,fontSize:"1.3em",color:"#1a3a2a"}}>{c.name}</div>
        </div>
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{fontWeight:700,marginBottom:12,color:"#1a3a2a"}}>รายการสินค้า</div>
          {newDebt.items.filter(it=>it.name||it.price).map((it,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f3f4f6"}}>
              <span>{it.name||"รายการ"}</span><span style={{fontWeight:600}}>฿{fmt(parseFloat(it.price)||0)}</span>
            </div>
          ))}
          <div style={{display:"flex",justifyContent:"space-between",marginTop:10,paddingTop:10,borderTop:"2px solid #1a3a2a"}}>
            <span style={{fontWeight:700}}>รวมครั้งนี้</span><span style={{fontWeight:800,color:"#ef4444",fontSize:"1.1em"}}>฿{fmt(debtTotal)}</span>
          </div>
        </div>
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",color:"#6b7280"}}><span>ยอดค้างเดิม</span><span>฿{fmt(c.totalDebt)}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",color:"#6b7280"}}><span>เพิ่มวันนี้</span><span style={{color:"#ef4444"}}>+฿{fmt(debtTotal)}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0 0",borderTop:"2px dashed #e5e7eb",marginTop:6}}>
            <span style={{fontWeight:800,fontSize:"1.05em"}}>ยอดค้างรวมใหม่</span><span style={{fontWeight:800,fontSize:"1.2em",color:"#ef4444"}}>฿{fmt(c.totalDebt+debtTotal)}</span>
          </div>
        </div>
        <div style={{background:"#eff6ff",borderRadius:12,padding:"10px 14px",marginBottom:16,fontSize:"0.82em",color:"#1e40af"}}>
          📧 แจ้ง → <b>{[MAIN_ADMIN,...(settings.adminEmails||[])].join(", ")}</b>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={()=>setView("addDebt")} style={{flex:1,padding:"14px 0",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:14,fontWeight:700,fontSize:"1em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>← แก้ไข</button>
          <button onClick={confirmDebt} style={{flex:2,padding:"14px 0",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.05em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 16px rgba(26,122,74,.4)"}}>✅ ยืนยัน + แจ้ง Email</button>
        </div>
      </div>
    </div>
  );}

  // ══ ADD DEBT ══════════════════════════════════
  if(view==="addDebt") return(
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f9fafb",paddingBottom:80}}>
      {toast&&<Toast msg={toast.msg} icon={toast.icon} />}
      <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>{setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:""});setView("dashboard");setShowNewCustForm(false);}} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
        <span style={{fontWeight:700,fontSize:"1.1em"}}>+ บันทึกหนี้ใหม่</span>
      </div>
      <div style={{padding:16}}>
        {/* Select customer */}
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{fontWeight:700,marginBottom:10,color:"#1a3a2a"}}>① เลือกลูกค้า</div>
          <input value={searchQ} onChange={e=>{setSearchQ(e.target.value);setShowNewCustForm(false);}} placeholder="🔍 พิมพ์ชื่อลูกค้า..."
            style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}} />
          <div style={{maxHeight:200,overflowY:"auto",marginTop:8}}>
            {filtered.map(c=>(
              <div key={c.id} onClick={()=>{setNewDebt(d=>({...d,customer:c}));setSearchQ("");}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 8px",borderRadius:10,cursor:"pointer",background:newDebt.customer?.id===c.id?"#f0fdf4":"transparent",border:newDebt.customer?.id===c.id?"1.5px solid #22c55e":"1.5px solid transparent",marginBottom:4}}>
                <Avatar c={c} size={36} />
                <div style={{flex:1}}><div style={{fontWeight:600}}>{c.name}</div><div style={{fontSize:"0.82em",color:c.totalDebt>0?"#ef4444":"#6b7280"}}>{c.totalDebt>0?`ค้างอยู่ ฿${fmt(c.totalDebt)}`:"ไม่มียอดค้าง"}</div></div>
                {newDebt.customer?.id===c.id&&<span style={{color:"#22c55e",fontWeight:700}}>✓</span>}
              </div>
            ))}

            {/* New customer form */}
            {searchQ&&!filtered.find(c=>c.name===searchQ)&&!showNewCustForm&&(
              <div onClick={()=>{setNewCustName(searchQ);setShowNewCustForm(true);}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 8px",borderRadius:10,cursor:"pointer",background:"#eff6ff",border:"1.5px dashed #3b82f6",marginTop:4}}>
                <span style={{fontSize:20}}>➕</span><span style={{color:"#3b82f6",fontWeight:600}}>เพิ่ม "{searchQ}" เป็นลูกค้าใหม่</span>
              </div>
            )}

            {/* New customer form expanded with photo */}
            {showNewCustForm&&(
              <div style={{background:"#eff6ff",borderRadius:12,padding:14,marginTop:8,border:"1.5px solid #3b82f6"}}>
                <div style={{fontWeight:700,color:"#1e40af",marginBottom:12}}>👤 เพิ่มลูกค้าใหม่</div>
                <input value={newCustName} onChange={e=>setNewCustName(e.target.value)} placeholder="ชื่อลูกค้า"
                  style={{width:"100%",padding:"10px 12px",border:"1.5px solid #93c5fd",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none",marginBottom:12}} />
                {/* Photo capture */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:"0.85em",color:"#1e40af",marginBottom:8}}>📷 รูปภาพ (ไม่บังคับ)</div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    {newCustPhoto?(
                      <img src={newCustPhoto} alt="" style={{width:56,height:56,borderRadius:"50%",objectFit:"cover",border:"2px solid #3b82f6"}} />
                    ):(
                      <div style={{width:56,height:56,borderRadius:"50%",background:"#dbeafe",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>👤</div>
                    )}
                    <div style={{display:"flex",gap:8"}}>
                      <input ref={newCustPhotoRef} type="file" accept="image/*" capture="environment" style={{display:"none"}}
                        onChange={async e=>{const f=e.target.files[0];if(f){const b=await compressImage(f,300);setNewCustPhoto(b);}}} />
                      <button onClick={()=>newCustPhotoRef.current?.click()} style={{padding:"8px 14px",background:"#3b82f6",color:"#fff",border:"none",borderRadius:8,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.85em"}}>📷 ถ่ายรูป</button>
                      {newCustPhoto&&<button onClick={()=>setNewCustPhoto(null)} style={{padding:"8px 12px",background:"#fee2e2",color:"#ef4444",border:"none",borderRadius:8,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.85em"}}>✕ ลบ</button>}
                    </div>
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{setShowNewCustForm(false);setNewCustPhoto(null);}} style={{flex:1,padding:"9px 0",background:"#f3f4f6",border:"none",borderRadius:10,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",color:"#374151",fontSize:"0.9em"}}>ยกเลิก</button>
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
              <input value={it.name} onChange={e=>updItem(i,"name",e.target.value)} placeholder="ชื่อสินค้า" style={{flex:2,padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",outline:"none"}} />
              <input value={it.price} onChange={e=>updItem(i,"price",e.target.value)} placeholder="฿" type="number" inputMode="numeric" style={{flex:1,padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",outline:"none"}} />
              {newDebt.items.length>1&&<button onClick={()=>removeItem(i)} style={{background:"#fee2e2",border:"none",borderRadius:8,padding:"8px 10px",cursor:"pointer",color:"#ef4444",fontWeight:700}}>🗑</button>}
            </div>
          ))}
          <button onClick={addItem} style={{width:"100%",padding:"10px 0",background:"#f0fdf4",border:"1.5px dashed #22c55e",borderRadius:10,color:"#15803d",fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"1em",marginTop:4}}>+ เพิ่มรายการ</button>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:14,padding:"10px 12px",background:"#f9fafb",borderRadius:10}}>
            <span style={{fontWeight:700}}>รวม</span><span style={{fontWeight:800,fontSize:"1.15em"}}>฿{fmt(debtTotal)}</span>
          </div>
        </div>

        {/* Due date */}
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:20,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{fontWeight:700,marginBottom:10,color:"#1a3a2a"}}>📅 วันทวง (ถ้ามี)</div>
          <input type="date" value={newDebt.dueDate} onChange={e=>setNewDebt(d=>({...d,dueDate:e.target.value}))} style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}} />
        </div>
        <button onClick={()=>{if(newDebt.customer&&debtTotal>0)setView("confirm");}} disabled={!newDebt.customer||debtTotal<=0}
          style={{width:"100%",padding:"16px 0",background:newDebt.customer&&debtTotal>0?"#1a7a4a":"#d1d5db",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.1em",cursor:newDebt.customer&&debtTotal>0?"pointer":"not-allowed",fontFamily:"'Sarabun',sans-serif"}}>
          ถัดไป → ยืนยัน
        </button>
      </div>
    </div>
  );

  // ══ LIST ════════════════════════════════════
  if(view==="list") return(
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f9fafb",paddingBottom:80}}>
      {toast&&<Toast msg={toast.msg} icon={toast.icon} />}
      <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
          <button onClick={()=>setView("dashboard")} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
          <span style={{fontWeight:700,fontSize:"1.1em",flex:1}}>ลูกหนี้ทั้งหมด</span>
          <button onClick={()=>loadAll(true)} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:10,padding:"6px 12px",color:"#fff",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",fontWeight:600}}>{refreshing?"⏳":"🔄"} Refresh</button>
        </div>
        <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="🔍 ค้นหาชื่อ..." style={{width:"100%",padding:"10px 14px",borderRadius:12,border:"none",background:"rgba(255,255,255,.15)",color:"#fff",fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}} />
      </div>
      <div style={{padding:16}}>
        {filtered.map(c=>(
          <div key={c.id} onClick={()=>{setSelectedCid(c.id);setView("customer");}} style={{background:"#fff",borderRadius:14,padding:14,marginBottom:10,boxShadow:"0 2px 8px rgba(0,0,0,.06)",display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}>
            <Avatar c={c} size={48} />
            <div style={{flex:1}}><div style={{fontWeight:700}}>{c.name}</div><div style={{fontSize:"0.85em",color:"#6b7280"}}>{c.phone||"ไม่มีเบอร์"}</div></div>
            <div style={{textAlign:"right"}}>
              <div style={{fontWeight:800,color:c.totalDebt>0?"#ef4444":"#22c55e"}}>฿{fmt(c.totalDebt)}</div>
              {c.dueDate&&c.totalDebt>0&&<div style={{fontSize:"0.78em",color:c.dueDate<=TODAY?"#ef4444":"#6b7280"}}>ทวง {c.dueDate}</div>}
            </div>
          </div>
        ))}
        {filtered.length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:40}}>ไม่พบลูกค้า</div>}
      </div>
      <div style={{position:"fixed",bottom:70,left:"50%",transform:"translateX(-50%)",width:"calc(100% - 32px)",maxWidth:388}}>
        <button onClick={()=>{setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:""});setView("addDebt");}} style={{width:"100%",padding:"14px 0",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.05em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 20px rgba(26,122,74,.4)"}}>+ บันทึกหนี้ใหม่</button>
      </div>
    </div>
  );

  // ══ DASHBOARD ════════════════════════════════
  return(
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f4f6f0",paddingBottom:80}}>
      {toast&&<Toast msg={toast.msg} icon={toast.icon} />}
      <div style={{background:"linear-gradient(135deg,#1a3a2a 0%,#1a7a4a 100%)",color:"#fff",padding:"24px 16px 32px",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-20,right:-20,width:120,height:120,borderRadius:"50%",background:"rgba(255,255,255,.06)"}} />
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",position:"relative"}}>
          <div>
            <div style={{fontSize:"0.85em",opacity:.75,marginBottom:2}}>🏪 สมุดหนี้โชห่วย</div>
            <div style={{fontSize:"0.7em",opacity:.45}}>{lastSync?`🌐 sync ${lastSync}`:""} · {APP_VERSION}</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button onClick={()=>loadAll(true)} disabled={refreshing}
              style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:10,padding:"7px 14px",color:"#fff",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",fontWeight:700,opacity:refreshing?.6:1}}>
              <span style={{display:"inline-block",animation:refreshing?"spin 1s linear infinite":"none"}}>🔄</span> {refreshing?"...":"Refresh"}
            </button>
            {/* Settings button — top right only */}
            <button onClick={goToSettings} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:"50%",width:38,height:38,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>⚙️</button>
          </div>
        </div>
        <div style={{marginTop:16}}>
          <div style={{fontSize:"0.85em",opacity:.75}}>ยอดค้างรวมทั้งหมด</div>
          <div style={{fontSize:"2.2em",fontWeight:800,letterSpacing:"-0.5px"}}>฿{fmt(totalDebt)}</div>
          <div style={{fontSize:"0.8em",opacity:.65}}>จาก {debtors.length} ราย</div>
        </div>
      </div>

      <div style={{padding:"16px 16px 0"}}>
        <div style={{fontSize:"0.78em",color:"#9ca3af",marginBottom:8}}>📌 ลากจัดลำดับ box ได้</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          {boxOrder.map(key=>{const b=BOXES[key];return(
            <div key={key} draggable onDragStart={()=>onDragStart(key)} onDragOver={e=>onDragOver(e,key)} onDragEnd={onDragEnd} onClick={()=>{setSearchQ("");setView("list");}} style={{background:"#fff",borderRadius:16,padding:"14px 14px",cursor:"pointer",boxShadow:"0 2px 10px rgba(0,0,0,.07)",borderLeft:`4px solid ${b.color}`,opacity:dragBox===key?.5:1,userSelect:"none"}}>
              <div style={{fontSize:"1.2em",marginBottom:4}}>{b.icon}</div>
              <div style={{fontSize:"1.6em",fontWeight:800,color:b.color}}>{b.count}</div>
              <div style={{fontSize:"0.8em",color:"#6b7280",lineHeight:1.3}}>{b.label}</div>
            </div>
          );})}
        </div>

        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:16,boxShadow:"0 2px 10px rgba(0,0,0,.07)"}}>
          <div style={{fontWeight:700,marginBottom:12,color:"#1a3a2a",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>📋 ล่าสุด</span>
            <span onClick={()=>setView("list")} style={{fontSize:"0.8em",color:"#1a7a4a",cursor:"pointer",fontWeight:400}}>ดูทั้งหมด →</span>
          </div>
          {recentTx.length===0&&<div style={{color:"#9ca3af",textAlign:"center",padding:16,fontSize:"0.9em"}}>ยังไม่มีรายการ</div>}
          {recentTx.map(tx=>(
            <div key={tx.id} onClick={()=>{if(tx.customer){setSelectedCid(tx.customer.id);setView("customer");}}} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #f3f4f6",cursor:"pointer"}}>
              {tx.customer?<Avatar c={tx.customer} size={36} />:<div style={{width:36,height:36,borderRadius:"50%",background:"#e5e7eb",flexShrink:0}} />}
              <div style={{flex:1}}><div style={{fontWeight:600}}>{tx.customer?.name||"?"}</div><div style={{fontSize:"0.8em",color:"#9ca3af"}}>{tx.date}</div></div>
              <div style={{fontWeight:700,color:"#ef4444"}}>฿{fmt(tx.total)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* FAB */}
      <div style={{position:"fixed",bottom:72,right:"max(16px, calc(50% - 194px))"}}>
        <button onClick={()=>{setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:""});setSearchQ("");setView("addDebt");}} style={{width:60,height:60,borderRadius:"50%",background:"#1a7a4a",border:"none",color:"#fff",fontSize:28,cursor:"pointer",boxShadow:"0 6px 24px rgba(26,122,74,.5)",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
      </div>

      {/* Bottom Nav — 3 items only (settings removed) */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:420,background:"#fff",borderTop:"1px solid #e5e7eb",display:"flex",zIndex:100}}>
        {[["dashboard","🏠","หน้าหลัก"],["list","👥","ลูกหนี้"],["addDebt","➕","บันทึก"]].map(([v,icon,label])=>(
          <button key={v} onClick={()=>{setSearchQ("");if(v==="addDebt"){setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:""});setShowNewCustForm(false);}setView(v);}} style={{flex:1,padding:"10px 0 8px",background:"none",border:"none",cursor:"pointer",color:view===v?"#1a7a4a":"#9ca3af",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:20}}>{icon}</span>
            <span style={{fontSize:"0.72em",fontFamily:"'Sarabun',sans-serif",fontWeight:view===v?700:400}}>{label}</span>
          </button>
        ))}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
