import { useState, useRef, useEffect, useCallback } from "react";

// ══ Config ══════════════════════════════════════
const APP_VERSION = "v2.1";
const GAS_URL = "https://script.google.com/macros/s/AKfycbxrCd34oeytvV3nogkJjJRVLWObLCUpWmE9yR9i2oHdFo-SYOqbU-T9tnzKrFA-5gcM/exec";
const LINE_REGISTER_PAGE = GAS_URL + "?action=lineIdPage";
const MAIN_ADMIN   = "thitiphankk@gmail.com";
const CORRECT_PIN  = "4207";
const DEFAULT_QR   = "0871407251"; // default PromptPay

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

// Email builders
function buildDebtEmail(c,items,total,due,interest){
  return{
    subject:`📝 บันทึกหนี้ — ${c.name} ฿${fmt(total)}`,
    htmlBody:`<h3 style="color:#1a3a2a;">📝 บันทึกหนี้ใหม่</h3>
      <p><b>ลูกค้า:</b> ${c.name} | <b>วันที่:</b> ${TODAY}${due?` | <b>ทวง:</b> ${due}`:""}</p>
      <ul>${items.map(i=>`<li>${i.name} — ฿${fmt(i.price)}</li>`).join("")}</ul>
      <p><b>รวม: ฿${fmt(total)}</b>${interest?` (ดอกเบี้ย ${interest}%/เดือน)`:""}</p>
      <p style="color:#ef4444;"><b>ยอดค้างรวม: ฿${fmt((c.totalDebt||0)+total)}</b></p>`,
    body:`บันทึกหนี้ ${c.name} ฿${fmt(total)}`
  };
}
function buildPaidEmail(c,amt){
  const r=Math.max(0,(c.totalDebt||0)-amt);
  return{
    subject:`💰 รับชำระ — ${c.name} ฿${fmt(amt)}`,
    htmlBody:`<h3 style="color:#15803d;">💰 รับชำระแล้ว</h3>
      <p><b>ลูกค้า:</b> ${c.name}</p>
      <p><b>จำนวน: ฿${fmt(amt)}</b></p>
      <p style="color:${r>0?"#ef4444":"#15803d"};"><b>ยอดคงเหลือ: ${r>0?"฿"+fmt(r):"✅ ชำระครบ!"}</b></p>`,
    body:`รับชำระ ${c.name} ฿${fmt(amt)}`
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
      gasNotifyLine({channelToken:settings.channelToken,uids:settings.adminLineUids,message:`💰 รับชำระแล้ว\nลูกค้า: ${c.name}\nจำนวน: ฿${fmt(a)}`});
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

// ══ Support Page ══════════════════════════════════
function SupportPage({settings,onClose}){
  const [name,setName]=useState("");
  const [state,setState]=useState("idle");
  const amount=settings?.supportAmount||399;
  const ppId=settings?.supportPromptpay||settings?.promptpayId||DEFAULT_QR;
  const payload=genQR(ppId,amount);
  const imgUrl=qrUrl(payload);

  const submit=async()=>{
    if(!name.trim())return;
    setState("sending");
    await gasPostRead({action:"supportPayment",name,amount});
    setState("done");
  };
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:997,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:20,padding:24,width:"100%",maxWidth:400,boxShadow:"0 20px 60px rgba(0,0,0,.3)",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{textAlign:"center",marginBottom:16}}>
          <div style={{fontSize:40,marginBottom:8}}>☕</div>
          <div style={{fontWeight:800,fontSize:"1.2em",color:"#1a3a2a"}}>สนับสนุนค่ากาแฟ</div>
          <div style={{color:"#6b7280",fontSize:"0.85em",marginTop:4}}>เพื่อพัฒนาระบบสมุดหนี้โชห่วยต่อไป</div>
        </div>
        <div style={{textAlign:"center",marginBottom:16}}>
          <div style={{fontWeight:800,fontSize:"2em",color:"#1a3a2a"}}>฿{fmt(amount)}</div>
          {imgUrl&&(
            <div style={{display:"inline-block",padding:10,background:"#fff",borderRadius:16,boxShadow:"0 4px 20px rgba(0,0,0,.12)",border:"3px solid #f59e0b",marginTop:10}}>
              <img src={imgUrl} alt="QR" width={180} height={180} style={{display:"block",borderRadius:8}}/>
            </div>
          )}
          <div style={{fontSize:"0.8em",color:"#6b7280",marginTop:6}}>PromptPay: {ppId}</div>
        </div>
        {state==="done"?(
          <div style={{background:"#f0fdf4",borderRadius:14,padding:16,textAlign:"center"}}>
            <div style={{fontSize:32,marginBottom:8}}>✅</div>
            <div style={{fontWeight:700,color:"#15803d"}}>ขอบคุณมากครับ!</div>
            <div style={{color:"#6b7280",fontSize:"0.85em"}}>Admin จะตรวจสอบและยืนยันการชำระภายใน 24 ชม.</div>
          </div>
        ):(
          <>
            <div style={{marginBottom:12}}>
              <div style={{fontSize:"0.85em",color:"#6b7280",marginBottom:6}}>ชื่อ-สกุล (เพื่อยืนยัน)</div>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="ชื่อของคุณ"
                style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}}/>
            </div>
            <button onClick={submit} disabled={!name.trim()||state==="sending"}
              style={{width:"100%",padding:"13px 0",background:name.trim()?"#f59e0b":"#e5e7eb",color:name.trim()?"#fff":"#9ca3af",border:"none",borderRadius:12,fontWeight:800,fontSize:"1em",cursor:name.trim()?"pointer":"default",fontFamily:"'Sarabun',sans-serif",marginBottom:10}}>
              {state==="sending"?"⏳ กำลังส่ง...":"📤 แจ้งชำระเงินแล้ว"}
            </button>
          </>
        )}
        <button onClick={onClose} style={{width:"100%",padding:"10px 0",background:"#f3f4f6",border:"none",borderRadius:12,fontWeight:600,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",color:"#374151",fontSize:"0.9em"}}>ปิด</button>
      </div>
    </div>
  );
}

// ══ Main App ══════════════════════════════════════
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
  const [versionCode,  setVersionCode]  = useState("");
  const [calDayInfo,   setCalDayInfo]   = useState(null);
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
      gasNotifyLine({channelToken:settings.channelToken,uids:settings.adminLineUids,message:`📝 บันทึกหนี้ใหม่\n👤 ${ec.name}\n💵 ฿${fmt(debtTotal)}\n📅 ${TODAY}${due?"\n⏰ ทวง "+due:""}`});
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
            <div style={{background:"#f0fdf4",borderRadius:10,padding:10,marginBottom:12,fontSize:"0.82em",color:"#15803d",lineHeight:1.6}}>
              ✅ ใช้ <b>Winner Z9 i-App</b> (Messaging API) ในการแจ้งเตือน<br/>
              ต้องใส่ Channel Access Token จาก LINE Developers Console
            </div>
            <div style={{marginBottom:10}}>
              <div style={{fontSize:"0.82em",color:"#6b7280",marginBottom:4}}>Channel Access Token</div>
              <input value={draft.channelToken||""} onChange={e=>setDraft(s=>({...s,channelToken:e.target.value}))}
                placeholder="วาง Long-lived Channel Access Token..."
                style={{width:"100%",padding:"9px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",boxSizing:"border-box",outline:"none"}}/>
            </div>
            <button onClick={()=>window.open(LINE_REGISTER_PAGE,"_blank")}
              style={{width:"100%",padding:"10px 0",background:"#06c755",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em",marginBottom:8}}>
              📱 หน้าสมัครรับแจ้งเตือน LINE (ส่งให้ผู้ช่วย)
            </button>
            <div style={{fontSize:"0.8em",color:"#6b7280",background:"#eff6ff",borderRadius:8,padding:"8px 12px",lineHeight:1.6}}>
              <b>วิธีตั้งค่า LINE OA:</b><br/>
              1. ไปที่ developers.line.biz → Winner Z9 i-App<br/>
              2. Messaging API → Channel access token → Issue<br/>
              3. Webhook URL → วาง GAS URL นี้:<br/>
              <code style={{fontSize:"0.85em",wordBreak:"break-all",color:"#1e40af"}}>{GAS_URL}</code>
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
              <div><div style={{fontWeight:700,fontSize:"1.2em"}}>{c.name}</div><div style={{opacity:.8,fontSize:"0.9em"}}>📞 {c.phone||"ไม่มีเบอร์"}</div></div>
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
  if(view==="list") return(
    <div style={{...containerStyle}}>
      {isDesktop&&<SidebarNav/>}
      <div style={{flex:1,paddingBottom:isDesktop?0:80}}>
        {toast&&<Toast msg={toast.msg} icon={toast.icon}/>}
        <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px",position:"sticky",top:0,zIndex:10}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
            {!isDesktop&&<button onClick={()=>setView("dashboard")} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>}
            <span style={{fontWeight:700,fontSize:"1.1em",flex:1}}>ลูกหนี้ทั้งหมด ({customers.length} คน)</span>
            <button onClick={()=>loadAll(true)} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:10,padding:"6px 12px",color:"#fff",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",fontWeight:600}}>{refreshing?"⏳":"🔄"} Refresh</button>
          </div>
          <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="🔍 ค้นหาชื่อ..." style={{width:"100%",padding:"10px 14px",borderRadius:12,border:"none",background:"rgba(255,255,255,.15)",color:"#fff",fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}}/>
        </div>
        <div style={{padding:16,display:isDesktop?"grid":"block",gridTemplateColumns:isDesktop?"1fr 1fr":undefined,gap:isDesktop?12:undefined}}>
          {filtered.map(c=>(
            <div key={c.id} onClick={()=>{setSelectedCid(c.id);setView("customer");}} style={{background:"#fff",borderRadius:14,padding:14,marginBottom:isDesktop?0:10,boxShadow:"0 2px 8px rgba(0,0,0,.06)",display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}>
              <Avatar c={c} size={48}/>
              <div style={{flex:1}}><div style={{fontWeight:700}}>{c.name}</div><div style={{fontSize:"0.85em",color:"#6b7280"}}>{c.phone||"ไม่มีเบอร์"}</div></div>
              <div style={{textAlign:"right"}}>
                <div style={{fontWeight:800,color:c.totalDebt>0?"#ef4444":"#22c55e"}}>฿{fmt(c.totalDebt)}</div>
                {c.dueDate&&c.totalDebt>0&&<div style={{fontSize:"0.78em",color:c.dueDate<=TODAY?"#ef4444":"#6b7280"}}>{thDate(c.dueDate)}</div>}
              </div>
            </div>
          ))}
          {filtered.length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:40,gridColumn:"1/-1"}}>ไม่พบลูกค้า</div>}
        </div>
        {!isDesktop&&(
          <div style={{position:"fixed",bottom:70,left:"50%",transform:"translateX(-50%)",width:"calc(100% - 32px)",maxWidth:388}}>
            <button onClick={()=>{setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:"",interestRate:""});setView("addDebt");}} style={{width:"100%",padding:"14px 0",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.05em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 20px rgba(26,122,74,.4)"}}>+ บันทึกหนี้ใหม่</button>
          </div>
        )}
      </div>
      {!isDesktop&&<BottomNav/>}
    </div>
  );

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
        {showSupport&&<SupportPage settings={settings} onClose={()=>setShowSupport(false)}/>}
        {showQR&&<QRModal c={customers[0]||{name:"?",totalDebt:0,id:0}} settings={settings} onPaid={()=>{}} onClose={()=>setShowQR(false)}/>}
        <div style={{background:"linear-gradient(135deg,#1a3a2a 0%,#1a7a4a 100%)",color:"#fff",padding:"24px 16px 32px",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:-20,right:-20,width:120,height:120,borderRadius:"50%",background:"rgba(255,255,255,.06)"}}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",position:"relative"}}>
            <div>
              <div style={{fontSize:"0.85em",opacity:.75,marginBottom:2}}>🏪 สมุดหนี้โชห่วย</div>
              <div style={{fontSize:"0.7em",opacity:.45}}>{lastSync?`🌐 ${lastSync}`:""} · {APP_VERSION}{settings.isFullVersion?" 🎉":""}</div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
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
