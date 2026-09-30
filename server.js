const express=require('express');
const path=require('path');
const crypto=require('crypto');
const fs=require('fs');
const Database=require('better-sqlite3');

const app=express();
app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'public')));
const dataDir=process.env.DB_DIR||path.join(__dirname,'data');
fs.mkdirSync(dataDir,{recursive:true});
const db=new Database(process.env.DB_PATH||path.join(dataDir,'clienteai.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS professionals(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER UNIQUE,name TEXT,email TEXT,profession TEXT,city TEXT,description TEXT,price TEXT,availability TEXT,specialties TEXT,modality TEXT,experience TEXT,capacity TEXT,profile_json TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY AUTOINCREMENT,professional_id INTEGER,name TEXT,email TEXT,need TEXT,status TEXT DEFAULT 'new',intent TEXT,interest TEXT,service TEXT,next_action TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS conversations(id INTEGER PRIMARY KEY AUTOINCREMENT,professional_id INTEGER,lead_id INTEGER,message TEXT,reply TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

const hash=(p,s=crypto.randomBytes(16).toString('hex'))=>({salt:s,hash:crypto.scryptSync(p,s,64).toString('hex')});
const verify=(p,stored)=>{try{const [salt,h]=stored.split(':');return crypto.timingSafeEqual(Buffer.from(h,'hex'),crypto.scryptSync(p,salt,64));}catch{return false}};
function auth(req,res,next){const t=(req.headers.authorization||'').replace('Bearer ','');if(!t)return res.status(401).json({error:'No autenticado'});const s=db.prepare('SELECT user_id FROM sessions WHERE token=?').get(t);if(!s)return res.status(401).json({error:'Sesión inválida'});req.user=db.prepare('SELECT id,name,email FROM users WHERE id=?').get(s.user_id);if(!req.user)return res.status(401).json({error:'Usuario no existe'});next()}
function parseJson(text,fallback){try{return JSON.parse(text)}catch{const m=String(text||'').match(/\{[\s\S]*\}/);try{return m?JSON.parse(m[0]):fallback}catch{return fallback}}}
async function aiResponse(instructions,input){
  const key=process.env.OPENAI_API_KEY;if(!key)return null;
  const model=process.env.OPENAI_MODEL||'gpt-5.6-luna';
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify({model,instructions,input})});
  if(!r.ok) throw new Error(`OpenAI HTTP ${r.status}`);
  const data=await r.json();return data.output_text||'';
}
function professionalContext(p){return `Nombre: ${p.name}\nProfesión: ${p.profession}\nCiudad: ${p.city||'No indicada'}\nServicios: ${p.description||'No indicados'}\nEspecialidades: ${p.specialties||'No indicadas'}\nPrecio: ${p.price||'No indicado'}\nDisponibilidad: ${p.availability||'No indicada'}\nModalidad: ${p.modality||'No indicada'}\nExperiencia: ${p.experience||'No indicada'}\nCapacidad: ${p.capacity||'No indicada'}`}
function saveProfessional(userId,email,b){
 const p={name:b.name||'',profession:b.profession||'Otro profesional',city:b.city||'',description:b.services||b.description||'',price:b.price||'',availability:b.availability||'',specialties:b.specialties||'',modality:b.modality||'',experience:b.experience||'',capacity:b.capacity||'',profile:b.profile||b};
 const old=db.prepare('SELECT id FROM professionals WHERE user_id=?').get(userId);
 const vals=[p.name,email,p.profession,p.city,p.description,p.price,p.availability,p.specialties,p.modality,p.experience,p.capacity,JSON.stringify(p.profile)];
 if(old){db.prepare('UPDATE professionals SET name=?,email=?,profession=?,city=?,description=?,price=?,availability=?,specialties=?,modality=?,experience=?,capacity=?,profile_json=? WHERE user_id=?').run(...vals,userId);return old.id}
 return db.prepare('INSERT INTO professionals(name,email,profession,city,description,price,availability,specialties,modality,experience,capacity,profile_json,user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...vals,userId).lastInsertRowid;
}

app.get('/api/health',(req,res)=>res.json({ok:true,version:'1.2.1',ai:!!process.env.OPENAI_API_KEY}));
app.post('/api/auth/register',(req,res)=>{const {name,email,password}=req.body;if(!name||!email||!password||password.length<6)return res.status(400).json({error:'Nombre, email y contraseña de mínimo 6 caracteres son obligatorios'});try{const h=hash(password);const r=db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name,email.toLowerCase(),h.salt+':'+h.hash);const token=crypto.randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(token,r.lastInsertRowid);res.json({token,user:{id:r.lastInsertRowid,name,email:email.toLowerCase()}})}catch(e){res.status(409).json({error:'Ese email ya está registrado'})}});
app.post('/api/auth/login',(req,res)=>{const {email,password}=req.body;const u=db.prepare('SELECT * FROM users WHERE email=?').get((email||'').toLowerCase());if(!u||!verify(password||'',u.password_hash))return res.status(401).json({error:'Email o contraseña incorrectos'});const token=crypto.randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(token,u.id);res.json({token,user:{id:u.id,name:u.name,email:u.email}})});
app.post('/api/auth/logout',auth,(req,res)=>{const t=(req.headers.authorization||'').replace('Bearer ','');db.prepare('DELETE FROM sessions WHERE token=?').run(t);res.json({ok:true})});
app.get('/api/me',auth,(req,res)=>res.json(req.user));
app.get('/api/setup-status',auth,(req,res)=>{const p=db.prepare('SELECT * FROM professionals WHERE user_id=?').get(req.user.id);res.json({hasProfile:!!p,profile:p||null,next: p?'dashboard':'onboarding'});});

app.get('/api/professionals',(req,res)=>{const q=(req.query.q||'').trim().toLowerCase();let rows=db.prepare('SELECT * FROM professionals ORDER BY id DESC').all();if(q)rows=rows.filter(p=>(p.name+' '+p.profession+' '+p.city+' '+p.description+' '+p.specialties+' '+p.modality).toLowerCase().includes(q));res.json(rows)});
app.get('/api/my-professional',auth,(req,res)=>res.json(db.prepare('SELECT * FROM professionals WHERE user_id=?').get(req.user.id)||null));
app.post('/api/professionals',auth,(req,res)=>{const b=req.body;if(!b.name||!b.profession)return res.status(400).json({error:'Nombre y profesión son obligatorios'});const id=saveProfessional(req.user.id,req.user.email,b);res.json({ok:true,id,next:'dashboard'})});

app.post('/api/onboarding',async(req,res)=>{
 const {message='',history=[]}=req.body;
 const fallback={reply:'Perfecto. Para dejar tu perfil listo necesito saber qué servicio ofreces, dónde trabajas, tus precios, disponibilidad y modalidad. Puedes contármelo todo de una vez.',done:false,profile:{},missing:['servicios','ciudad','precio','disponibilidad','modalidad']};
 if(!process.env.OPENAI_API_KEY)return res.json({...fallback,ai:false});
 const instructions=`Eres ClienteAI, el asistente de alta de profesionales. Entrevista a un profesional para construir un perfil comercial listo para publicar. No inventes nada. Si el usuario entrega varios datos, extraelos todos. Haz preguntas solo por los datos realmente faltantes y máximo 2 preguntas por turno. Considera suficiente para publicar cuando existan nombre, profesión, servicios, ciudad o zona, modalidad y al menos uno de precio/disponibilidad. Devuelve SOLO JSON válido: {reply:string,done:boolean,profile:{name,profession,city,services,specialties,price,availability,modality,experience,capacity,policies},missing:string[]}. Mantén las respuestas breves y en español.`;
 try{const t=await aiResponse(instructions,`Historial: ${JSON.stringify(history)}\nMensaje actual: ${message}`);res.json({...parseJson(t,fallback),ai:true})}catch(e){res.status(502).json({error:'La IA no está disponible ahora. Puedes completar el formulario manualmente.'})}
});
app.post('/api/onboarding/save',auth,(req,res)=>{const id=saveProfessional(req.user.id,req.user.email,req.body);const p=db.prepare('SELECT * FROM professionals WHERE id=?').get(id);res.json({ok:true,id,profile:p,next:'dashboard'})});

app.post('/api/match',async(req,res)=>{
 const {need='',city='',budget='',modality='',limit=5}=req.body;const pros=db.prepare('SELECT * FROM professionals').all();if(!pros.length)return res.json({matches:[],summary:'Todavía no hay profesionales registrados.'});
 const words=need.toLowerCase().split(/\W+/).filter(w=>w.length>3);const ranked=pros.map(p=>{const hay=(p.name+' '+p.profession+' '+p.city+' '+p.description+' '+p.specialties+' '+p.modality).toLowerCase();let score=0;for(const w of words)if(hay.includes(w))score+=2;if(city&&p.city.toLowerCase().includes(city.toLowerCase()))score+=4;if(modality&&p.modality.toLowerCase().includes(modality.toLowerCase()))score+=2;return {...p,base_score:score}}).sort((a,b)=>b.base_score-a.base_score).slice(0,8);
 if(!process.env.OPENAI_API_KEY)return res.json({matches:ranked.slice(0,limit).map(p=>({...p,match_reason:'Coincide con tu necesidad, ubicación o modalidad.',fit:Math.min(100,55+p.base_score*5)})),summary:'Coincidencias basadas en los datos disponibles.',ai:false});
 const instructions=`Eres el motor de matching de ClienteAI. Compara la necesidad del cliente con los perfiles. Usa únicamente datos proporcionados. No inventes. Devuelve SOLO JSON válido: {matches:[{professional_id:number,match_reason:string,fit:number}],summary:string}. fit es compatibilidad descriptiva de 0 a 100, no una garantía.`;
 try{const t=await aiResponse(instructions,`Necesidad: ${need}\nCiudad: ${city}\nPresupuesto: ${budget}\nModalidad: ${modality}\nProfesionales: ${JSON.stringify(ranked.map(p=>({id:p.id,name:p.name,profession:p.profession,city:p.city,description:p.description,specialties:p.specialties,price:p.price,modality:p.modality,experience:p.experience})) )}`);const j=parseJson(t,{matches:[],summary:''});const map=new Map(ranked.map(p=>[p.id,p]));j.matches=(j.matches||[]).slice(0,limit).map(m=>({...map.get(m.professional_id),match_reason:m.match_reason,fit:m.fit})).filter(x=>x.id);res.json({...j,ai:true})}catch(e){res.json({matches:ranked.slice(0,limit),summary:'No pude usar la IA, así que mostré las coincidencias directas disponibles.',ai:false})}
});

app.post('/api/leads',(req,res)=>{const {professional_id,name,email,need}=req.body;if(!professional_id||!name||!email||!need)return res.status(400).json({error:'Faltan datos'});const r=db.prepare('INSERT INTO leads(professional_id,name,email,need) VALUES(?,?,?,?)').run(professional_id,name,email,need);res.json({id:r.lastInsertRowid})});
app.get('/api/leads',auth,(req,res)=>{const p=db.prepare('SELECT id FROM professionals WHERE user_id=?').get(req.user.id);if(!p)return res.json([]);res.json(db.prepare('SELECT * FROM leads WHERE professional_id=? ORDER BY id DESC').all(p.id))});
app.patch('/api/leads/:id',auth,(req,res)=>{const p=db.prepare('SELECT id FROM professionals WHERE user_id=?').get(req.user.id);const {status}=req.body;if(!p||!['new','contacted','booked','won','lost'].includes(status))return res.status(400).json({error:'Estado inválido'});db.prepare('UPDATE leads SET status=? WHERE id=? AND professional_id=?').run(status,req.params.id,p.id);res.json({ok:true})});
app.post('/api/chat',async(req,res)=>{const {professional_id,lead_id,message}=req.body;const p=db.prepare('SELECT * FROM professionals WHERE id=?').get(professional_id);if(!p)return res.status(404).json({error:'Profesional no encontrado'});let reply=`Claro. ${p.name} ofrece ${p.description||'sus servicios profesionales'}.`;if(p.price)reply+=` Precio: ${p.price}.`;if(p.availability)reply+=` Disponibilidad: ${p.availability}.`;if(!process.env.OPENAI_API_KEY)return res.json({reply,ai:false});const instructions=`Eres el asistente comercial de un profesional. Usa exclusivamente el contexto. No inventes precios, horarios, políticas ni reservas. Si no sabes algo, dilo. Sé breve y orienta al siguiente paso.`;try{reply=await aiResponse(instructions,`CONTEXTO DEL PROFESIONAL:\n${professionalContext(p)}\n\nMENSAJE DEL CLIENTE:\n${message}`)||reply;res.json({reply,ai:true})}catch{res.json({reply,ai:false})}});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const port=process.env.PORT||3000;app.listen(port,()=>console.log(`ClienteAI 1.2.1 on ${port}`));
