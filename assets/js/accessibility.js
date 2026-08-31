'use strict';

/* ============================================================
   SEAL — Accessibility layer (Review 1 prototype)
   - High contrast toggle
   - Font-size steps
   - Voice search (Web Speech API: SpeechRecognition)
   - Read-aloud (Web Speech API: SpeechSynthesis)
   - Accessible trip grid (fetches /api/destinations)
   - Assistant chat widget (fetches /api/assistant)
   ============================================================ */

const a11yStatus = document.getElementById('a11yStatus');
function announce(msg) {
  if (a11yStatus) a11yStatus.textContent = msg;
}

/* ---------- High contrast ---------- */
const contrastBtn = document.getElementById('a11yContrastToggle');
if (contrastBtn) {
  contrastBtn.addEventListener('click', () => {
    const on = document.body.classList.toggle('a11y-high-contrast');
    contrastBtn.setAttribute('aria-pressed', String(on));
    announce(on ? 'High contrast mode on' : 'High contrast mode off');
  });
}

/* ---------- Font size steps ---------- */
let fontStep = 0; // -2..+3, each step = 10%
function applyFontStep() {
  document.documentElement.style.fontSize = `${100 + fontStep * 10}%`;
}
document.getElementById('a11yFontIncrease')?.addEventListener('click', () => {
  if (fontStep < 3) fontStep++;
  applyFontStep();
  announce(`Text size ${100 + fontStep * 10}%`);
});
document.getElementById('a11yFontDecrease')?.addEventListener('click', () => {
  if (fontStep > -2) fontStep--;
  applyFontStep();
  announce(`Text size ${100 + fontStep * 10}%`);
});

/* ---------- Voice search ---------- */
const voiceBtn = document.getElementById('a11yVoiceSearch');
const cityInput = document.getElementById('cityName');
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

if (voiceBtn) {
  if (!SpeechRecognitionAPI) {
    voiceBtn.disabled = true;
    voiceBtn.title = 'Voice search is not supported in this browser';
  } else {
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    voiceBtn.addEventListener('click', () => {
      voiceBtn.setAttribute('aria-pressed', 'true');
      announce('Listening…');
      recognition.start();
    });

    recognition.addEventListener('result', (event) => {
      const transcript = event.results[0][0].transcript;
      if (cityInput) {
        cityInput.value = transcript;
        announce(`Heard: ${transcript}`);
      }
    });

    recognition.addEventListener('end', () => {
      voiceBtn.setAttribute('aria-pressed', 'false');
    });

    recognition.addEventListener('error', (event) => {
      voiceBtn.setAttribute('aria-pressed', 'false');
      announce(`Voice search error: ${event.error}`);
    });
  }
}

/* ---------- Read-aloud ---------- */
const synth = window.speechSynthesis;

function readText(text) {
  if (!synth) {
    announce('Read-aloud is not supported in this browser');
    return;
  }
  synth.cancel(); // stop anything already playing
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  synth.speak(utterance);
}

document.getElementById('a11yReadPage')?.addEventListener('click', (e) => {
  const btn = e.currentTarget;
  if (synth && synth.speaking) {
    synth.cancel();
    btn.setAttribute('aria-pressed', 'false');
    announce('Stopped reading');
    return;
  }
  const main = document.querySelector('main') || document.body;
  readText(main.innerText.slice(0, 4000)); // guard against huge pages
  btn.setAttribute('aria-pressed', 'true');
  announce('Reading page aloud');
});

/* Event-delegated "Listen" buttons on individual trip cards (added below) */
document.addEventListener('click', (e) => {
  const listenBtn = e.target.closest('[data-listen]');
  if (listenBtn) {
    readText(listenBtn.dataset.listen);
  }
});

/* ---------- Accessible trip grid ---------- */
const TAG_META = {
  wheelchairAccess: { icon: 'accessibility-outline', label: 'Wheelchair / Ramp' },
  sensoryFriendly: { icon: 'ear-outline', label: 'Sensory-Friendly' },
  strictVeg: { icon: 'leaf-outline', label: 'Strict Veg' },
  petFriendly: { icon: 'paw-outline', label: 'Pet Friendly' },
  signLanguageGuide: { icon: 'hand-left-outline', label: 'Sign-Language Guide' },
};

const tripGrid = document.getElementById('a11yTripGrid');
const filterInputs = document.querySelectorAll('.a11y-filter-chip input[data-filter]');

function buildQuery() {
  const map = { wheelchair: 'wheelchair', sensory: 'sensory', veg: 'veg', pet: 'pet', sign: 'sign' };
  const params = new URLSearchParams();
  filterInputs.forEach((input) => {
    if (input.checked) params.set(map[input.dataset.filter], 'true');
  });
  return params.toString();
}

function renderTrips(trips) {
  if (!tripGrid) return;

  if (!trips.length) {
    tripGrid.innerHTML = '<p class="a11y-loading">No trips match those filters yet — try removing one.</p>';
    return;
  }

  tripGrid.innerHTML = trips
    .map((trip) => {
      const activeTags = Object.entries(trip.tags)
        .filter(([, value]) => value)
        .map(([key]) => TAG_META[key])
        .filter(Boolean)
        .map((meta) => `<span class="a11y-tag"><ion-icon name="${meta.icon}"></ion-icon> ${meta.label}</span>`)
        .join('');

      const speakText = `${trip.name}. ${trip.description} Price: ${trip.price} rupees. Nearest hospital: ${trip.nearestHospital}.`;

      return `
        <article class="a11y-trip-card">
          <img src="${trip.image}" alt="${trip.name}" loading="lazy">
          <div class="a11y-trip-body">
            <h3>${trip.name}</h3>
            <p>${trip.description}</p>
            <div class="a11y-tag-list">${activeTags}</div>
            <p class="a11y-hospital"><ion-icon name="medkit-outline"></ion-icon> ${trip.nearestHospital}</p>
            <div class="a11y-trip-footer">
              <span class="a11y-price">&#8377;${trip.price.toLocaleString('en-IN')}</span>
              <button type="button" class="a11y-btn small" data-listen="${speakText.replace(/"/g, '&quot;')}">
                <ion-icon name="volume-medium-outline"></ion-icon> Listen
              </button>
            </div>
          </div>
        </article>`;
    })
    .join('');
}

async function loadTrips() {
  if (!tripGrid) return;
  try {
    const query = buildQuery();
    const res = await fetch(`/api/destinations${query ? `?${query}` : ''}`);
    const trips = await res.json();
    renderTrips(trips);
  } catch (err) {
    tripGrid.innerHTML = '<p class="a11y-loading">Could not load trips. Is the SEAL server running?</p>';
  }
}

filterInputs.forEach((input) => input.addEventListener('change', loadTrips));
document.addEventListener('DOMContentLoaded', loadTrips);
if (document.readyState !== 'loading') loadTrips();

/* ---------- Assistant chat widget ---------- */
const chatToggle = document.getElementById('a11yChatToggle');
const chatPanel = document.getElementById('a11yChatPanel');
const chatClose = document.getElementById('a11yChatClose');
const chatForm = document.getElementById('a11yChatForm');
const chatInput = document.getElementById('a11yChatInput');
const chatMessages = document.getElementById('a11yChatMessages');

function toggleChat(open) {
  if (!chatPanel || !chatToggle) return;
  chatPanel.hidden = !open;
  chatToggle.setAttribute('aria-expanded', String(open));
}

chatToggle?.addEventListener('click', () => toggleChat(chatPanel.hidden));
chatClose?.addEventListener('click', () => toggleChat(false));

function addChatMessage(text, who) {
  const el = document.createElement('div');
  el.className = `a11y-chat-msg ${who}`;
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;

  addChatMessage(message, 'user');
  chatInput.value = '';

  try {
    const res = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    addChatMessage(data.reply, 'bot');
  } catch (err) {
    addChatMessage('Sorry, I could not reach the assistant right now.', 'bot');
  }
});
