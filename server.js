const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const https = require('https');
const Database = require('better-sqlite3');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

/* ============================================================
   Encryption at rest for stored face descriptors.
   These are raw biometric vectors — storing them as plaintext in
   SQLite is a real liability. AES-256-GCM via Node's built-in
   crypto module, no new dependency. Key comes from
   SEAL_ENCRYPTION_KEY (set it in production); falls back to a
   dev-only key with a console warning so local testing still works.
   ============================================================ */
const crypto = require('crypto');
const ENCRYPTION_KEY = crypto.createHash('sha256')
  .update(process.env.SEAL_ENCRYPTION_KEY || 'seal-dev-only-insecure-key-change-me')
  .digest();
if (!process.env.SEAL_ENCRYPTION_KEY) {
  console.warn('WARNING: SEAL_ENCRYPTION_KEY is not set — using an insecure dev-only key. Set it before deploying.');
}

function encryptData(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptData(encoded) {
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

const app = express();
const PORT = process.env.PORT || 3000;

const DESTINATIONS_FILE = path.join(__dirname, 'data', 'destinations.json');
const REQUESTS_FILE = path.join(__dirname, 'data', 'assistance-requests.json');
const CONTACT_LOG_FILE = path.join(__dirname, 'data', 'contact-log.txt');
const VERIFICATIONS_FILE = path.join(__dirname, 'data', 'verifications.json');

/* ============================================================
   SQLite (real database, not a flat file) for passkey credentials.
   better-sqlite3 is embedded — no external service, no account, no
   API key, zero cost, and it ships as a .db file alongside the app.
   ============================================================ */
const db = new Database(path.join(__dirname, 'data', 'seal.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    energy_level INTEGER,
    mobility_type TEXT,
    preferences_json TEXT,
    created_at TEXT NOT NULL,
    face_descriptor TEXT,
    role TEXT,
    language TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS consultant_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    destination_id TEXT,
    language TEXT,
    requirements TEXT,
    budget_inr INTEGER,
    platform_fee_inr INTEGER,
    consultant_payout_inr INTEGER,
    status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL,
    consultant_user_id INTEGER
  );
  CREATE TABLE IF NOT EXISTS passkeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_id TEXT UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);


/* ---------- Sessions: server-issued tokens, never trust a client-sent username ---------- */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)')
    .run(token, userId, new Date().toISOString());
  return token;
}
function authUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const row = db.prepare('SELECT u.*, s.created_at AS session_created FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token);
  if (!row) return null;
  if (Date.now() - new Date(row.session_created).getTime() > SESSION_TTL_MS) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return row;
}
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,30}$/;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

function readJSON(file, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Make sure data files that Review 2 introduces exist, so a fresh clone works immediately.
if (!fs.existsSync(VERIFICATIONS_FILE)) writeJSON(VERIFICATIONS_FILE, []);

/* ============================================================
   Destinations (with community trust score merged in)
   ============================================================ */
function trustScoreFor(destinationId) {
  const verifications = readJSON(VERIFICATIONS_FILE, []);
  const forDest = verifications.filter((v) => v.destinationId === destinationId);
  if (!forDest.length) return null;
  const avg = forDest.reduce((sum, v) => sum + v.rating, 0) / forDest.length;
  return { average: Math.round(avg * 10) / 10, count: forDest.length };
}

app.get('/api/destinations', (req, res) => {
  const all = readJSON(DESTINATIONS_FILE);
  const { wheelchair, pet, sensory, veg, sign, sort } = req.query;

  let filtered = all.filter((d) => {
    if (wheelchair === 'true' && !d.tags.wheelchairAccess) return false;
    if (pet === 'true' && !d.tags.petFriendly) return false;
    if (sensory === 'true' && !d.tags.sensoryFriendly) return false;
    if (veg === 'true' && !d.tags.strictVeg) return false;
    if (sign === 'true' && !d.tags.signLanguageGuide) return false;
    return true;
  });

  if (sort === 'price_asc') filtered = [...filtered].sort((a, b) => a.price - b.price);
  else if (sort === 'price_desc') filtered = [...filtered].sort((a, b) => b.price - a.price);

  filtered = filtered.map((d) => ({ ...d, trust: trustScoreFor(d.id) }));

  res.json(filtered);
});

app.get('/api/destinations/:id', (req, res) => {
  const all = readJSON(DESTINATIONS_FILE);
  const item = all.find((d) => d.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Destination not found' });
  res.json({ ...item, trust: trustScoreFor(item.id) });
});

/* ============================================================
   Community verification / trust score (Review 2 — novelty)
   Existing accessible-travel sites show self-declared tags with no
   way to confirm they're accurate. This lets past visitors confirm
   or dispute a listing, and the average becomes a visible trust
   score — closer to how review-verification works on marketplaces,
   applied specifically to accessibility claims rather than general
   star ratings.
   ============================================================ */
app.post('/api/verify', (req, res) => {
  const { destinationId, rating, note } = req.body;
  const all = readJSON(DESTINATIONS_FILE);

  if (!destinationId || !all.find((d) => d.id === destinationId)) {
    return res.status(400).json({ error: 'Valid destinationId is required' });
  }
  const numRating = Number(rating);
  if (!numRating || numRating < 1 || numRating > 5) {
    return res.status(400).json({ error: 'rating must be 1-5' });
  }

  const verifications = readJSON(VERIFICATIONS_FILE, []);
  const entry = {
    id: Date.now().toString(36),
    destinationId,
    rating: numRating,
    note: (note || '').slice(0, 300),
    createdAt: new Date().toISOString(),
  };
  verifications.push(entry);
  writeJSON(VERIFICATIONS_FILE, verifications);

  res.status(201).json({ trust: trustScoreFor(destinationId) });
});

/* ============================================================
   Assistance request / contact logger (Review 1, unchanged)
   ============================================================ */
app.post('/api/assistance-request', (req, res) => {
  const { name, email, destinationId, needsAssistance, notes } = req.body;
  if (!name || !email || !destinationId) {
    return res.status(400).json({ error: 'name, email, and destinationId are required' });
  }
  const requests = readJSON(REQUESTS_FILE, []);
  const entry = {
    id: Date.now().toString(36),
    name, email, destinationId,
    needsAssistance: !!needsAssistance,
    notes: notes || '',
    createdAt: new Date().toISOString(),
  };
  requests.push(entry);
  writeJSON(REQUESTS_FILE, requests);
  res.status(201).json({ message: 'Assistance request saved', request: entry });
});

app.get('/api/assistance-request', (req, res) => {
  res.json(readJSON(REQUESTS_FILE, []));
});

app.post('/api/contact', (req, res) => {
  const { destination, people, checkin, checkout } = req.body;
  if (!destination || !people) {
    return res.status(400).json({ error: 'destination and people are required' });
  }
  const line = `[${new Date().toISOString()}] destination="${destination}" people=${people} checkin=${checkin || 'n/a'} checkout=${checkout || 'n/a'}\n`;
  fs.appendFileSync(CONTACT_LOG_FILE, line);
  res.status(201).json({ status: 'saved' });
});

/* ============================================================
   Fixed-fare cab booking (Review 2)
   Fare is computed client-side from a flat rate table (no external
   maps/distance API, so this stays free with zero external
   dependency) and logged here as the booking record of truth.
   ============================================================ */
const CAB_LOG_FILE = path.join(__dirname, 'data', 'cab-bookings.json');
if (!fs.existsSync(CAB_LOG_FILE)) writeJSON(CAB_LOG_FILE, []);



/* ============================================================
   Real LLM call helper — Google Gemini free-tier REST API.
   No SDK dependency — a single HTTPS POST. Returns null on any
   failure (missing key, rate limit, network issue, bad response)
   so callers always fall back to deterministic logic and never crash.
   ============================================================ */
function callGemini({ system, userText, maxTokens = 1024 }) {
  return new Promise((resolve) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return resolve(null);

    const payload = JSON.stringify({
      contents: [{ parts: [{ text: userText }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { maxOutputTokens: maxTokens },
    });

    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 15000,
      },
      (apiRes) => {
        let body = '';
        apiRes.on('data', (chunk) => { body += chunk; });
        apiRes.on('end', () => {
          try {
            const data = JSON.parse(body);
            const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || null;
            resolve(text);
          } catch (e) {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

/* ============================================================
   POST /api/assistant
   Real LLM when GEMINI_API_KEY is set (grounded on the actual
   destinations dataset, so it can't invent places that aren't in
   our catalog); rule-based keyword matching as an offline fallback
   so the demo still works without a key configured.
   ============================================================ */
function ruleBasedAssistantReply(message) {
  let reply = "I can help with wheelchair access, pet-friendly stays, sensory-friendly timings, strict-veg food, and sign-language guides. Try asking about one of those, or a city name.";
  if (message.includes('wheelchair') || message.includes('ramp') || message.includes('step-free')) {
    reply = 'Taj Mahal, Red Fort, Mahakaleshwar Ujjain, Goa Beaches, and City Palace Udaipur all have wheelchair-accessible routes marked in their listings.';
  } else if (message.includes('pet') || message.includes('dog') || message.includes('service animal')) {
    reply = 'Red Fort Delhi and Goa Beaches currently allow pets and service animals.';
  } else if (message.includes('sensory') || message.includes('quiet') || message.includes('crowd')) {
    reply = 'Mahakaleshwar Ujjain, Ghats of Banaras, and Goa Beaches offer low-crowd, sensory-friendly time slots.';
  } else if (message.includes('sign language') || message.includes('deaf')) {
    reply = 'Taj Mahal, Mahakaleshwar Ujjain, and City Palace Udaipur offer sign-language guides.';
  } else if (message.includes('veg') || message.includes('food') || message.includes('diet')) {
    reply = 'Taj Mahal, Red Fort, Mahakaleshwar Ujjain, Ghats of Banaras, and City Palace Udaipur all guarantee strict-vegetarian meal options.';
  } else if (message.includes('hospital') || message.includes('medical') || message.includes('emergency')) {
    reply = 'Every destination page lists its nearest accessible hospital or 24-hour pharmacy under "Medical Map".';
  }
  return reply;
}

app.post('/api/assistant', async (req, res) => {
  const rawMessage = req.body.message || '';
  const message = rawMessage.toLowerCase();

  const destinations = readJSON(DESTINATIONS_FILE);
  const system = `You are the SEAL travel assistant for an accessible-tourism website in India. ` +
    `Only recommend destinations from this exact JSON list — never invent places outside it: ` +
    `${JSON.stringify(destinations.map((d) => ({ name: d.name, description: d.description, tags: d.tags, price: d.price })))}. ` +
    `Answer in 2-3 short sentences, plain language, focused on accessibility needs (wheelchair access, sensory comfort, diet, sign language, pets).`;

  const llmReply = await callGemini({ system, userText: rawMessage, maxTokens: 2048 });

  if (llmReply) {
    return res.json({ reply: llmReply.trim(), source: 'llm' });
  }
  res.json({ reply: ruleBasedAssistantReply(message), source: 'rule-based' });
});

/* ============================================================
   WebAuthn passkey login (Review 2 — replaces the earlier fake
   "Face Login" redirect with a real, standards-based biometric /
   device-unlock login using the browser's native WebAuthn API).

   NOTE: WebAuthn requires a secure context (HTTPS, or localhost for
   local testing) and an actual authenticator (fingerprint sensor,
   Face ID, Windows Hello, or a hardware key) — it can't be exercised
   in a headless/sandboxed environment. Test this on a real device
   after deploying.
   ============================================================ */
const RP_NAME = 'SEAL';
const RP_ID = process.env.SEAL_RP_ID || 'localhost';
const ORIGIN = process.env.SEAL_ORIGIN || `http://localhost:${PORT}`;

// Challenges are short-lived (seconds), so an in-memory map is fine —
// only credentials/users need durable storage (SQLite, above).
const challengeStore = new Map();

function getOrCreateUser(username) {
  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    db.prepare('INSERT INTO users (username, created_at) VALUES (?, ?)')
      .run(username, new Date().toISOString());
    user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  }
  return user;
}

app.post('/api/passkey/register-options', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username is required' });

  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Invalid username' });
  const prior = db.prepare('SELECT id, face_descriptor FROM users WHERE username = ?').get(username);
  if (prior) {
    const hasCreds = db.prepare('SELECT 1 FROM passkeys WHERE user_id = ?').get(prior.id);
    const me = authUser(req);
    if ((prior.face_descriptor || hasCreds) && (!me || me.id !== prior.id)) {
      return res.status(403).json({ error: 'Username already taken — sign in first to add a passkey' });
    }
  }
  const user = getOrCreateUser(username);
  const existingCreds = db.prepare('SELECT credential_id FROM passkeys WHERE user_id = ?').all(user.id);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: username,
    attestationType: 'none',
    excludeCredentials: existingCreds.map((c) => ({ id: c.credential_id })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });

  challengeStore.set(username, options.challenge);
  res.json(options);
});

app.post('/api/passkey/register-verify', async (req, res) => {
  const { username, response } = req.body;
  const expectedChallenge = challengeStore.get(username);
  if (!expectedChallenge) return res.status(400).json({ error: 'No pending registration for this user' });

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Passkey registration could not be verified' });
    }

    const { credential } = verification.registrationInfo;
    const user = getOrCreateUser(username);
    db.prepare(
      'INSERT INTO passkeys (user_id, credential_id, public_key, counter) VALUES (?, ?, ?, ?)'
    ).run(user.id, credential.id, Buffer.from(credential.publicKey).toString('base64url'), credential.counter);

    challengeStore.delete(username);
    res.json({ verified: true });
  } catch (err) {
    res.status(400).json({ error: 'Registration verification failed', detail: err.message });
  }
});

app.post('/api/passkey/login-options', async (req, res) => {
  const { username } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const creds = user ? db.prepare('SELECT credential_id FROM passkeys WHERE user_id = ?').all(user.id) : [];
  if (!creds.length) return res.status(404).json({ error: 'No passkey registered for this user' });

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: creds.map((c) => ({ id: c.credential_id })),
    userVerification: 'preferred',
  });

  challengeStore.set(username, options.challenge);
  res.json(options);
});

app.post('/api/passkey/login-verify', async (req, res) => {
  const { username, response } = req.body;
  const expectedChallenge = challengeStore.get(username);
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !expectedChallenge) return res.status(400).json({ error: 'No pending login for this user' });

  const credential = db.prepare('SELECT * FROM passkeys WHERE credential_id = ? AND user_id = ?')
    .get(response.id, user.id);
  if (!credential) return res.status(400).json({ error: 'Unknown credential' });

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: credential.credential_id,
        publicKey: Buffer.from(credential.public_key, 'base64url'),
        counter: credential.counter,
      },
    });

    if (!verification.verified) {
      return res.status(400).json({ error: 'Passkey login could not be verified' });
    }

    db.prepare('UPDATE passkeys SET counter = ? WHERE id = ?')
      .run(verification.authenticationInfo.newCounter, credential.id);
    challengeStore.delete(username);

    res.json({ verified: true, username, token: createSession(user.id) });
  } catch (err) {
    res.status(400).json({ error: 'Login verification failed', detail: err.message });
  }
});

/* ============================================================
   Profile — accessibility details + Spoon Theory energy level.
   Recommendation logic that *uses* this is Phase 2; this endpoint
   just creates/updates the record.
   ============================================================ */
app.post('/api/profile', (req, res) => {
  const me = authUser(req);
  if (!me) return res.status(401).json({ error: 'Please sign in' });
  const { energyLevel, mobilityType, preferences } = req.body;
  db.prepare('UPDATE users SET energy_level = ?, mobility_type = ?, preferences_json = ? WHERE id = ?')
    .run(Number(energyLevel) || null, mobilityType || null, JSON.stringify(preferences || {}), me.id);
  res.json({ saved: true, username: me.username });
});

app.get('/api/profile/:username', (req, res) => {
  const me = authUser(req);
  if (!me || me.username !== req.params.username) return res.status(401).json({ error: 'Please sign in' });
  res.json({ username: me.username, energy_level: me.energy_level, mobility_type: me.mobility_type,
             created_at: me.created_at, role: me.role, preferences: JSON.parse(me.preferences_json || '{}') });
});

app.get('/api/me', (req, res) => {
  const me = authUser(req);
  if (!me) return res.status(401).json({ error: 'Not signed in' });
  res.json({ username: me.username, role: me.role });
});

app.post('/api/logout', (req, res) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) db.prepare('DELETE FROM sessions WHERE token = ?').run(header.slice(7));
  res.json({ success: true });
});

/* ============================================================
   Fixed-fare accessible cabs — structured, server-side rate card.
   No maps/distance API (keeps this free); rates are flat and never
   change, unlike surge-priced ride apps.
   ============================================================ */
app.get('/api/cabs', (req, res) => {
  res.json([
    {
      id: 'standard-sedan',
      name: 'Standard Sedan',
      ratePerKm: 14,
      wheelchairAccessible: false,
      description: 'Standard 4-seat sedan, flat per-km rate, no surge.',
    },
    {
      id: 'wheelchair-van',
      name: 'Wheelchair-Accessible Van',
      ratePerKm: 20,
      wheelchairAccessible: true,
      description: 'Ramp-equipped van, verified wheelchair access, flat per-km rate, no surge.',
    },
  ]);
});



/* ============================================================
   Face ID Registration & Login
   ============================================================ */
app.post('/api/register-face', (req, res) => {
  const { username, language, energyLevel, mobilityType, preferences, faceDescriptor, role } = req.body;
  if (!username || !faceDescriptor) return res.status(400).json({ error: 'username and faceDescriptor are required' });
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username must be 3-30 characters: letters, numbers, . _ -' });
  if (!Array.isArray(faceDescriptor) || faceDescriptor.length < 4 || !faceDescriptor.every(Number.isFinite)) return res.status(400).json({ error: 'Invalid face data' });
  if (role && !['user', 'consultant'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (role === 'consultant' && !language) return res.status(400).json({ error: 'Consultants must choose at least one language' });

  // Prevent duplicate username registration
  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUser) {
    return res.status(409).json({ error: 'Username is already taken' });
  }

  getOrCreateUser(username);
  db.prepare(
    'UPDATE users SET energy_level = ?, mobility_type = ?, preferences_json = ?, face_descriptor = ?, role = ?, language = ? WHERE username = ?'
  ).run(
    Number(energyLevel) || null,
    mobilityType || null,
    JSON.stringify(preferences || {}),
    encryptData(JSON.stringify(faceDescriptor)),
    role || 'user',
    language || null,
    username
  );

  res.json({ saved: true, username });
});

app.post('/api/login-face', (req, res) => {
  const { username, faceDescriptor } = req.body;
  if (!username || !faceDescriptor) return res.status(400).json({ error: 'username and faceDescriptor are required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !user.face_descriptor) return res.status(400).json({ error: 'User not found or has no face registered' });

  const savedDescriptor = JSON.parse(decryptData(user.face_descriptor));
  if (!Array.isArray(faceDescriptor) || faceDescriptor.length !== savedDescriptor.length) return res.status(400).json({ error: 'Invalid face data' });

  // Calculate Euclidean distance
  let distance = 0;
  for (let i = 0; i < savedDescriptor.length; i++) {
    distance += Math.pow(savedDescriptor[i] - faceDescriptor[i], 2);
  }
  distance = Math.sqrt(distance);

  // A common threshold for face-api.js is 0.6
  if (distance < 0.6) {
    res.json({ success: true, username, distance, token: createSession(user.id) });
  } else {
    res.status(401).json({ error: 'Face does not match', distance });
  }
});


/* ============================================================
   Freelance Accessibility Consultant Endpoints
   ============================================================ */
const SERVICE_FEE_PERCENT = 7;

function languagesMatch(consultantLang, requestLang) {
  if (!consultantLang) return false; // a consultant with no language set gets nothing routed to them
  const wanted = (requestLang || '').toLowerCase().trim();
  return consultantLang.toLowerCase().split(',').map((l) => l.trim()).includes(wanted);
}

// Traveler books a consultant — must be signed in as a traveler.
app.post('/api/consultant-booking', (req, res) => {
  const me = authUser(req);
  if (!me) return res.status(401).json({ error: 'Please sign in to book a consultant' });
  if (me.role === 'consultant') return res.status(403).json({ error: 'Consultant accounts cannot book consultants' });

  const { destinationId, language, requirements, budget } = req.body;
  const budgetInr = Number(budget);
  const destinations = readJSON(DESTINATIONS_FILE);
  if (!destinations.find((d) => d.id === destinationId)) return res.status(400).json({ error: 'Unknown destination' });
  if (!language) return res.status(400).json({ error: 'Please choose a language' });
  if (!Number.isFinite(budgetInr) || budgetInr < 100 || budgetInr > 1000000) {
    return res.status(400).json({ error: 'Budget must be between ₹100 and ₹10,00,000' });
  }

  const info = db.prepare(
    'INSERT INTO consultant_requests (user_id, destination_id, language, requirements, budget_inr, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(me.id, destinationId, language, String(requirements || '').slice(0, 500), Math.round(budgetInr), new Date().toISOString());

  res.status(201).json({ success: true, id: info.lastInsertRowid });
});

// Traveler's own bookings + live status (this is how they learn a request was approved).
app.get('/api/my-requests', (req, res) => {
  const me = authUser(req);
  if (!me) return res.status(401).json({ error: 'Please sign in' });
  const rows = db.prepare(`
    SELECT r.id, r.destination_id, r.language, r.requirements, r.budget_inr, r.status, r.created_at,
           c.username AS consultant
    FROM consultant_requests r
    LEFT JOIN users c ON c.id = r.consultant_user_id
    WHERE r.user_id = ?
    ORDER BY r.created_at DESC
  `).all(me.id);
  res.json(rows);
});

function requireConsultant(req, res) {
  const me = authUser(req);
  if (!me) { res.status(401).json({ error: 'Please sign in' }); return null; }
  if (me.role !== 'consultant') { res.status(403).json({ error: 'Consultant account required' }); return null; }
  return me;
}

// Consultant's feed: pending requests in languages they speak + ones they accepted.
app.get('/api/consultant/requests', (req, res) => {
  const me = requireConsultant(req, res);
  if (!me) return;
  const rows = db.prepare(`
    SELECT r.id, r.destination_id, r.language, r.requirements, r.budget_inr, r.platform_fee_inr,
           r.consultant_payout_inr, r.status, r.created_at, r.consultant_user_id, u.username
    FROM consultant_requests r
    LEFT JOIN users u ON r.user_id = u.id
    ORDER BY r.created_at DESC
  `).all();
  res.json(rows.filter((r) =>
    r.consultant_user_id === me.id || (r.status === 'pending' && languagesMatch(me.language, r.language))
  ));
});

// Accept a request — first consultant wins; it can never be accepted twice.
app.post('/api/consultant/requests/:id/approve', (req, res) => {
  const me = requireConsultant(req, res);
  if (!me) return;

  const request = db.prepare('SELECT * FROM consultant_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (!languagesMatch(me.language, request.language)) {
    return res.status(403).json({ error: 'This request was not matched to your languages' });
  }

  const platformFee = Math.round((request.budget_inr || 0) * (SERVICE_FEE_PERCENT / 100));
  const payout = (request.budget_inr || 0) - platformFee;
  const result = db.prepare(
    "UPDATE consultant_requests SET status = 'approved', platform_fee_inr = ?, consultant_payout_inr = ?, consultant_user_id = ? WHERE id = ? AND status = 'pending'"
  ).run(platformFee, payout, me.id, request.id);

  if (result.changes === 0) return res.status(409).json({ error: 'Another consultant already accepted this request' });
  res.json({ success: true, platformFee, payout });
});

app.get('/api/consultant/earnings', (req, res) => {
  const me = requireConsultant(req, res);
  if (!me) return;
  const row = db.prepare(`
    SELECT COALESCE(SUM(consultant_payout_inr), 0) AS totalEarned, COUNT(*) AS completedTrips
    FROM consultant_requests WHERE status = 'approved' AND consultant_user_id = ?
  `).get(me.id);
  res.json({ totalEarned: row.totalEarned, completedTrips: row.completedTrips, feePercent: SERVICE_FEE_PERCENT });
});

// Last-resort error handler: never leak stack traces to clients.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'Something went wrong' });
});

app.listen(PORT, () => {
  console.log(`SEAL server running on http://localhost:${PORT}`);
  console.log(process.env.GEMINI_API_KEY
    ? 'LLM assistant: LIVE (GEMINI_API_KEY set)'
    : 'LLM assistant: rule-based fallback (set GEMINI_API_KEY to enable live Gemini calls)');
});