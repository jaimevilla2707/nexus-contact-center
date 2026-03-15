require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const http       = require('http');
const WebSocket  = require('ws');
const twilio     = require('twilio');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const fs         = require('fs');
const path       = require('path');

const VoiceResponse = twilio.twiml.VoiceResponse;
const AccessToken   = twilio.jwt.AccessToken;
const VoiceGrant    = AccessToken.VoiceGrant;

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Credenciales Twilio ───────────────────────────────────────────────────
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_API_KEY,
  TWILIO_API_SECRET,
  TWILIO_APP_SID,
  TWILIO_PHONE_NUMBER,
  JWT_SECRET = 'nexus_jwt_secret_2024_cambiar_en_produccion',
  PORT = 3000
} = process.env;

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// ── Cargar agentes (desde variable de entorno o archivo) ──────────────────
function loadAgents() {
  // Primero intentar desde variable de entorno AGENTS_DATA (base64)
  if (process.env.AGENTS_DATA) {
    try {
      return JSON.parse(Buffer.from(process.env.AGENTS_DATA, 'base64').toString('utf8'));
    } catch(e) {
      console.error('[AGENTS] Error leyendo AGENTS_DATA:', e.message);
    }
  }
  // Fallback: leer desde archivo
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'agents.json'), 'utf8'));
  } catch(e) {
    console.error('[AGENTS] Error cargando agents.json:', e.message);
    return [];
  }
}
function saveAgents(agents) {
  // En Railway guardamos en archivo temporal (se pierde al reiniciar)
  // Para persistencia real usar una base de datos
  try {
    fs.writeFileSync(path.join(__dirname, 'agents.json'), JSON.stringify(agents, null, 2));
  } catch(e) {
    console.error('[AGENTS] No se pudo guardar agents.json:', e.message);
  }
}

// ── Estado en tiempo real ─────────────────────────────────────────────────
const onlineAgents  = new Map(); // agentId → { ws, status, callSid, name, email, role }
const activeCalls   = new Map();
const callQueue     = [];

// ── Middleware de autenticación ───────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.agent = jwt.verify(token, JWT_SECRET);
    next();
  } catch(e) {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.agent.role !== 'admin' && req.agent.role !== 'supervisor') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    next();
  });
}

// ─────────────────────────────────────────────────────────────────────────
// AUTH ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────

// LOGIN
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  const agents = loadAgents();
  const agent  = agents.find(a => a.email.toLowerCase() === email.toLowerCase());

  if (!agent) return res.status(401).json({ error: 'Credenciales incorrectas' });
  if (!agent.active) return res.status(403).json({ error: 'Cuenta desactivada. Contacta al administrador.' });

  // Verificar contraseña (soporte para texto plano y hash bcrypt)
  let valid = false;
  if (agent.password.startsWith('$2')) {
    valid = await bcrypt.compare(password, agent.password);
  } else {
    valid = password === agent.password;
  }

  if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });

  const token = jwt.sign(
    { id: agent.id, email: agent.email, name: agent.name, role: agent.role, department: agent.department },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

  console.log(`[LOGIN] ${agent.name} (${agent.email}) - ${new Date().toLocaleString('es-CO')}`);
  res.json({ token, agent: { id: agent.id, name: agent.name, email: agent.email, role: agent.role, department: agent.department } });
});

// VERIFICAR TOKEN
app.get('/auth/me', authMiddleware, (req, res) => {
  res.json({ agent: req.agent });
});

// ─────────────────────────────────────────────────────────────────────────
// TWILIO TOKEN
// ─────────────────────────────────────────────────────────────────────────
app.get('/token', authMiddleware, (req, res) => {
  const { id, name } = req.agent;
  try {
    const token = new AccessToken(TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, { identity: id, ttl: 3600 });
    const grant = new VoiceGrant({ outgoingApplicationSid: TWILIO_APP_SID, incomingAllow: true });
    token.addGrant(grant);
    console.log(`[TOKEN] Generado para: ${name} (${id})`);
    res.json({ token: token.toJwt(), identity: id });
  } catch(e) {
    res.status(500).json({ error: 'Error generando token: ' + e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// ADMIN — GESTIÓN DE AGENTES
// ─────────────────────────────────────────────────────────────────────────

// Listar agentes
app.get('/admin/agents', adminMiddleware, (req, res) => {
  const agents = loadAgents().map(a => ({ ...a, password: '••••••••' }));
  res.json(agents);
});

// Crear agente
app.post('/admin/agents', adminMiddleware, async (req, res) => {
  const { name, email, password, role, department } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Nombre, email y contraseña requeridos' });

  const agents = loadAgents();
  if (agents.find(a => a.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'El email ya está registrado' });
  }

  const id = email.split('@')[0].toLowerCase().replace(/[^a-z0-9.]/g, '.');
  const newAgent = { id, name, email, password, role: role || 'agent', department: department || 'General', active: true };
  agents.push(newAgent);
  saveAgents(agents);
  console.log(`[ADMIN] Agente creado: ${name} (${email})`);
  res.json({ success: true, agent: { ...newAgent, password: '••••••••' } });
});

// Actualizar agente
app.put('/admin/agents/:id', adminMiddleware, async (req, res) => {
  const agents = loadAgents();
  const idx = agents.findIndex(a => a.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Agente no encontrado' });
  const { password, ...rest } = req.body;
  agents[idx] = { ...agents[idx], ...rest };
  if (password) agents[idx].password = password;
  saveAgents(agents);
  res.json({ success: true });
});

// Activar/desactivar agente
app.patch('/admin/agents/:id/toggle', adminMiddleware, (req, res) => {
  const agents = loadAgents();
  const agent  = agents.find(a => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agente no encontrado' });
  agent.active = !agent.active;
  saveAgents(agents);
  res.json({ success: true, active: agent.active });
});

// Eliminar agente
app.delete('/admin/agents/:id', adminMiddleware, (req, res) => {
  let agents = loadAgents();
  agents = agents.filter(a => a.id !== req.params.id);
  saveAgents(agents);
  res.json({ success: true });
});

// Estado en tiempo real de agentes
app.get('/admin/status', adminMiddleware, (req, res) => {
  const online = [...onlineAgents.entries()].map(([id, a]) => ({
    id, name: a.name, email: a.email, status: a.status,
    callSid: a.callSid, department: a.department, role: a.role,
    statusSince: a.statusSince || new Date().toISOString(),
    callCount: a.callCount || 0,
  }));
  res.json({ online, queue: callQueue, activeCalls: [...activeCalls.values()] });
});

// Cambiar estado de agente remotamente (supervisor)
app.post('/admin/agents/:id/force-status', adminMiddleware, (req, res) => {
  const { status } = req.body;
  const agent = onlineAgents.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agente no conectado' });
  agent.status = status;
  agent.statusSince = new Date().toISOString();
  // Notificar al agente que su estado fue cambiado
  if (agent.ws && agent.ws.readyState === WebSocket.OPEN) {
    agent.ws.send(JSON.stringify({ type: 'status_forced', status, by: req.agent.name }));
  }
  broadcastState();
  console.log(`[SUPERVISOR] ${req.agent.name} cambió estado de ${req.params.id} a ${status}`);
  res.json({ success: true });
});

// Terminar llamada de agente remotamente
app.post('/admin/agents/:id/end-call', adminMiddleware, async (req, res) => {
  const agent = onlineAgents.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agente no conectado' });
  if (agent.callSid) {
    try {
      await twilioClient.calls(agent.callSid).update({ status: 'completed' });
    } catch(e) { console.error('[END CALL]', e.message); }
  }
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────
// WEBHOOKS TWILIO
// ─────────────────────────────────────────────────────────────────────────
app.post('/voice/incoming', (req, res) => {
  const { CallSid, From, To } = req.body;
  console.log(`[CALL] Entrante: ${From} → ${To} (${CallSid})`);

  const callInfo = { callSid: CallSid, from: From, to: To, status: 'queued', startTime: new Date().toISOString() };
  callQueue.push(callInfo);
  activeCalls.set(CallSid, { ...callInfo, agentId: null });
  broadcastAll({ type: 'incoming_call', call: callInfo });
  broadcastState();

  const available = [...onlineAgents.entries()].find(([, a]) => a.status === 'available');
  const twiml     = new VoiceResponse();

  if (available) {
    const [availId] = available;
    // Grabar ambos lados: record=record-from-answer graba desde que contesta
    const dial = twiml.dial({
      record: 'record-from-answer-dual',
      recordingStatusCallback: '/voice/recording-dual-done',
      recordingStatusCallbackMethod: 'POST',
    });
    dial.client(availId);
    assignCall(CallSid, availId);
  } else {
    const gather = twiml.gather({ numDigits: 1, action: '/voice/queue-option' });
    gather.say({ language: 'es-MX', voice: 'Polly.Mia' },
      'Gracias por llamar a Nexus. Todos nuestros agentes están ocupados. ' +
      'Presione 1 para esperar, o 2 para dejar un mensaje.'
    );
    twiml.enqueue('nexus_queue');
  }

  res.type('text/xml').send(twiml.toString());
});

app.post('/voice/queue-option', (req, res) => {
  const { Digits } = req.body;
  const twiml = new VoiceResponse();
  if (Digits === '2') {
    twiml.say({ language: 'es-MX', voice: 'Polly.Mia' }, 'Deje su mensaje después del tono.');
    twiml.record({ action: '/voice/recording-done', maxLength: 120, playBeep: true });
  } else {
    twiml.say({ language: 'es-MX', voice: 'Polly.Mia' }, 'Le conectaremos con el próximo agente disponible.');
    twiml.enqueue('nexus_queue');
  }
  res.type('text/xml').send(twiml.toString());
});

app.post('/voice/outgoing', (req, res) => {
  const { To } = req.body;
  const twiml  = new VoiceResponse();
  if (To && To.startsWith('+')) {
    // Llamada a número real — grabar ambos lados
    const dial = twiml.dial({
      callerId: TWILIO_PHONE_NUMBER,
      record: 'record-from-answer-dual',
      recordingStatusCallback: '/voice/recording-dual-done',
      recordingStatusCallbackMethod: 'POST',
    });
    dial.number(To);
  } else {
    // Llamada browser-to-browser — grabar ambos lados
    const dial = twiml.dial({
      record: 'record-from-answer-dual',
      recordingStatusCallback: '/voice/recording-dual-done',
      recordingStatusCallbackMethod: 'POST',
    });
    dial.client(To);
  }
  res.type('text/xml').send(twiml.toString());
});

// Webhook: grabación dual completada (ambos lados)
app.post('/voice/recording-dual-done', (req, res) => {
  const { RecordingUrl, CallSid, RecordingDuration, RecordingSid } = req.body;
  console.log(`[RECORDING] Dual - CallSid: ${CallSid}, Duración: ${RecordingDuration}s, URL: ${RecordingUrl}`);

  // La URL de Twilio termina en .json — construir URL del audio directamente
  const audioUrl = `${RecordingUrl}.mp3`;

  // Obtener info de la llamada para enriquecer la grabación
  const call = activeCalls.get(CallSid) || {};

  broadcastAll({
    type: 'recording_ready',
    callSid: CallSid,
    recordingSid: RecordingSid,
    url: audioUrl,
    duration: parseInt(RecordingDuration || 0),
    from: call.from || 'Desconocido',
    agentId: call.agentId || '',
    timestamp: new Date().toISOString(),
  });

  res.sendStatus(200);
});

app.post('/voice/status', (req, res) => {
  const { CallSid, CallStatus, Duration } = req.body;
  const call = activeCalls.get(CallSid);
  if (call && ['completed','failed','busy','no-answer'].includes(CallStatus)) {
    activeCalls.delete(CallSid);
    const idx = callQueue.findIndex(c => c.callSid === CallSid);
    if (idx >= 0) callQueue.splice(idx, 1);
    if (call.agentId) updateAgentStatus(call.agentId, 'available');
    broadcastAll({ type: 'call_ended', callSid: CallSid, duration: Duration });
  }
  broadcastState();
  res.sendStatus(200);
});

app.post('/voice/recording-done', (req, res) => {
  const { RecordingUrl, CallSid, RecordingDuration } = req.body;
  broadcastAll({ type: 'new_recording', callSid: CallSid, url: RecordingUrl, duration: RecordingDuration });
  const twiml = new VoiceResponse();
  twiml.say({ language: 'es-MX', voice: 'Polly.Mia' }, 'Gracias por su mensaje. Le contactaremos pronto.');
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

// ─────────────────────────────────────────────────────────────────────────
// WEBSOCKET
// ─────────────────────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  let agentData = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'register') {
        // Verificar token JWT
        try {
          const agent = jwt.verify(msg.token, JWT_SECRET);
          agentData = { ws, status: 'available', callSid: null, name: agent.name, email: agent.email, role: agent.role, department: agent.department, statusSince: new Date().toISOString(), callCount: 0 };
          onlineAgents.set(agent.id, agentData);
          console.log(`[WS] Conectado: ${agent.name}`);
          ws.send(JSON.stringify({ type: 'registered', agent }));
          broadcastState();
        } catch(e) {
          ws.send(JSON.stringify({ type: 'error', message: 'Token inválido' }));
          ws.close();
        }
      } else if (msg.type === 'status_change' && agentData) {
        const id = [...onlineAgents.entries()].find(([,v]) => v.ws === ws)?.[0];
        if (id) updateAgentStatus(id, msg.status);
      } else if (msg.type === 'end_call' && agentData) {
        const id = [...onlineAgents.entries()].find(([,v]) => v.ws === ws)?.[0];
        if (id && msg.callSid) endCall(id, msg.callSid);
      }
    } catch(e) {}
  });

  ws.on('close', () => {
    const entry = [...onlineAgents.entries()].find(([,v]) => v.ws === ws);
    if (entry) {
      console.log(`[WS] Desconectado: ${entry[1].name}`);
      onlineAgents.delete(entry[0]);
      broadcastState();
    }
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────
function assignCall(callSid, agentId) {
  const call  = activeCalls.get(callSid);
  const agent = onlineAgents.get(agentId);
  if (call && agent) {
    call.agentId = agentId; call.status = 'active';
    agent.status = 'on-call'; agent.callSid = callSid;
    broadcastState();
  }
}
function updateAgentStatus(agentId, status) {
  const agent = onlineAgents.get(agentId);
  if (agent) {
    agent.status = status;
    agent.statusSince = new Date().toISOString();
    if (status === 'on-call') agent.callCount = (agent.callCount || 0) + 1;
    broadcastState();
  }
}
function endCall(agentId, callSid) {
  twilioClient.calls(callSid).update({ status: 'completed' }).catch(() => {});
  updateAgentStatus(agentId, 'available');
}
function getAgentList() {
  return [...onlineAgents.entries()].map(([id, a]) => ({
    id, name: a.name, email: a.email, status: a.status,
    callSid: a.callSid, department: a.department, role: a.role,
    statusSince: a.statusSince || new Date().toISOString(),
    callCount: a.callCount || 0,
  }));
}
function broadcastAll(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}
function broadcastState() {
  broadcastAll({ type: 'state_update', agents: getAgentList(), queue: callQueue, activeCalls: [...activeCalls.values()] });
}

// ── Health ────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', agents: onlineAgents.size, queue: callQueue.length }));

// ── Servir frontend ───────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, () => {
  console.log(`\n🚀 Nexus Contact Center corriendo en puerto ${PORT}`);
  console.log(`   Frontend: http://localhost:${PORT}`);
  console.log(`   Admin:    http://localhost:${PORT}/admin`);
  console.log(`   Health:   http://localhost:${PORT}/health\n`);
});
