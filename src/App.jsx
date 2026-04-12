import { useState, useRef, useEffect, useCallback } from "react";

const fontLink = document.createElement("link");
fontLink.href = "https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap";
fontLink.rel = "stylesheet";
document.head.appendChild(fontLink);

// ══════════════════════════════════════════
//  PromptPay QR (EMV/TLV)
// ══════════════════════════════════════════
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
}
function tlv(tag, val) { return tag + String(val.length).padStart(2,"0") + val; }
function genQR(target, amount) {
  const raw   = target.replace(/[^0-9]/g,"");
  const proxy = raw.length===10 && raw.startsWith("0") ? "0066"+raw.slice(1) : raw;
  const mi    = tlv("00","A000000677010111") + tlv("01",proxy);
  const body  = tlv("00","01") + tlv("01",amount>0?"12":"11") + tlv("29",mi) + tlv("53","764") + (amount>0?tlv("54",Number(amount).toFixed(2)):"") + tlv("58","TH") + "6304";
  return body + crc16(body);
}
const qrUrl = (p,s=220) => `https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&data=${encodeURIComponent(p)}`;

// ══════════════════════════════════════════
//  GAS API calls
// ══════════════════════════════════════════
async function gasGet(url) {
  const res = await fetch(`${url}?action=getData`);
  return res.json();
}
async function gasPost(url, payload) {
  // GAS doPost doesn't return CORS headers → use no-cors, then re-fetch
  await fetch(url, {
    method: "POST", mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await new Promise(r => setTimeout(r, 1800));
  return gasGet(url);
}

// ══════════════════════════════════════════
//  PIN Lock
// ══════════════════════════════════════════
const CORRECT_PIN = "4207";
function PinScreen({ onSuccess, onCancel }) {
  const [digits, setDigits] = useState([]);
  const [shake,  setShake]  = useState(false);
  const [err,    setErr]    = useState(false);
  const press = d => {
    if (digits.length >= 4) return;
    const next = [...digits, d];
    setDigits(next);
    if (next.length === 4) {
      if (next.join("") === CORRECT_PIN) { setTimeout(onSuccess, 200); }
      else {
        setShake(true); setErr(true);
        setTimeout(() => { setDigits([]); setShake(false); setErr(false); }, 700);
      }
    }
  };
  const KEYS = ["1","2","3","4","5","6","7","8","9","","0","⌫"];
  return (
    <div style={{position:"fixed",inset:0,background:"linear-gradient(160deg,#1a3a2a,#0d1f17)",zIndex:1000,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Sarabun',sans-serif"}}>
      <div style={{fontSize:32,marginBottom:8}}>🔒</div>
      <div style={{color:"#fff",fontWeight:700,fontSize:"1.2em",marginBottom:4}}>รหัสผ่าน ตั้งค่า</div>
      <div style={{color:"rgba(255,255,255,.5)",fontSize:"0.85em",marginBottom:36}}>กรุณาใส่รหัส 4 หลัก</div>
      <div style={{display:"flex",gap:16,marginBottom:36,animation:shake?"shake .5s":"none"}}>
        {[0,1,2,3].map(i=>(
          <div key={i} style={{width:18,height:18,borderRadius:"50%",border:"2px solid rgba(255,255,255,.4)",background:digits.length>i?(err?"#ef4444":"#22c55e"):"transparent",transition:"background .15s"}} />
        ))}
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
//  Loading Overlay
// ══════════════════════════════════════════
function LoadingOverlay({ text="กำลังบันทึก..." }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:998,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Sarabun',sans-serif"}}>
      <div style={{background:"#fff",borderRadius:20,padding:"28px 36px",textAlign:"center",boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
        <div style={{fontSize:36,marginBottom:12}}>⏳</div>
        <div style={{fontWeight:700,color:"#1a3a2a",fontSize:"1.05em"}}>{text}</div>
        <div style={{color:"#9ca3af",fontSize:"0.82em",marginTop:6}}>กรุณารอสักครู่...</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
//  QR Modal
// ══════════════════════════════════════════
function QRModal({ customer, settings, onPaid, onClose }) {
  const [amount, setAmount] = useState(customer.totalDebt>0?String(customer.totalDebt):"");
  const [state,  setState]  = useState("idle");
  const handleConfirm = async () => {
    const amt = Number(amount)||customer.totalDebt;
    setState("sending");
    if (settings.lineToken && settings.gasUrl) {
      const msg = `\n💰 รับชำระแล้ว!\n👤 ${customer.name}\n💵 ฿${Number(amt).toLocaleString("th-TH")}\n📅 ${new Date().toLocaleDateString("th-TH")}` +
        (amt<customer.totalDebt?`\n⚠️ ยังค้างอยู่: ฿${(customer.totalDebt-amt).toLocaleString("th-TH")}`:`\n✅ ชำระครบ!`);
      await fetch(settings.gasUrl,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"notify",token:settings.lineToken,message:msg})});
    }
    await onPaid(amt);
    setState("done");
  };
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",zIndex:999,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:420,padding:24,paddingBottom:40}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div><div style={{fontWeight:800,fontSize:"1.15em",color:"#1a3a2a"}}>💳 QR รับชำระเงิน</div><div style={{color:"#6b7280",fontSize:"0.85em"}}>{customer.name} • ค้างอยู่ ฿{customer.totalDebt.toLocaleString("th-TH")}</div></div>
          <button onClick={onClose} style={{background:"#f3f4f6",border:"none",borderRadius:"50%",width:36,height:36,cursor:"pointer",fontSize:18}}>✕</button>
        </div>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:"0.85em",color:"#6b7280",marginBottom:6}}>จำนวนเงิน (บาท)</div>
          <div style={{display:"flex",gap:8}}>
            <input type="number" inputMode="numeric" value={amount} onChange={e=>setAmount(e.target.value)}
              style={{flex:1,padding:"12px 14px",border:"2px solid #1a7a4a",borderRadius:12,fontFamily:"'Sarabun',sans-serif",fontSize:"1.3em",fontWeight:700,color:"#1a3a2a",outline:"none"}} />
            <button onClick={()=>setAmount(String(customer.totalDebt))}
              style={{padding:"10px 12px",background:"#f0fdf4",border:"1.5px solid #22c55e",borderRadius:10,color:"#15803d",fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",lineHeight:1.4}}>
              เต็ม<br/>฿{customer.totalDebt.toLocaleString("th-TH")}
            </button>
          </div>
        </div>
        {!settings.promptpayId ? (
          <div style={{background:"#fff7ed",borderRadius:14,padding:16,textAlign:"center",marginBottom:14}}>
            <div style={{fontSize:28,marginBottom:6}}>⚠️</div>
            <div style={{fontWeight:700,color:"#92400e"}}>ยังไม่ได้ตั้งค่าเบอร์ PromptPay</div>
          </div>
        ) : (
          <div style={{textAlign:"center",marginBottom:14}}>
            <div style={{display:"inline-block",padding:10,background:"#fff",borderRadius:16,boxShadow:"0 4px 20px rgba(0,0,0,.12)",border:"3px solid #06c755"}}>
              <img src={qrUrl(genQR(settings.promptpayId,Number(amount)||0))} alt="QR" width={200} height={200} style={{display:"block",borderRadius:8}} />
            </div>
            <div style={{marginTop:8,fontWeight:700,fontSize:"1.1em",color:"#1a3a2a"}}>{Number(amount)>0?`฿${Number(amount).toLocaleString("th-TH")}`:"ไม่ระบุจำนวน"}</div>
          </div>
        )}
        {state==="done"&&<div style={{background:"#f0fdf4",borderRadius:10,padding:10,textAlign:"center",fontSize:"0.82em",color:"#15803d",marginBottom:12}}>✅ บันทึกเรียบร้อย!</div>}
        <button onClick={handleConfirm} disabled={state==="sending"||state==="done"}
          style={{width:"100%",padding:"14px 0",background:state==="sending"?"#9ca3af":state==="done"?"#22c55e":"#1a7a4a",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.05em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>
          {state==="sending"?"⏳ กำลังบันทึก...":state==="done"?"✅ บันทึกแล้ว":"✅ ยืนยันรับเงิน + แจ้ง LINE"}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════
const TODAY   = new Date().toISOString().slice(0,10);
const fmt     = n => Number(n).toLocaleString("th-TH");
const initial = name => name.trim().charAt(0);
const aColor  = name => ["#e07b39","#3b82f6","#22c55e","#a855f7","#ef4444","#f59e0b","#06b6d4"][name.charCodeAt(0)%7];

function loadPhotos() { try { return JSON.parse(localStorage.getItem("debtapp_photos")||"{}"); } catch { return {}; } }
function savePhoto(id, dataUrl) { const p=loadPhotos(); p[id]=dataUrl; localStorage.setItem("debtapp_photos",JSON.stringify(p)); }
function loadSettings() { try { return JSON.parse(localStorage.getItem("debtapp_settings")||"{}"); } catch { return {}; } }

// ══════════════════════════════════════════
//  Main App
// ══════════════════════════════════════════
export default function App() {
  const [customers,    setCustomers]    = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [photos,       setPhotos]       = useState(loadPhotos());
  const [initState,    setInitState]    = useState("loading"); // loading|no-url|error|ready
  const [loading,      setLoading]      = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);
  const [lastSync,     setLastSync]     = useState(null);
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
  const [settings,     setSettings]     = useState({gasUrl:"",promptpayId:"",lineToken:"",...loadSettings()});
  const photoRef = useRef();
  const FS = {sm:"13px",md:"15px",lg:"17px",xl:"20px"};
  const S  = {fontSize:FS[fontSize],fontFamily:"'Sarabun',sans-serif"};

  const applyData = (data) => {
    if (data.ok) {
      setCustomers(data.customers||[]);
      setTransactions(data.transactions||[]);
      setLastSync(new Date().toLocaleTimeString("th-TH"));
      setInitState("ready");
    } else { setInitState("error"); }
  };

  const loadData = useCallback(async (isRefresh=false) => {
    const url = loadSettings().gasUrl || settings.gasUrl;
    if (!url) { setInitState("no-url"); return; }
    isRefresh ? setRefreshing(true) : setInitState("loading");
    try { applyData(await gasGet(url)); } catch { setInitState("error"); }
    setRefreshing(false);
  }, [settings.gasUrl]);

  useEffect(() => { loadData(); }, []);

  const saveSettings = (s) => {
    setSettings(s);
    localStorage.setItem("debtapp_settings", JSON.stringify(s));
  };

  // ── Computed ──
  const withPhotos  = arr => arr.map(c=>({...c,photo:photos[c.id]||null}));
  const custs       = withPhotos(customers);
  const totalDebt   = custs.reduce((s,c)=>s+c.totalDebt,0);
  const debtors     = custs.filter(c=>c.totalDebt>0);
  const dueToday    = custs.filter(c=>c.dueDate===TODAY&&c.totalDebt>0);
  const todayCids   = [...new Set(transactions.filter(t=>t.date===TODAY).map(t=>t.customerId))];
  const todayCusts  = custs.filter(c=>todayCids.includes(c.id));
  const paidMonth   = custs.filter(c=>c.totalDebt===0&&c.phone);
  const recentTx    = [...transactions].sort((a,b)=>b.id-a.id).slice(0,5).map(t=>({...t,customer:custs.find(c=>c.id===t.customerId)}));
  const filtered    = custs.filter(c=>c.name.includes(searchQ));
  const BOXES = {
    due:  {label:"ครบกำหนดวันนี้", count:dueToday.length,    color:"#ef4444",icon:"🔴"},
    all:  {label:"ลูกหนี้ทั้งหมด", count:debtors.length,      color:"#f59e0b",icon:"🟡"},
    today:{label:"เพิ่งซื้อวันนี้",count:todayCusts.length,  color:"#3b82f6",icon:"🔵"},
    paid: {label:"จ่ายแล้วเดือนนี้",count:paidMonth.length,  color:"#22c55e",icon:"✅"},
  };

  const onDragStart = k=>setDragBox(k);
  const onDragOver  = (e,k)=>{ e.preventDefault();if(!dragBox||dragBox===k)return;const a=[...boxOrder],f=a.indexOf(dragBox),t=a.indexOf(k);a.splice(f,1);a.splice(t,0,dragBox);setBoxOrder(a); };
  const onDragEnd   = ()=>setDragBox(null);

  const debtTotal  = newDebt.items.reduce((s,it)=>s+(parseFloat(it.price)||0),0);
  const addItem    = ()=>setNewDebt(d=>({...d,items:[...d.items,{name:"",price:""}]}));
  const removeItem = i=>setNewDebt(d=>({...d,items:d.items.filter((_,idx)=>idx!==i)}));
  const updItem    = (i,f,v)=>setNewDebt(d=>{const it=[...d.items];it[i]={...it[i],[f]:v};return{...d,items:it};});

  const confirmDebt = async () => {
    if(!newDebt.customer||debtTotal<=0)return;
    setLoading(true);
    const items = newDebt.items.filter(it=>it.name||it.price).map(it=>({name:it.name||"รายการ",price:parseFloat(it.price)||0}));
    const data  = await gasPost(settings.gasUrl,{action:"addDebt",customerId:newDebt.customer.id,date:TODAY,items,total:debtTotal,dueDate:newDebt.dueDate||""});
    applyData(data);
    setLoading(false);
    setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:""});
    setView("dashboard");
  };

  const handleMarkPaid = async (cid, amount) => {
    const c = custs.find(x=>x.id===cid);
    const fullPay = amount>=(c?.totalDebt||0);
    setLoading(true);
    const data = await gasPost(settings.gasUrl,{action:"markPaid",customerId:cid,amount,fullPay});
    applyData(data);
    setLoading(false);
    setShowQR(false);
  };

  const addNewCust = async name => {
    const data = await gasPost(settings.gasUrl,{action:"addCustomer",name,phone:""});
    applyData(data);
    return (data.customers||[]).find(c=>c.name===name)||{id:Date.now(),name,phone:"",totalDebt:0,dueDate:null};
  };

  const handlePhoto = (cid,e) => {
    const f=e.target.files[0];if(!f)return;
    const r=new FileReader();
    r.onload=ev=>{ savePhoto(cid,ev.target.result); setPhotos(loadPhotos()); };
    r.readAsDataURL(f);
  };

  const goToSettings = () => { if(pinUnlocked){setView("settings");}else{setShowPin(true);} };

  // ══ No GAS URL ══
  if(initState==="no-url") return (
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"linear-gradient(160deg,#1a3a2a,#0d1f17)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,textAlign:"center"}}>
      <div style={{fontSize:52,marginBottom:16}}>🏪</div>
      <div style={{color:"#fff",fontWeight:800,fontSize:"1.4em",marginBottom:8}}>สมุดหนี้โชห่วย</div>
      <div style={{color:"rgba(255,255,255,.6)",fontSize:"0.9em",marginBottom:32,lineHeight:1.6}}>ยังไม่ได้ตั้งค่า GAS URL<br/>กรุณาใส่ URL เพื่อเริ่มใช้งาน</div>
      <div style={{background:"rgba(255,255,255,.08)",borderRadius:16,padding:20,width:"100%",boxSizing:"border-box"}}>
        <div style={{color:"rgba(255,255,255,.7)",fontSize:"0.82em",marginBottom:8,textAlign:"left"}}>Google Apps Script URL</div>
        <input value={settings.gasUrl} onChange={e=>setSettings(s=>({...s,gasUrl:e.target.value}))}
          placeholder="https://script.google.com/macros/s/..."
          style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid rgba(255,255,255,.2)",background:"rgba(255,255,255,.1)",color:"#fff",fontFamily:"'Sarabun',sans-serif",fontSize:"0.85em",boxSizing:"border-box",outline:"none"}} />
        <button onClick={()=>{ saveSettings(settings); loadData(); }} style={{width:"100%",marginTop:12,padding:"14px 0",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:12,fontWeight:800,fontSize:"1em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>
          เริ่มใช้งาน →
        </button>
      </div>
    </div>
  );

  if(initState==="loading") return (
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f4f6f0",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <div style={{fontSize:48,marginBottom:16,animation:"spin 2s linear infinite"}}>🔄</div>
      <div style={{fontWeight:700,color:"#1a3a2a",fontSize:"1.1em"}}>กำลังโหลดข้อมูล...</div>
      <div style={{color:"#9ca3af",fontSize:"0.85em",marginTop:8}}>ดึงข้อมูลจาก Google Sheets</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if(initState==="error") return (
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f4f6f0",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:16}}>⚠️</div>
      <div style={{fontWeight:700,color:"#ef4444",fontSize:"1.1em",marginBottom:8}}>โหลดข้อมูลไม่สำเร็จ</div>
      <div style={{color:"#6b7280",fontSize:"0.85em",marginBottom:24,lineHeight:1.6}}>ตรวจสอบ GAS URL และ Spreadsheet ID<br/>ใน Code.gs</div>
      <button onClick={()=>loadData()} style={{padding:"12px 28px",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:12,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"1em",marginBottom:10}}>🔄 ลองใหม่</button>
      <button onClick={()=>{ saveSettings({...settings,gasUrl:""}); setInitState("no-url"); }} style={{padding:"10px 20px",background:"none",color:"#6b7280",border:"1.5px solid #e5e7eb",borderRadius:12,fontWeight:500,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.9em"}}>เปลี่ยน URL</button>
    </div>
  );

  if(showPin) return <PinScreen onSuccess={()=>{setShowPin(false);setPinUnlocked(true);setView("settings");}} onCancel={()=>setShowPin(false)} />;

  // ══ SETTINGS ══
  if(view==="settings") return (
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f9fafb",paddingBottom:80}}>
      {loading&&<LoadingOverlay />}
      <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>{setPinUnlocked(false);setView("dashboard");}} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
        <span style={{fontWeight:700,fontSize:"1.1em"}}>⚙️ ตั้งค่า</span>
      </div>
      <div style={{padding:16}}>
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{fontWeight:700,marginBottom:4,color:"#1a3a2a"}}>🔗 Google Apps Script URL</div>
          <div style={{color:"#6b7280",fontSize:"0.82em",marginBottom:10}}>URL เดียวสำหรับทุกอย่าง (database + LINE notify)</div>
          <input value={settings.gasUrl} onChange={e=>setSettings(s=>({...s,gasUrl:e.target.value}))}
            placeholder="https://script.google.com/macros/s/..."
            style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",boxSizing:"border-box",outline:"none"}} />
        </div>
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
            <span style={{background:"#004f9f",color:"#fff",borderRadius:6,padding:"2px 10px",fontSize:"0.8em",fontWeight:700}}>PromptPay</span>
            <span style={{fontWeight:700,color:"#1a3a2a"}}>เบอร์รับเงิน</span>
          </div>
          <input value={settings.promptpayId} onChange={e=>setSettings(s=>({...s,promptpayId:e.target.value}))}
            placeholder="0812345678" inputMode="numeric"
            style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}} />
          {settings.promptpayId&&(
            <div style={{marginTop:12,textAlign:"center"}}>
              <img src={qrUrl(genQR(settings.promptpayId,0),130)} alt="preview" style={{borderRadius:10,border:"2px solid #e5e7eb"}} />
            </div>
          )}
        </div>
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
            <span style={{background:"#06c755",color:"#fff",borderRadius:6,padding:"2px 10px",fontSize:"0.8em",fontWeight:700}}>LINE</span>
            <span style={{fontWeight:700,color:"#1a3a2a"}}>Notify Token</span>
          </div>
          <div style={{color:"#6b7280",fontSize:"0.82em",marginBottom:8}}>notify-bot.line.me → สร้าง Token</div>
          <input value={settings.lineToken} onChange={e=>setSettings(s=>({...s,lineToken:e.target.value}))}
            placeholder="วาง Token ที่นี่..."
            style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"0.88em",boxSizing:"border-box",outline:"none"}} />
        </div>
        <button onClick={()=>saveSettings(settings)} style={{width:"100%",padding:"14px 0",background:"#1a3a2a",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",marginBottom:14,boxShadow:"0 4px 16px rgba(26,58,42,.3)"}}>
          💾 บันทึกการตั้งค่า
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
  );

  // ══ CUSTOMER ══
  if(view==="customer"&&selectedCid) {
    const c=custs.find(x=>x.id===selectedCid);
    if(!c){setView("list");return null;}
    const txList=[...transactions].filter(t=>t.customerId===c.id).sort((a,b)=>b.id-a.id);
    return (
      <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f9fafb",paddingBottom:80}}>
        {loading&&<LoadingOverlay />}
        {showQR&&<QRModal customer={c} settings={settings} onPaid={async amt=>{await handleMarkPaid(c.id,amt);}} onClose={()=>setShowQR(false)} />}
        <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 24px"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
            <button onClick={()=>setView("list")} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
            <span style={{fontWeight:700,fontSize:"1.1em",flex:1}}>ประวัติลูกค้า</span>
            <button onClick={()=>loadData(true)} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:10,padding:"6px 12px",color:"#fff",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",fontWeight:600}}>{refreshing?"⏳":"🔄"}</button>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{position:"relative"}}>
              <div onClick={()=>photoRef.current?.click()} style={{width:64,height:64,borderRadius:"50%",overflow:"hidden",background:aColor(c.name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,color:"#fff",fontWeight:700,border:"3px solid rgba(255,255,255,.3)",cursor:"pointer"}}>
                {c.photo?<img src={c.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} />:initial(c.name)}
              </div>
              <input ref={photoRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handlePhoto(c.id,e)} />
              <div onClick={()=>photoRef.current?.click()} style={{position:"absolute",bottom:0,right:0,background:"#fff",borderRadius:"50%",width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,cursor:"pointer"}}>📷</div>
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
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <span style={{color:"#6b7280",fontSize:"0.85em"}}>📅 {tx.date}</span>
                <span style={{fontWeight:700,color:tx.paid?"#22c55e":"#ef4444"}}>{tx.paid?"✅ จ่ายแล้ว":`฿${fmt(tx.total)}`}</span>
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

  // ══ CONFIRM ══
  if(view==="confirm"){const c=newDebt.customer;return(
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f9fafb",paddingBottom:80}}>
      {loading&&<LoadingOverlay />}
      <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>setView("addDebt")} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
        <span style={{fontWeight:700,fontSize:"1.1em"}}>✅ ยืนยันก่อนบันทึก</span>
      </div>
      <div style={{padding:16}}>
        <div style={{background:"#fff",borderRadius:16,padding:20,marginBottom:14,boxShadow:"0 4px 20px rgba(0,0,0,.08)",textAlign:"center"}}>
          <div style={{width:80,height:80,borderRadius:"50%",overflow:"hidden",background:aColor(c.name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,color:"#fff",fontWeight:700,margin:"0 auto 12px",border:`4px solid ${aColor(c.name)}33`}}>
            {c.photo?<img src={c.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} />:initial(c.name)}
          </div>
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
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:20,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",color:"#6b7280"}}><span>ยอดค้างเดิม</span><span>฿{fmt(c.totalDebt)}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",color:"#6b7280"}}><span>เพิ่มวันนี้</span><span style={{color:"#ef4444"}}>+฿{fmt(debtTotal)}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0 0",borderTop:"2px dashed #e5e7eb",marginTop:6}}>
            <span style={{fontWeight:800,fontSize:"1.05em"}}>ยอดค้างรวมใหม่</span><span style={{fontWeight:800,fontSize:"1.2em",color:"#ef4444"}}>฿{fmt(c.totalDebt+debtTotal)}</span>
          </div>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={()=>setView("addDebt")} style={{flex:1,padding:"14px 0",background:"#f3f4f6",color:"#374151",border:"none",borderRadius:14,fontWeight:700,fontSize:"1em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>← แก้ไข</button>
          <button onClick={confirmDebt} style={{flex:2,padding:"14px 0",background:"#1a7a4a",color:"#fff",border:"none",borderRadius:14,fontWeight:800,fontSize:"1.05em",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:"0 4px 16px rgba(26,122,74,.4)"}}>✅ ยืนยัน บันทึก</button>
        </div>
      </div>
    </div>
  );}

  // ══ ADD DEBT ══
  if(view==="addDebt") return (
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f9fafb",paddingBottom:80}}>
      <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>{setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:""});setView("dashboard");}} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
        <span style={{fontWeight:700,fontSize:"1.1em"}}>+ บันทึกหนี้ใหม่</span>
      </div>
      <div style={{padding:16}}>
        <div style={{background:"#fff",borderRadius:16,padding:16,marginBottom:14,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
          <div style={{fontWeight:700,marginBottom:10,color:"#1a3a2a"}}>① เลือกลูกค้า</div>
          <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="🔍 พิมพ์ชื่อลูกค้า..." style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}} />
          <div style={{maxHeight:180,overflowY:"auto",marginTop:8}}>
            {filtered.map(c=>(
              <div key={c.id} onClick={()=>{setNewDebt(d=>({...d,customer:c}));setSearchQ("");}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 8px",borderRadius:10,cursor:"pointer",background:newDebt.customer?.id===c.id?"#f0fdf4":"transparent",border:newDebt.customer?.id===c.id?"1.5px solid #22c55e":"1.5px solid transparent",marginBottom:4}}>
                <div style={{width:36,height:36,borderRadius:"50%",background:aColor(c.name),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:"1em",flexShrink:0,overflow:"hidden"}}>
                  {c.photo?<img src={c.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} />:initial(c.name)}
                </div>
                <div style={{flex:1}}><div style={{fontWeight:600}}>{c.name}</div><div style={{fontSize:"0.82em",color:c.totalDebt>0?"#ef4444":"#6b7280"}}>{c.totalDebt>0?`ค้างอยู่ ฿${fmt(c.totalDebt)}`:"ไม่มียอดค้าง"}</div></div>
                {newDebt.customer?.id===c.id&&<span style={{color:"#22c55e",fontWeight:700}}>✓</span>}
              </div>
            ))}
            {searchQ&&!filtered.find(c=>c.name===searchQ)&&(
              <div onClick={async()=>{setLoading(true);const nc=await addNewCust(searchQ);setNewDebt(d=>({...d,customer:nc}));setSearchQ("");setLoading(false);}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 8px",borderRadius:10,cursor:"pointer",background:"#eff6ff",border:"1.5px dashed #3b82f6",marginTop:4}}>
                <span style={{fontSize:20}}>➕</span><span style={{color:"#3b82f6",fontWeight:600}}>เพิ่ม "{searchQ}" เป็นลูกค้าใหม่</span>
              </div>
            )}
          </div>
        </div>
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
            <span style={{fontWeight:700}}>รวม</span><span style={{fontWeight:800,fontSize:"1.15em",color:"#1a3a2a"}}>฿{fmt(debtTotal)}</span>
          </div>
        </div>
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

  // ══ LIST ══
  if(view==="list") return (
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f9fafb",paddingBottom:80}}>
      <div style={{background:"#1a3a2a",color:"#fff",padding:"20px 16px 16px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
          <button onClick={()=>setView("dashboard")} style={{background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer"}}>←</button>
          <span style={{fontWeight:700,fontSize:"1.1em",flex:1}}>ลูกหนี้ทั้งหมด</span>
          <button onClick={()=>loadData(true)} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:10,padding:"6px 12px",color:"#fff",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",fontWeight:600}}>
            {refreshing?"⏳":"🔄"} Refresh
          </button>
        </div>
        <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="🔍 ค้นหาชื่อ..." style={{width:"100%",padding:"10px 14px",borderRadius:12,border:"none",background:"rgba(255,255,255,.15)",color:"#fff",fontFamily:"'Sarabun',sans-serif",fontSize:"1em",boxSizing:"border-box",outline:"none"}} />
      </div>
      <div style={{padding:16}}>
        {filtered.map(c=>(
          <div key={c.id} onClick={()=>{setSelectedCid(c.id);setView("customer");}} style={{background:"#fff",borderRadius:14,padding:14,marginBottom:10,boxShadow:"0 2px 8px rgba(0,0,0,.06)",display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}>
            <div style={{width:48,height:48,borderRadius:"50%",background:aColor(c.name),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:"1.2em",flexShrink:0,overflow:"hidden",border:`3px solid ${aColor(c.name)}55`}}>
              {c.photo?<img src={c.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} />:initial(c.name)}
            </div>
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

  // ══ DASHBOARD ══
  return (
    <div style={{...S,maxWidth:420,margin:"0 auto",minHeight:"100vh",background:"#f4f6f0",paddingBottom:90}}>
      {loading&&<LoadingOverlay />}
      <div style={{background:"linear-gradient(135deg,#1a3a2a 0%,#1a7a4a 100%)",color:"#fff",padding:"24px 16px 32px",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-20,right:-20,width:120,height:120,borderRadius:"50%",background:"rgba(255,255,255,.06)"}} />
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",position:"relative"}}>
          <div>
            <div style={{fontSize:"0.85em",opacity:.75,marginBottom:2}}>🏪 สมุดหนี้โชห่วย</div>
            {lastSync&&<div style={{fontSize:"0.72em",opacity:.5}}>🔄 sync {lastSync}</div>}
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button onClick={()=>loadData(true)} disabled={refreshing}
              style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:10,padding:"7px 14px",color:"#fff",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:"0.82em",fontWeight:700,opacity:refreshing?.6:1,transition:"opacity .2s"}}>
              <span style={{display:"inline-block",animation:refreshing?"spin 1s linear infinite":"none"}}>🔄</span> {refreshing?"กำลัง...":"Refresh"}
            </button>
            <button onClick={goToSettings} style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:"50%",width:38,height:38,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>⚙️</button>
          </div>
        </div>
        <div style={{marginTop:16,position:"relative"}}>
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
              <div style={{width:36,height:36,borderRadius:"50%",background:tx.customer?aColor(tx.customer.name):"#e5e7eb",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,flexShrink:0,overflow:"hidden"}}>
                {tx.customer?.photo?<img src={tx.customer.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} />:(tx.customer?initial(tx.customer.name):"?")}
              </div>
              <div style={{flex:1}}><div style={{fontWeight:600}}>{tx.customer?.name||"?"}</div><div style={{fontSize:"0.8em",color:"#9ca3af"}}>{tx.date}</div></div>
              <div style={{fontWeight:700,color:"#ef4444"}}>฿{fmt(tx.total)}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{position:"fixed",bottom:72,right:"max(16px, calc(50% - 194px))"}}>
        <button onClick={()=>{setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:""});setSearchQ("");setView("addDebt");}} style={{width:60,height:60,borderRadius:"50%",background:"#1a7a4a",border:"none",color:"#fff",fontSize:28,cursor:"pointer",boxShadow:"0 6px 24px rgba(26,122,74,.5)",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
      </div>
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:420,background:"#fff",borderTop:"1px solid #e5e7eb",display:"flex",zIndex:100}}>
        {[["dashboard","🏠","หน้าหลัก"],["list","👥","ลูกหนี้"],["addDebt","➕","บันทึก"],["settings","⚙️","ตั้งค่า"]].map(([v,icon,label])=>(
          <button key={v} onClick={()=>{setSearchQ("");if(v==="addDebt")setNewDebt({customer:null,items:[{name:"",price:""}],dueDate:""});if(v==="settings")goToSettings();else setView(v);}} style={{flex:1,padding:"10px 0 8px",background:"none",border:"none",cursor:"pointer",color:view===v?"#1a7a4a":"#9ca3af",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:20}}>{icon}</span>
            <span style={{fontSize:"0.72em",fontFamily:"'Sarabun',sans-serif",fontWeight:view===v?700:400}}>{label}</span>
          </button>
        ))}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
