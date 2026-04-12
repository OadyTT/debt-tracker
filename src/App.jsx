import { useState, useRef, useEffect, useCallback } from "react";

// ── v2.0 ──────────────────────────────────────
const APP_VERSION   = "v2.0";
const GAS_URL       = "https://script.google.com/macros/s/AKfycbxrCd34oeytvV3nogkJjJRVLWObLCUpWmE9yR9i2oHdFo-SYOqbU-T9tnzKrFA-5gcM/exec";
const MAIN_ADMIN    = "thitiphankk@gmail.com";
const CORRECT_PIN   = "4207";
const TODAY         = new Date().toISOString().slice(0,10);

const fontLink = document.createElement("link");
fontLink.href = "https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap";
fontLink.rel = "stylesheet";
document.head.appendChild(fontLink);

// ══ PromptPay QR ═══════════════════════════════
function crc16(s){let c=0xFFFF;for(let i=0;i<s.length;i++){c^=s.charCodeAt(i)<<8;for(let j=0;j<8;j++)c=c&0x8000?(c<<1)^0x1021:c<<1;}return(c&0xFFFF).toString(16).toUpperCase().padStart(4,"0");}
function tlv(t,v){return t+String(v.length).padStart(2,"0")+v;}
function genQR(target,amount){const raw=target.replace(/[^0-9]/g,"");const proxy=raw.length===10&&raw.startsWith("0")?"0066"+raw.slice(1):raw;const mi=tlv("00","A000000677010111")+tlv("01",proxy);const body=tlv("00","01")+tlv("01",amount>0?"12":"11")+tlv("29",mi)+tlv("53","764")+(amount>0?tlv("54",Number(amount).toFixed(2)):"")+tlv("58","TH")+"6304";return body+crc16(body);}
const qrUrl=(p,s=220)=>`https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&data=${encodeURIComponent(p)}`;

// ══ API helpers ════════════════════════════════
// GET — returns json
async function gasGet(action="getData"){
  const res=await fetch(`${GAS_URL}?action=${action}`);
  return res.json();
}
// POST — optimistic: fire & forget (no await for response)
function gasPost(payload){
  fetch(GAS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).catch(()=>{});
}
// POST — need response (settings save, photo upload)
async function gasPostRead(payload){
  try{const r=await fetch(GAS_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});return r.json();}
  catch{gasPost(payload);await delay(1500);return{ok:true};}
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));

// ══ Image compression ══════════════════════════
function compressImage(file,maxPx=400){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const sc=Math.min(1,maxPx/Math.max(img.width,img.height));
      const c=document.createElement("canvas");
      c.width=Math.round(img.width*sc);c.height=Math.round(img.height*sc);
      c.getContext("2d").drawImage(img,0,0,c.width,c.height);
      resolve(c.toDataURL("image/jpeg",0.75));
    };
    img.src=URL.createObjectURL(file);
  });
}

// ══ Helpers ════════════════════════════════════
const fmt=n=>Number(n).toLocaleString("th-TH");
const initial=name=>name.trim().charAt(0);
const aColor=name=>["#e07b39","#3b82f6","#22c55e","#a855f7","#ef4444","#f59e0b","#06b6d4"][name.charCodeAt(0)%7];

// ══ Email builders ═════════════════════════════
function debtEmail(c,items,total,dueDate){
  const rows=items.map(it=>`<tr><td style="padding:5px 0;">${it.name}</td><td style="text-align:right;font-weight:600;">฿${fmt(it.price)}</td></tr>`).join("");
  return{subject:`📝 บันทึกหนี้ — ${c.name} ฿${fmt(total)}`,
    htmlBody:`<h3 style="color:#1a3a2a;margin:0 0 12px;">📝 บันทึกหนี้ใหม่</h3>
      <p><b>${c.name}</b> | ${TODAY} ${dueDate?`| ทวง ${dueDate}`:""}</p>
      <table style="width:100%">${rows}</table><hr>
      <b>รวม: ฿${fmt(total)} | ยอดค้างรวม: ฿${fmt((c.totalDebt||0)+total)}</b>`,
    body:`บันทึกหนี้ใหม่\n${c.name}\n${items.map(i=>i.name+" ฿"+i.price).join(", ")}\nรวม ฿${fmt(total)}`};
}
function paidEmail(c,amount){
  const rem=Math.max(0,(c.totalDebt||0)-amount);
  return{subject:`💰 รับชำระ — ${c.name} ฿${fmt(amount)}`,
    htmlBody:`<h3 style="color:#15803d;">💰 รับชำระแล้ว</h3><p><b>${c.name}</b> | ฿${fmt(amount)} | ${TODAY}</p><p>ยอดค้างคงเหลือ: <b style="color:${rem>0?"#ef4444":"#15803d"}">${rem>0?"฿"+fmt(rem):"✅ ชำระครบ!"}</b></p>`,
    body:`รับชำระ ${c.name} ฿${fmt(amount)} ยอดค้างคงเหลือ ${rem>0?"฿"+fmt(rem):"ชำระครบ!"}`};
}

// ══ Components ═════════════════════════════════

function PinScreen({onSuccess,onCancel}){
  const [d,setD]=useState([]);const[shake,setShake]=useState(false);const[err,setErr]=useState(false);
  const press=k=>{if(d.length>=4)return;const n=[...d,k];setD(n);if(n.length===4){if(n.join("")===CORRECT_PIN){setTimeout(onSuccess,200);}else{setShake(true);setErr(true);setTimeout(()=>{setD([]);setShake(false);setErr(false);},700);}}};
  return(
    <div style={{position:"fixed",inset:0,background:"linear-gradient(160deg,#1a3a2a,#0d1f17)",zIndex:1000,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Sarabun',sans-serif"}}>
      <div style={{fontSize:32,marginBottom:8}}>🔒</div>
      <div style={{color:"#fff",fontWeight:700,fontSize:"1.2em",marginBottom:4}}>รหัสผ่าน ตั้งค่า</div>
      <div style={{color:"rgba(255,255,255,.5)",fontSize:"0.85em",marginBottom:36}}>กรุณาใส่รหัส 4 หลัก</div>
      <div style={{display:"flex",gap:16,marginBottom:36,animation:shake?"shake .5s":"none"}}>
        {[0,1,2,3].map(i=><div key={i} style={{width:18,height:18,borderRadius:"50%",border:"2px solid rgba(255,255,255,.4)",background:d.length>i?(err?"#ef4444":"#22c55e"):"transparent",transition:"background .15s"}} />)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,width:240}}>
        {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k,i)=>(
          <button key={i} onClick={()=>k==="⌫"?setD(d=>d.slice(0,-1)):k?press(k):null} disabled={!k}
            style={{height:64,borderRadius:16,border:"none",background:k?"rgba(255,255,255,.1)":"transparent",color:"#fff",fontSize:k==="⌫"?"1.4em":"1.5em",fontWeight:600,cursor:k?"pointer":"default",fontFamily:"'Sarabun',sans-serif"}}>{k}</button>
        ))}
      </div>
      <button onClick={onCancel} style={{marginTop:28,background:"none",border:"none",color:"rgba(255,255,255,.45)",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em"}}>← ยกเลิก</button>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
    </div>
  );
}

function Spinner({text="กำลังโหลด..."}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:998,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Sarabun',sans-serif"}}>
      <div style={{background:"#fff",borderRadius:20,padding:"28px 36px",textAlign:"center"}}>
        <div style={{fontSize:32,marginBottom:8,display:"inline-block",animation:"spin 1s linear infinite"}}>🔄</div>
        <div style={{fontWeight:700,color:"#1a3a2a",marginTop:8}}>{text}</div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function Avatar({c,size=48}){
  const fs=size>50?Math.round(size*.38):Math.round(size*.45);
  return(
    <div style={{width:size,height:size,borderRadius:"50%",background:aColor(c.name),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:fs,flexShrink:0,overflow:"hidden",border:size>50?`3px solid ${aColor(c.name)}55`:"none"}}>
      {c.photo?<img src={c.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>e.target.style.display="none"} />:initial(c.name)}
    </div>
  );
}

// Photo uploader — เรียกจากไหนก็ได้
function PhotoBtn({customerId,onUploaded,small=false}){
  const [st,setSt]=useState("idle");
  const ref=useRef();
  const handle=async e=>{
    const f=e.target.files[0];if(!f)return;
    setSt("up");
    try{
      const b64=await compressImage(f,400);
      const res=await gasPostRead({action:"savePhoto",customerId,base64:b64,mimeType:"image/jpeg"});
      if(res.ok&&res.photoUrl){onUploaded(res.photoUrl);setSt("ok");}else setSt("err");
    }catch{setSt("err");}
    setTimeout(()=>setSt("idle"),2500);
  };
  const sz=small?22:26;
  const bg=st==="ok"?"#22c55e":st==="err"?"#ef4444":"rgba(0,0,0,.6)";
  return(
    <>
      <input ref={ref} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handle} />
      <button onClick={()=>ref.current?.click()} title="เปลี่ยนรูป"
        style={{background:bg,border:"2px solid #fff",borderRadius:"50%",width:sz,height:sz,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:sz*.5,color:"#fff"}}>
        {st==="up"?"⏳":st==="ok"?"✅":st==="err"?"❌":"📷"}
      </button>
    </>
  );
}

// ── Edit Transaction Modal ───────────────────
function EditTxModal({tx,customer,onSave,onClose}){
  const [items,setItems]=useState(tx.items.map(it=>({...it})));
  const total=items.reduce((s,it)=>s+(parseFloat(it.price)||0),0);
  const addRow=()=>setItems(p=>[...p,{name:"",price:""}]);
  const del=i=>setItems(p=>p.filter((_,j)=>j!==i));
  const upd=(i,f,v)=>setItems(p=>{const a=[...p];a[i]={...a[i],[f]:v};return a;});
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",zIndex:997,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:420,padding:20,paddingBottom:36,maxHeight:"80vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div><div style={{fontWeight:800,color:"#1a3a2a"}}>✏️ แก้ไขรายการ</div><div style={{color:"#6b7280",fontSize:"0.82em"}}>{customer.name} | {tx.date}</div></div>
          <button onClick={onClose} style={{background:"#f3f4f6",border:"none",borderRadius:"50%",width:34,height:34,cursor:"pointer",fontSize:16}}>✕</button>
        </div>
        {items.map((it,i)=>(
          <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
            <input value={it.name} onChange={e=>upd(i,"name",e.target.value)} placeholder="ชื่อสินค้า"
              style={{flex:2,padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",outline:"none"}} />
            <input value={it.price} onChange={e=>upd(i,"price",e.target.value)} placeholder="฿" type="number" inputMode="numeric"
              style={{flex:1,padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",outline:"none"}} />
            <button onClick={()=>del(i)} style={{background:"#fee2e2",border:"none",borderRadius:8,padding:"8px 10px",cursor:"pointer",color:"#ef4444",fontWeight:700}}>🗑</button>
          </div>
        ))}
        <button onClick={addRow} style={{width:"100%",padding:"9px 0",background:"#f0fdf4",border:"1.5px dashed #22c55e",borderRadius:10,color:"#15803d",fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.95em",marginBottom:12}}>+ เพิ่มรายการ</button>
        <div style={{display:"flex",justifyContent:"space-between",padding:"10px 12px",background:"#f9fafb",borderRadius:10,marginBottom:14}}>
          <span style={{fontWeight:700}}>รวมใหม่</span>
          <span style={{fontWeight:800,color:"#1a3a2a"}}>฿{fmt(total)}</span>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:"12px 0",background:"#f3f4f6",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>ยกเลิก</button>
          <button onClick={()=>onSave(items.filter(it=>it.name||it.price),total)}
            style={{flex:2,padding:"12px 0",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:12,fontWeight:800,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>💾 บันทึก</button>
        </div>
      </div>
    </div>
  );
}

// ── New Customer Modal ───────────────────────
function NewCustModal({initName,gasUrl:_,onSave,onClose}){
  const [name,setName]=useState(initName);
  const [phone,setPhone]=useState("");
  const [photo,setPhoto]=useState(null); // base64
  const [uploading,setUploading]=useState(false);
  const imgRef=useRef();

  const handleImg=async e=>{
    const f=e.target.files[0];if(!f)return;
    setUploading(true);
    const b=await compressImage(f,400);
    setPhoto(b);setUploading(false);
  };

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",zIndex:997,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:420,padding:20,paddingBottom:36}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontWeight:800,color:"#1a3a2a"}}>➕ เพิ่มลูกค้าใหม่</div>
          <button onClick={onClose} style={{background:"#f3f4f6",border:"none",borderRadius:"50%",width:34,height:34,cursor:"pointer",fontSize:16}}>✕</button>
        </div>
        {/* Photo */}
        <div style={{textAlign:"center",marginBottom:16}}>
          <div style={{position:"relative",width:80,height:80,margin:"0 auto"}}>
            <div style={{width:80,height:80,borderRadius:"50%",background:"#e5e7eb",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,color:"#9ca3af"}}>
              {photo?<img src={photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} />:"👤"}
            </div>
            <input ref={imgRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handleImg} />
            <button onClick={()=>imgRef.current?.click()}
              style={{position:"absolute",bottom:0,right:0,background:photo?"#22c55e":"#1a7a4a",border:"2px solid #fff",borderRadius:"50%",width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:12,color:"#fff"}}>
              {uploading?"⏳":"📷"}
            </button>
          </div>
          <div style={{color:"#6b7280",fontSize:"0.8em",marginTop:6}}>กดถ่ายรูปลูกค้า (ไม่บังคับ)</div>
        </div>
        <div style={{marginBottom:10}}>
          <div style={{fontWeight:600,marginBottom:6,color:"#1a3a2a"}}>ชื่อ-นามสกุล *</div>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="ชื่อลูกค้า"
            style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}} />
        </div>
        <div style={{marginBottom:16}}>
          <div style={{fontWeight:600,marginBottom:6,color:"#1a3a2a"}}>เบอร์โทร (ถ้ามี)</div>
          <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="08x-xxx-xxxx" type="tel"
            style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}} />
        </div>
        <button onClick={()=>name.trim()&&onSave({name:name.trim(),phone,photoBase64:photo})}
          disabled={!name.trim()}
          style={{width:"100%",padding:"14px 0",background:name.trim()?"#1a7a4a":"#d1d5db",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.05em",cursor:name.trim()?"pointer":"not-allowed",fontFamily:"'Sarabun',sans-serif"}}>
          ✅ เพิ่มลูกค้า
        </button>
      </div>
    </div>
  );
}

// ── QR Modal ────────────────────────────────
function QRModal({customer,settings,onPaid,onClose}){
  const [amount,setAmount]=useState(customer.totalDebt>0?String(customer.totalDebt):"");
  const [st,setSt]=useState("idle");
  const handleConfirm=async()=>{
    const amt=Number(amount)||customer.totalDebt;
    setSt("sending");
    const extras=(settings.adminUsers||[]).map(u=>u.email).filter(Boolean);
    gasPost({action:"notifyEmail",...paidEmail(customer,amt),extraEmails:extras});
    await onPaid(amt);
    setSt("done");
    setTimeout(onClose,1500);
  };
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",zIndex:999,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:420,padding:24,paddingBottom:40}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div><div style={{fontWeight:800,fontSize:"1.1em",color:"#1a3a2a"}}>💳 QR รับชำระ</div><div style={{color:"#6b7280",fontSize:"0.85em"}}>{customer.name} • ค้างอยู่ ฿{fmt(customer.totalDebt)}</div></div>
          <button onClick={onClose} style={{background:"#f3f4f6",border:"none",borderRadius:"50%",width:36,height:36,cursor:"pointer",fontSize:18}}>✕</button>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          <input type="number" inputMode="numeric" value={amount} onChange={e=>setAmount(e.target.value)}
            style={{flex:1,padding:"12px 14px",border:"2px solid #1a7a4a",borderRadius:12,fontFamily:"'Sarabun',sans-serif",fontSize:"1.3em",fontWeight:700,color:"#1a3a2a",outline:"none"}} />
          <button onClick={()=>setAmount(String(customer.totalDebt))} style={{padding:"10px 12px",background:"#f0fdf4",border:"1.5px solid #22c55e",borderRadius:10,color:"#15803d",fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",lineHeight:1.4}}>เต็ม<br/>฿{fmt(customer.totalDebt)}</button>
        </div>
        {settings.promptpayId?(
          <div style={{textAlign:"center",marginBottom:14}}>
            <div style={{display:"inline-block",padding:10,background:"#fff",borderRadius:16,boxShadow:"0 4px 20px rgba(0,0,0,.12)",border:"3px solid #06c755"}}>
              <img src={qrUrl(genQR(settings.promptpayId,Number(amount)||0))} alt="QR" width={200} height={200} style={{display:"block",borderRadius:8}} />
            </div>
            <div style={{marginTop:8,fontWeight:700,color:"#1a3a2a"}}>{Number(amount)>0?`฿${Number(amount).toLocaleString("th-TH")}`:"ไม่ระบุจำนวน"}</div>
          </div>
        ):<div style={{background:"#fff7ed",borderRadius:14,padding:16,textAlign:"center",marginBottom:14}}><div style={{fontWeight:700,color:"#92400e"}}>⚠️ ยังไม่ได้ตั้งค่า PromptPay</div></div>}
        {st==="done"&&<div style={{background:"#f0fdf4",borderRadius:10,padding:10,textAlign:"center",marginBottom:12,color:"#15803d",fontWeight:700}}>✅ บันทึกแล้ว!</div>}
        <button onClick={handleConfirm} disabled={st!=="idle"}
          style={{width:"100%",padding:"14px 0",background:st==="sending"?"#9ca3af":st==="done"?"#22c55e":"#1a7a4a",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.05em",cursor:st==="idle"?"pointer":"default",fontFamily:"'Sarabun',sans-serif"}}>
          {st==="sending"?"⏳ กำลังบันทึก...":st==="done"?"✅ บันทึกแล้ว":"✅ ยืนยันรับเงิน + แจ้ง Email"}
        </button>
      </div>
    </div>
  );
}

// ── Admin User Manager ───────────────────────
function AdminMgr({users,onChange}){
  const [show,setShow]=useState(false);
  const [form,setForm]=useState({name:"",email:"",lineUserId:""});
  const [err,setErr]=useState("");
  const [showLineHelp,setShowLineHelp]=useState(false);
  const LINK=`${GAS_URL}?action=lineId`;

  const add=()=>{
    if(!form.email.includes("@")){setErr("Email ไม่ถูกต้อง");return;}
    if(form.email===MAIN_ADMIN){setErr("นี่คือ admin หลักอยู่แล้ว");return;}
    if(users.find(u=>u.email===form.email)){setErr("มีอีเมลนี้แล้ว");return;}
    onChange([...users,{...form}]);
    setForm({name:"",email:"",lineUserId:""});setErr("");setShow(false);
  };
  const del=i=>onChange(users.filter((_,j)=>j!==i));

  return(
    <div>
      {/* Main admin row */}
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#f0fdf4",borderRadius:10,marginBottom:8,border:"1.5px solid #22c55e"}}>
        <div style={{width:32,height:32,borderRadius:"50%",background:"#15803d",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14,fontWeight:700}}>👑</div>
        <div style={{flex:1}}><div style={{fontWeight:700,fontSize:"0.9em",color:"#15803d"}}>Admin หลัก</div><div style={{fontSize:"0.78em",color:"#166534"}}>{MAIN_ADMIN}</div></div>
        <span style={{background:"#bbf7d0",borderRadius:6,padding:"2px 8px",fontSize:"0.72em",fontWeight:700,color:"#15803d"}}>เสมอ</span>
      </div>
      {users.map((u,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#fff",borderRadius:10,marginBottom:8,border:"1.5px solid #e5e7eb"}}>
          <div style={{width:32,height:32,borderRadius:"50%",background:"#3b82f6",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14,fontWeight:700}}>👤</div>
          <div style={{flex:1}}>
            {u.name&&<div style={{fontWeight:600,fontSize:"0.88em"}}>{u.name}</div>}
            <div style={{fontSize:"0.82em",color:"#374151",wordBreak:"break-all"}}>{u.email}</div>
            {u.lineUserId&&<div style={{fontSize:"0.72em",color:"#6b7280",fontFamily:"monospace"}}>{u.lineUserId}</div>}
          </div>
          <button onClick={()=>del(i)} style={{background:"#fee2e2",border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer",color:"#ef4444",fontWeight:700}}>ลบ</button>
        </div>
      ))}

      {/* Add form toggle */}
      {show?(
        <div style={{background:"#f9fafb",borderRadius:12,padding:14,border:"1.5px solid #e5e7eb",marginBottom:8}}>
          <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="ชื่อ (ไม่บังคับ)"
            style={{width:"100%",padding:"8px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.88em",boxSizing:"border-box",outline:"none",marginBottom:8}} />
          <input value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="Email *"
            style={{width:"100%",padding:"8px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.88em",boxSizing:"border-box",outline:"none",marginBottom:8}} />
          <div style={{display:"flex",gap:6}}>
            <input value={form.lineUserId} onChange={e=>setForm(f=>({...f,lineUserId:e.target.value}))} placeholder="LINE User ID (ไม่บังคับ)"
              style={{flex:1,padding:"8px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",boxSizing:"border-box",outline:"none"}} />
            <button onClick={()=>setShowLineHelp(true)} title="วิธีหา LINE User ID"
              style={{padding:"8px 10px",background:"#f0fdf4",border:"1.5px solid #22c55e",borderRadius:10,color:"#15803d",fontWeight:700,cursor:"pointer",fontSize:"0.82em",flexShrink:0}}>🔍</button>
          </div>
          {err&&<div style={{color:"#ef4444",fontSize:"0.8em",marginTop:4}}>{err}</div>}
          <div style={{display:"flex",gap:8,marginTop:10}}>
            <button onClick={()=>setShow(false)} style={{flex:1,padding:"9px 0",background:"#f3f4f6",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>ยกเลิก</button>
            <button onClick={add} style={{flex:2,padding:"9px 0",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>+ เพิ่ม</button>
          </div>
        </div>
      ):(
        <button onClick={()=>setShow(true)} style={{width:"100%",padding:"10px 0",background:"#eff6ff",border:"1.5px dashed #3b82f6",borderRadius:10,color:"#3b82f6",fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em"}}>
          + เพิ่มผู้ช่วย Admin
        </button>
      )}

      {/* Share link to get LINE User ID */}
      <div style={{marginTop:10,background:"#f9fafb",borderRadius:10,padding:"10px 12px",display:"flex",gap:8,alignItems:"center"}}>
        <div style={{flex:1,fontSize:"0.78em",color:"#6b7280"}}>📤 แชร์ link ให้ผู้ช่วย admin เพื่อส่งคำขอ + LINE User ID</div>
        <button onClick={()=>{navigator.clipboard?.writeText(LINK)||window.open(LINK);}} style={{padding:"6px 12px",background:"#1a3a2a",color:"#fff",border:"none",borderRadius:8,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.78em",flexShrink:0}}>คัดลอก</button>
      </div>

      {/* LINE ID help modal */}
      {showLineHelp&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setShowLineHelp(false)}>
          <div style={{background:"#fff",borderRadius:20,padding:24,maxWidth:380,width:"100%"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontWeight:800,color:"#1a3a2a",marginBottom:12}}>🔍 วิธีหา LINE User ID</div>
            {[["วิธีที่ 1","เปิด LINE → โปรไฟล์ → กดรูปตัวเอง → ดู ID ขึ้นต้น U"],["วิธีที่ 2","เปิด developers.line.biz → Login → My Account → User ID"],["วิธีที่ 3","ให้ผู้ช่วย admin เปิด link ด้านล่างใน LINE แล้วกรอกคำขอ"]].map(([t,d],i)=>(
              <div key={i} style={{display:"flex",gap:10,marginBottom:10}}>
                <span style={{background:"#1a3a2a",color:"#fff",borderRadius:6,padding:"2px 8px",fontSize:"0.75em",fontWeight:700,flexShrink:0,height:"fit-content"}}>{t}</span>
                <span style={{fontSize:"0.85em",color:"#374151"}}>{d}</span>
              </div>
            ))}
            <div style={{background:"#f0fdf4",borderRadius:10,padding:10,marginBottom:14}}>
              <div style={{fontSize:"0.78em",color:"#166534",wordBreak:"break-all"}}>{LINK}</div>
            </div>
            <button onClick={()=>{navigator.clipboard?.writeText(LINK);setShowLineHelp(false);}}
              style={{width:"100%",padding:"12px 0",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>
              📋 คัดลอก Link
            </button>
            <button onClick={()=>setShowLineHelp(false)} style={{width:"100%",marginTop:8,padding:"10px 0",background:"none",border:"none",color:"#6b7280",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em"}}>ปิด</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
//  Main App
// ══════════════════════════════════════════════
export default function App(){
  const [customers,    setCustomers]    = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [settings,     setSettings]     = useState({promptpayId:"",adminUsers:[]});
  const [draft,        setDraft]        = useState({promptpayId:"",adminUsers:[]});
  const [initState,    setInitState]    = useState("loading");
  const [busy,         setBusy]         = useState(false);
  const [busyText,     setBusyText]     = useState("");
  const [refreshing,   setRefreshing]   = useState(false);
  const [lastSync,     setLastSync]     = useState(null);
  const [syncDot,      setSyncDot]      = useState("ok"); // ok|syncing
  const [view,         setView]         = useState("dashboard");
  const [selCid,       setSelCid]       = useState(null);
  const [fontSize,     setFontSize]     = useState("md");
  const [searchQ,      setSearchQ]      = useState("");
  const [newDebt,      setNewDebt]      = useState({customer:null,items:[{name:"",price:""}],dueDate:""});
  const [boxOrder,     setBoxOrder]     = useState(["due","all","today","paid"]);
  const [drag,         setDrag]         = useState(null);
  const [showQR,       setShowQR]       = useState(false);
  const [showPin,      setShowPin]      = useState(false);
  const [pinOk,        setPinOk]        = useState(false);
  const [editTx,       setEditTx]       = useState(null);
  const [newCustModal, setNewCustModal] = useState(null);
  const FS={sm:"13px",md:"15px",lg:"17px",xl:"20px"};
  const S={fontSize:FS[fontSize],fontFamily:"'Sarabun',sans-serif"};

  // ── Sync dot helper ─────────────────────────
  const markSyncing=()=>{setSyncDot("syncing");setTimeout(()=>setSyncDot("ok"),4000);};

  // ── Load data + settings ────────────────────
  const loadAll=useCallback(async(isRefresh=false)=>{
    isRefresh?setRefreshing(true):setInitState("loading");
    try{
      const[dr,sr]=await Promise.all([gasGet("getData"),gasGet("getSettings")]);
      if(dr.ok){setCustomers(dr.customers||[]);setTransactions(dr.transactions||[]);setLastSync(new Date().toLocaleTimeString("th-TH"));}
      if(sr.ok&&sr.settings){setSettings(sr.settings);setDraft(sr.settings);}
      setInitState("ready");
    }catch{setInitState("error");}
    setRefreshing(false);
  },[]);

  useEffect(()=>{loadAll();},[]);

  // ── Computed ─────────────────────────────────
  const totalDebt  =customers.reduce((s,c)=>s+c.totalDebt,0);
  const debtors    =customers.filter(c=>c.totalDebt>0);
  const dueToday   =customers.filter(c=>c.dueDate===TODAY&&c.totalDebt>0);
  const todayCids  =[...new Set(transactions.filter(t=>t.date===TODAY).map(t=>t.customerId))];
  const todayCusts =customers.filter(c=>todayCids.includes(c.id));
  const paidMonth  =customers.filter(c=>c.totalDebt===0&&c.phone);
  const recentTx   =[...transactions].sort((a,b)=>b.id-a.id).slice(0,5).map(t=>({...t,customer:customers.find(c=>c.id===t.customerId)}));
  const filtered   =customers.filter(c=>c.name.includes(searchQ));
  const BOXES={
    due:  {label:"ครบกำหนดวันนี้", count:dueToday.length,    color:"#ef4444",icon:"🔴"},
    all:  {label:"ลูกหนี้ทั้งหมด", count:debtors.length,      color:"#f59e0b",icon:"🟡"},
    today:{label:"เพิ่งซื้อวันนี้",count:todayCusts.length,  color:"#3b82f6",icon:"🔵"},
    paid: {label:"จ่ายแล้วเดือนนี้",count:paidMonth.length,  color:"#22c55e",icon:"✅"},
  };

  const onDragStart=k=>setDrag(k);
  const onDragOver=(e,k)=>{e.preventDefault();if(!drag||drag===k)return;const a=[...boxOrder],f=a.indexOf(drag),t=a.indexOf(k);a.splice(f,1);a.splice(t,0,drag);setBoxOrder(a);};

  const debtTotal=newDebt.items.reduce((s,it)=>s+(parseFloat(it.price)||0),0);
  const addItem=()=>setNewDebt(d=>({...d,items:[...d.items,{name:"",price:""}]}));
  const delItem=i=>setNewDebt(d=>({...d,items:d.items.filter((_,j)=>j!==i)}));
  const updItem=(i,f,v)=>setNewDebt(d=>{const it=[...d.items];it[i]={...it[i],[f]:v};return{...d,items:it};});

  // ── Optimistic: add debt ──────────────────────
  const confirmDebt=()=>{
    if(!newDebt.customer||debtTotal<=0)return;
    const c=newDebt.customer;
    const items=newDebt.items.filter(it=>it.name||it.price).map(it=>({name:it.name||"รายการ",price:parseFloat(it.price)||0}));
    const txId=Date.now();
    // optimistic update
    setCustomers(prev=>prev.map(cu=>cu.id===c.id?{...cu,totalDebt:cu.totalDebt+debtTotal,dueDate:newDebt.dueDate||cu.dueDate}:cu));
    setTransactions(prev=>[...prev,{id:txId,customerId:c.id,date:TODAY,items,total:debtTotal,paid:false}]);
    // fire to server
    gasPost({action:"addDebt",txId,customerId:c.id,date:TODAY,items,total:debtTotal,dueDate:newDebt.dueDate||""});
    // email notify
    const extras=(settings.adminUsers||[]).map(u=>u.email).filter(Boolean);
    gasPost({action:"notifyEmail",...debtEmail(c,items,debtTotal,newDebt.dueDate),extraEmails:extras});
    markSyncing();
    setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:""});
    setView("dashboard");
  };

  // ── Optimistic: mark paid ─────────────────────
  const handleMarkPaid=async(cid,amount)=>{
    const c=customers.find(x=>x.id===cid);
    const fullPay=amount>=(c?.totalDebt||0);
    const newTotal=Math.max(0,(c?.totalDebt||0)-amount);
    // optimistic update
    setCustomers(prev=>prev.map(cu=>cu.id===cid?{...cu,totalDebt:newTotal,dueDate:newTotal===0?null:cu.dueDate}:cu));
    if(fullPay) setTransactions(prev=>prev.map(t=>t.customerId===cid?{...t,paid:true}:t));
    gasPost({action:"markPaid",customerId:cid,amount,fullPay});
    markSyncing();
    setShowQR(false);
  };

  // ── Optimistic: edit transaction ──────────────
  const handleEditTx=(tx,newItems,newTotal)=>{
    const oldTotal=tx.total;
    // optimistic update
    setTransactions(prev=>prev.map(t=>t.id===tx.id?{...t,items:newItems,total:newTotal}:t));
    setCustomers(prev=>prev.map(c=>c.id===tx.customerId?{...c,totalDebt:Math.max(0,c.totalDebt+(newTotal-oldTotal))}:c));
    gasPost({action:"updateTransaction",txId:tx.id,customerId:tx.customerId,items:newItems,total:newTotal,oldTotal});
    markSyncing();
    setEditTx(null);
  };

  // ── Add new customer (with photo) ─────────────
  const handleNewCust=async(data)=>{
    const id=Date.now();
    const newC={id,name:data.name,phone:data.phone,totalDebt:0,dueDate:null,photo:null};
    setCustomers(prev=>[...prev,newC]);
    setNewCustModal(null);
    setNewDebt(d=>({...d,customer:newC}));
    // POST to GAS
    gasPost({action:"addCustomer",id,name:data.name,phone:data.phone});
    // Upload photo if provided
    if(data.photoBase64){
      try{
        const res=await gasPostRead({action:"savePhoto",customerId:id,base64:data.photoBase64,mimeType:"image/jpeg"});
        if(res.ok&&res.photoUrl) setCustomers(prev=>prev.map(c=>c.id===id?{...c,photo:res.photoUrl}:c));
      }catch{}
    }
    markSyncing();
  };

  // ── Save settings ─────────────────────────────
  const saveSettings=async()=>{
    setBusy(true);setBusyText("บันทึกตั้งค่า...");
    await gasPostRead({action:"saveSettings",settings:draft});
    setSettings(draft);
    setBusy(false);
  };

  const goSettings=()=>{if(pinOk){setDraft({...settings});setView("settings");}else{setShowPin(true);}};

  // ══ Screens ════════════════════════════════════

  if(initState==="loading") return(
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f4f6f0",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <div style={{fontSize:48,marginBottom:12,display:"inline-block",animation:"spin 2s linear infinite"}}>🔄</div>
      <div style={{fontWeight:700,color:"#1a3a2a"}}>กำลังโหลดข้อมูล...</div>
      <div style={{color:"#9ca3af",fontSize:"0.82em",marginTop:6}}>สมุดหนี้โชห่วย {APP_VERSION}</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if(initState==="error") return(
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f4f6f0",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:16}}>⚠️</div>
      <div style={{fontWeight:700,color:"#ef4444",marginBottom:8}}>โหลดข้อมูลไม่สำเร็จ</div>
      <div style={{color:"#6b7280",fontSize:"0.85em",marginBottom:24}}>ตรวจสอบ GAS URL และ Internet</div>
      <button onClick={()=>loadAll()} style={{padding:"12px 28px",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"1em"}}>🔄 ลองใหม่</button>
    </div>
  );

  if(showPin) return <PinScreen onSuccess={()=>{setShowPin(false);setPinOk(true);setDraft({...settings});setView("settings");}} onCancel={()=>setShowPin(false)} />;

  // ── SETTINGS ──────────────────────────────────
  if(view==="settings") return(
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f9fafb",paddingBottom:40}}>
      {busy&&<Spinner text={busyText} />}
      <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>{setPinOk(false);setView("dashboard");}} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
        <span style={{fontWeight:700,fontSize:"1.1em"}}>⚙️ ตั้งค่า</span>
        <span style={{marginLeft:"auto",background:"rgba(255,255,255,.15)",borderRadius:8,padding:"3px 10px",fontSize:"0.72em"}}>{APP_VERSION}</span>
      </div>
      <div style={{padding:16}}>
        {/* PromptPay */}
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{background:"#004f9f",color:"#fff",borderRadius:6,padding:"2px 10px",fontSize:"0.8em",fontWeight:700}}>PromptPay</span>
            <span style={{fontWeight:700,color:"#1a3a2a"}}>เบอร์รับเงิน</span>
          </div>
          <input value={draft.promptpayId} onChange={e=>setDraft(d=>({...d,promptpayId:e.target.value}))}
            placeholder="0812345678" inputMode="numeric"
            style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}} />
          {draft.promptpayId&&(
            <div style={{marginTop:10,textAlign:"center"}}>
              <img src={qrUrl(genQR(draft.promptpayId,0),120)} alt="qr" style={{borderRadius:10,border:"2px solid #e5e7eb"}} />
            </div>
          )}
        </div>

        {/* Admin Users */}
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
            <span style={{fontSize:"1.1em"}}>📧</span>
            <span style={{fontWeight:700,color:"#1a3a2a"}}>ผู้รับแจ้งเตือน & ผู้ช่วย Admin</span>
          </div>
          <div style={{color:"#6b7280",fontSize:"0.8em",marginBottom:12}}>รับ Email เมื่อมีการบันทึกหนี้หรือรับชำระ</div>
          <AdminMgr users={draft.adminUsers||[]} onChange={u=>setDraft(d=>({...d,adminUsers:u}))} />
        </div>

        <button onClick={saveSettings} style={{width:"100%",padding:"14px 0",background:"#1a3a2a",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",marginBottom:14,boxShadow:"0 4px 16px rgba(26,58,42,.3)"}}>
          💾 บันทึกตั้งค่าขึ้น Server
        </button>

        {/* Font size */}
        <div style={{background:"#fff",borderRadius:14,padding:16,marginBottom:14}}>
          <div style={{fontWeight:700,marginBottom:12,color:"#1a3a2a"}}>🔤 ขนาดตัวอักษร</div>
          <div style={{display:"flex",gap:8}}>
            {[["sm","เล็ก"],["md","กลาง"],["lg","ใหญ่"],["xl","ใหญ่มาก"]].map(([k,l])=>(
              <button key={k} onClick={()=>setFontSize(k)} style={{flex:1,padding:"10px 4px",borderRadius:10,border:`2px solid ${fontSize===k?"#1a7a4a":"#e5e7eb"}`,background:fontSize===k?"#f0fdf4":"#fff",fontWeight:fontSize===k?700:400,color:fontSize===k?"#1a7a4a":"#6b7280",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:FS[k]}}>{l}</button>
            ))}
          </div>
        </div>

        {/* GAS URL info */}
        <div style={{background:"#f9fafb",borderRadius:12,padding:12}}>
          <div style={{fontWeight:600,color:"#6b7280",fontSize:"0.8em",marginBottom:4}}>🔗 GAS URL (อ่านอย่างเดียว)</div>
          <div style={{fontSize:"0.72em",color:"#9ca3af",wordBreak:"break-all",fontFamily:"monospace"}}>{GAS_URL}</div>
        </div>
      </div>
    </div>
  );

  // ── CUSTOMER DETAIL ───────────────────────────
  if(view==="customer"&&selCid){
    const c=customers.find(x=>x.id===selCid);
    if(!c){setView("list");return null;}
    const txList=[...transactions].filter(t=>t.customerId===c.id).sort((a,b)=>b.id-a.id);
    return(
      <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f9fafb",paddingBottom:80}}>
        {busy&&<Spinner text={busyText} />}
        {editTx&&<EditTxModal tx={editTx} customer={c} onSave={(items,total)=>handleEditTx(editTx,items,total)} onClose={()=>setEditTx(null)} />}
        {showQR&&<QRModal customer={c} settings={settings} onPaid={async amt=>handleMarkPaid(c.id,amt)} onClose={()=>setShowQR(false)} />}
        <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 24px"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
            <button onClick={()=>setView("list")} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
            <span style={{fontWeight:700,fontSize:"1.1em",flex:1}}>ประวัติลูกค้า</span>
            <button onClick={()=>loadAll(true)} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:10,padding:"6px 12px",color:"#fff",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",fontWeight:600}}>{refreshing?"⏳":"🔄"}</button>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{position:"relative",width:64,height:64,flexShrink:0}}>
              <Avatar c={c} size={64} />
              <div style={{position:"absolute",bottom:0,right:0}}>
                <PhotoBtn customerId={c.id} onUploaded={url=>setCustomers(prev=>prev.map(cu=>cu.id===c.id?{...cu,photo:url}:cu))} />
              </div>
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
            <div key={tx.id} style={{background:"#fff",borderRadius:14,padding:14,marginBottom:10,boxShadow:"0 2px 8px rgba(0,0,0,.06)",opacity:tx.paid?.6:1}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,alignItems:"center"}}>
                <span style={{color:"#6b7280",fontSize:"0.85em"}}>📅 {tx.date}</span>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontWeight:700,color:tx.paid?"#22c55e":"#ef4444"}}>{tx.paid?"✅ จ่ายแล้ว":`฿${fmt(tx.total)}`}</span>
                  {!tx.paid&&<button onClick={()=>setEditTx(tx)} title="แก้ไขรายการ" style={{background:"#f0f9ff",border:"1.5px solid #bae6fd",borderRadius:8,padding:"4px 8px",cursor:"pointer",color:"#0284c7",fontSize:"0.78em",fontWeight:700}}>✏️ แก้ไข</button>}
                </div>
              </div>
              {(tx.items||[]).map((it,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:"0.9em",color:"#374151",paddingBottom:3}}>
                  <span>{it.name}</span><span>฿{fmt(it.price)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── CONFIRM ───────────────────────────────────
  if(view==="confirm"&&newDebt.customer){const c=newDebt.customer;return(
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f9fafb",paddingBottom:80}}>
      <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>setView("addDebt")} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
        <span style={{fontWeight:700,fontSize:"1.1em"}}>✅ ยืนยันก่อนบันทึก</span>
      </div>
      <div style={{padding:16}}>
        <div style={{background:"#fff",borderRadius:16,padding:20,marginBottom:14,boxShadow:"0 4px 20px rgba(0,0,0,.08)",textAlign:"center"}}>
          <div style={{margin:"0 auto 12px",width:80,height:80,display:"inline-block"}}><Avatar c={c} size={80} /></div>
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
            <span style={{fontWeight:800}}>ยอดค้างรวมใหม่</span><span style={{fontWeight:800,fontSize:"1.2em",color:"#ef4444"}}>฿{fmt(c.totalDebt+debtTotal)}</span>
          </div>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={()=>setView("addDebt")} style={{flex:1,padding:"14px 0",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:14,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>← แก้ไข</button>
          <button onClick={confirmDebt} style={{flex:2,padding:"14px 0",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.05em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 16px rgba(26,122,74,.4)"}}>✅ ยืนยัน บันทึก</button>
        </div>
      </div>
    </div>
  );}

  // ── ADD DEBT ──────────────────────────────────
  if(view==="addDebt") return(
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f9fafb",paddingBottom:80}}>
      {newCustModal&&<NewCustModal initName={newCustModal} onSave={handleNewCust} onClose={()=>setNewCustModal(null)} />}
      <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>{setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:""});setView("dashboard");}} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
        <span style={{fontWeight:700,fontSize:"1.1em"}}>+ บันทึกหนี้ใหม่</span>
      </div>
      <div style={{padding:16}}>
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{fontWeight:700,marginBottom:10,color:"#1a3a2a"}}>① เลือกลูกค้า</div>
          <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="🔍 พิมพ์ชื่อลูกค้า..."
            style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}} />
          <div style={{maxHeight:200,overflowY:"auto",marginTop:8}}>
            {filtered.map(c=>(
              <div key={c.id} onClick={()=>{setNewDebt(d=>({...d,customer:c}));setSearchQ("");}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 8px",borderRadius:10,cursor:"pointer",background:newDebt.customer?.id===c.id?"#f0fdf4":"transparent",border:newDebt.customer?.id===c.id?"1.5px solid #22c55e":"1.5px solid transparent",marginBottom:4}}>
                <Avatar c={c} size={36} />
                <div style={{flex:1}}><div style={{fontWeight:600}}>{c.name}</div><div style={{fontSize:"0.82em",color:c.totalDebt>0?"#ef4444":"#6b7280"}}>{c.totalDebt>0?`ค้างอยู่ ฿${fmt(c.totalDebt)}`:"ไม่มียอดค้าง"}</div></div>
                {newDebt.customer?.id===c.id&&<span style={{color:"#22c55e",fontWeight:700}}>✓</span>}
              </div>
            ))}
            {searchQ&&!filtered.find(c=>c.name===searchQ)&&(
              <div onClick={()=>setNewCustModal(searchQ)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 8px",borderRadius:10,cursor:"pointer",background:"#eff6ff",border:"1.5px dashed #3b82f6",marginTop:4}}>
                <span style={{fontSize:20}}>➕</span><span style={{color:"#3b82f6",fontWeight:600}}>เพิ่ม "{searchQ}" เป็นลูกค้าใหม่ (พร้อมถ่ายรูป)</span>
              </div>
            )}
          </div>
        </div>
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{fontWeight:700,marginBottom:10,color:"#1a3a2a"}}>② รายการสินค้า</div>
          {newDebt.items.map((it,i)=>(
            <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
              <input value={it.name} onChange={e=>updItem(i,"name",e.target.value)} placeholder="ชื่อสินค้า"
                style={{flex:2,padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",outline:"none"}} />
              <input value={it.price} onChange={e=>updItem(i,"price",e.target.value)} placeholder="฿" type="number" inputMode="numeric"
                style={{flex:1,padding:"9px 10px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",outline:"none"}} />
              {newDebt.items.length>1&&<button onClick={()=>delItem(i)} style={{background:"#fee2e2",border:"none",borderRadius:8,padding:"8px 10px",cursor:"pointer",color:"#ef4444",fontWeight:700}}>🗑</button>}
            </div>
          ))}
          <button onClick={addItem} style={{width:"100%",padding:"10px 0",background:"#f0fdf4",border:"1.5px dashed #22c55e",borderRadius:10,color:"#15803d",fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"1em",marginTop:4}}>+ เพิ่มรายการ</button>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:14,padding:"10px 12px",background:"#f9fafb",borderRadius:10}}>
            <span style={{fontWeight:700}}>รวม</span><span style={{fontWeight:800,fontSize:"1.15em",color:"#1a3a2a"}}>฿{fmt(debtTotal)}</span>
          </div>
        </div>
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:20,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{fontWeight:700,marginBottom:10,color:"#1a3a2a"}}>📅 วันทวง (ถ้ามี)</div>
          <input type="date" value={newDebt.dueDate} onChange={e=>setNewDebt(d=>({...d,dueDate:e.target.value}))}
            style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}} />
        </div>
        <button onClick={()=>{if(newDebt.customer&&debtTotal>0)setView("confirm");}} disabled={!newDebt.customer||debtTotal<=0}
          style={{width:"100%",padding:"16px 0",background:newDebt.customer&&debtTotal>0?"#1a7a4a":"#d1d5db",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.1em",cursor:newDebt.customer&&debtTotal>0?"pointer":"not-allowed",fontFamily:"'Sarabun',sans-serif"}}>
          ถัดไป → ยืนยัน
        </button>
      </div>
    </div>
  );

  // ── LIST ──────────────────────────────────────
  if(view==="list") return(
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f9fafb",paddingBottom:80}}>
      <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
          <button onClick={()=>setView("dashboard")} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
          <span style={{fontWeight:700,fontSize:"1.1em",flex:1}}>ลูกหนี้ทั้งหมด ({filtered.length})</span>
          <button onClick={()=>loadAll(true)} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:10,padding:"6px 12px",color:"#fff",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",fontWeight:600}}>{refreshing?"⏳":"🔄"}</button>
        </div>
        <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="🔍 ค้นหาชื่อ..."
          style={{width:"100%",padding:"10px 14px",borderRadius:12,border:"none",background:"rgba(255,255,255,.15)",color:"#fff",fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}} />
      </div>
      <div style={{padding:16}}>
        {filtered.map(c=>(
          <div key={c.id} onClick={()=>{setSelCid(c.id);setView("customer");}} style={{background:"#fff",borderRadius:14,padding:14,marginBottom:10,boxShadow:"0 2px 8px rgba(0,0,0,.06)",display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}>
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

  // ── DASHBOARD ─────────────────────────────────
  return(
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f4f6f0",paddingBottom:90}}>
      <div style={{background:"linear-gradient(135deg,#1a3a2a 0%,#1a7a4a 100%)",color:"#fff",padding:"24px 16px 32px",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-20,right:-20,width:120,height:120,borderRadius:"50%",background:"rgba(255,255,255,.06)"}} />
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",position:"relative"}}>
          <div>
            <div style={{fontSize:"0.85em",opacity:.75,marginBottom:2}}>🏪 สมุดหนี้โชห่วย</div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              {lastSync&&<span style={{fontSize:"0.72em",opacity:.5}}>sync {lastSync}</span>}
              <span style={{width:8,height:8,borderRadius:"50%",background:syncDot==="ok"?"#22c55e":"#f59e0b",display:"inline-block"}} />
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button onClick={()=>loadAll(true)} disabled={refreshing}
              style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:10,padding:"7px 14px",color:"#fff",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",fontWeight:700,opacity:refreshing?.6:1}}>
              <span style={{display:"inline-block",animation:refreshing?"spin 1s linear infinite":"none"}}>🔄</span> {refreshing?"...":"Refresh"}
            </button>
            {/* Settings gear — only here */}
            <button onClick={goSettings} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:"50%",width:38,height:38,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}} title="ตั้งค่า (admin เท่านั้น)">⚙️</button>
          </div>
        </div>
        <div style={{marginTop:16}}>
          <div style={{fontSize:"0.85em",opacity:.75}}>ยอดค้างรวมทั้งหมด</div>
          <div style={{fontSize:"2.2em",fontWeight:800,letterSpacing:"-0.5px"}}>฿{fmt(totalDebt)}</div>
          <div style={{fontSize:"0.8em",opacity:.65}}>จาก {debtors.length} ราย · {APP_VERSION}</div>
        </div>
      </div>

      <div style={{padding:"16px 16px 0"}}>
        <div style={{fontSize:"0.78em",color:"#9ca3af",marginBottom:8}}>📌 ลากจัดลำดับ box ได้</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          {boxOrder.map(key=>{const b=BOXES[key];return(
            <div key={key} draggable onDragStart={()=>setDrag(key)} onDragOver={e=>onDragOver(e,key)} onDragEnd={()=>setDrag(null)} onClick={()=>{setSearchQ("");setView("list");}} style={{background:"#fff",borderRadius:16,padding:"14px 14px",cursor:"pointer",boxShadow:"0 2px 10px rgba(0,0,0,.07)",borderLeft:`4px solid ${b.color}`,opacity:drag===key?.5:1,userSelect:"none"}}>
              <div style={{fontSize:"1.2em",marginBottom:4}}>{b.icon}</div>
              <div style={{fontSize:"1.6em",fontWeight:800,color:b.color}}>{b.count}</div>
              <div style={{fontSize:"0.8em",color:"#6b7280",lineHeight:1.3}}>{b.label}</div>
            </div>
          );})}
        </div>
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:16,boxShadow:"0 2px 10px rgba(0,0,0,.07)"}}>
          <div style={{fontWeight:700,marginBottom:12,color:"#1a3a2a",display:"flex",justifyContent:"space-between"}}>
            <span>📋 ล่าสุด</span>
            <span onClick={()=>setView("list")} style={{fontSize:"0.8em",color:"#1a7a4a",cursor:"pointer",fontWeight:400}}>ดูทั้งหมด →</span>
          </div>
          {recentTx.length===0&&<div style={{color:"#9ca3af",textAlign:"center",padding:16,fontSize:"0.9em"}}>ยังไม่มีรายการ</div>}
          {recentTx.map(tx=>(
            <div key={tx.id} onClick={()=>{if(tx.customer){setSelCid(tx.customer.id);setView("customer");}}} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #f3f4f6",cursor:"pointer"}}>
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

      {/* Bottom Nav — 3 tabs only (no settings) */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:420,background:"#fff",borderTop:"1px solid #e5e7eb",display:"flex",zIndex:100}}>
        {[["dashboard","🏠","หน้าหลัก"],["list","👥","ลูกหนี้"],["addDebt","➕","บันทึก"]].map(([v,icon,label])=>(
          <button key={v} onClick={()=>{setSearchQ("");if(v==="addDebt"){setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:""});}setView(v);}} style={{flex:1,padding:"10px 0 8px",background:"none",border:"none",cursor:"pointer",color:view===v?"#1a7a4a":"#9ca3af",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:20}}>{icon}</span>
            <span style={{fontSize:"0.72em",fontFamily:"'Sarabun',sans-serif",fontWeight:view===v?700:400}}>{label}</span>
          </button>
        ))}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
