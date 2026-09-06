const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

const DESTINATIONS_FILE = path.join(__dirname, 'data', 'destinations.json');
const REQUESTS_FILE = path.join(__dirname, 'data', 'assistance-requests.json');
const CONTACT_LOG_FILE = path.join(__dirname, 'data', 'contact-log.txt');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/**
 * GET /api/destinations
 * Optional query filters: wheelchair, pet, sensory, veg, sign (each = "true")
 * Optional sort: price_asc | price_desc — dynamically re-orders the array
 * server-side before it's sent, rather than the client just displaying
 * whatever order the JSON file happens to be in.
 */
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

  if (sort === 'price_asc') {
    filtered = [...filtered].sort((a, b) => a.price - b.price);
  } else if (sort === 'price_desc') {
    filtered = [...filtered].sort((a, b) => b.price - a.price);
  }

  res.json(filtered);
});

app.get('/api/destinations/:id', (req, res) => {
  const all = readJSON(DESTINATIONS_FILE);
  const item = all.find((d) => d.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Destination not found' });
  res.json(item);
});

/**
 * POST /api/assistance-request
 * Captures the "does the traveler need help at airport/hotel" checkbox
 * from checkout, plus any accessibility notes.
 */
app.post('/api/assistance-request', (req, res) => {
  const { name, email, destinationId, needsAssistance, notes } = req.body;

  if (!name || !email || !destinationId) {
    return res.status(400).json({ error: 'name, email, and destinationId are required' });
  }

  const requests = readJSON(REQUESTS_FILE);
  const entry = {
    id: Date.now().toString(36),
    name,
    email,
    destinationId,
    needsAssistance: !!needsAssistance,
    notes: notes || '',
    createdAt: new Date().toISOString(),
  };
  requests.push(entry);
  writeJSON(REQUESTS_FILE, requests);

  res.status(201).json({ message: 'Assistance request saved', request: entry });
});

app.get('/api/assistance-request', (req, res) => {
  res.json(readJSON(REQUESTS_FILE));
});

/**
 * POST /api/contact
 * Logs the "Inquire now" trip-search form to a plain text file using
 * Node's native fs module — a lightweight stand-in for a real database
 * insert, appropriate for a Review 1 prototype that doesn't have a DB yet.
 */
app.post('/api/contact', (req, res) => {
  const { destination, people, checkin, checkout } = req.body;

  if (!destination || !people) {
    return res.status(400).json({ error: 'destination and people are required' });
  }

  const line = `[${new Date().toISOString()}] destination="${destination}" people=${people} checkin=${checkin || 'n/a'} checkout=${checkout || 'n/a'}\n`;
  fs.appendFileSync(CONTACT_LOG_FILE, line);

  res.status(201).json({ status: 'saved' });
});

/**
 * POST /api/assistant
 * Rule-based keyword matching for now. A real LLM call can swap in behind
 * this same route later without changing the frontend contract.
 */
app.post('/api/assistant', (req, res) => {
  const message = (req.body.message || '').toLowerCase();
  let reply =
    "I can help with wheelchair access, pet-friendly stays, sensory-friendly timings, strict-veg food, and sign-language guides. Try asking about one of those, or a city name.";

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

  res.json({ reply });
});

app.listen(PORT, () => {
  console.log(`SEAL server running on http://localhost:${PORT}`);
});
