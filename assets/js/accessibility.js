

const a11yStatus = document.getElementById('a11yStatus');
function announce(msg) {
  if (a11yStatus) a11yStatus.textContent = msg;
}

/* ---------- Accessibility widget open/close ---------- */
const a11yWidgetToggle = document.getElementById('a11yWidgetToggle');
const a11yWidgetPanel = document.getElementById('a11yWidgetPanel');
const a11yWidgetClose = document.getElementById('a11yWidgetClose');

function toggleA11yWidget(open) {
  if (!a11yWidgetPanel || !a11yWidgetToggle) return;
  a11yWidgetPanel.hidden = !open;
  a11yWidgetToggle.setAttribute('aria-expanded', String(open));
}

a11yWidgetToggle?.addEventListener('click', () => toggleA11yWidget(a11yWidgetPanel.hidden));
a11yWidgetClose?.addEventListener('click', () => toggleA11yWidget(false));

document.addEventListener('click', (e) => {
  if (a11yWidgetPanel && !a11yWidgetPanel.hidden
      && !a11yWidgetPanel.contains(e.target)
      && !a11yWidgetToggle.contains(e.target)) {
    toggleA11yWidget(false);
  }
});

function setSealHeaderHeightVar() {
  // .header is a single clean row now; measure its own rendered bottom edge.
  const header = document.querySelector('.header');
  const bottom = header ? header.getBoundingClientRect().bottom : 90;
  document.documentElement.style.setProperty('--seal-header-height', `${Math.max(bottom, 0)}px`);
}
setSealHeaderHeightVar();
window.addEventListener('resize', setSealHeaderHeightVar);
window.addEventListener('load', setSealHeaderHeightVar); // fonts can still be swapping in at DOMContentLoaded
setTimeout(setSealHeaderHeightVar, 600);


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

/* ---------- Voice search ----------
   Shared helper used by both the toolbar mic and the hero mic, so
   there's one robust implementation instead of two copies that can
   drift out of sync. Retargets speech into heroSearchInput, since
   the old #cityName field (from the removed weather widget) no
   longer exists on the page. */
const voiceBtn = document.getElementById('a11yVoiceSearch');
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

function setupVoiceButton(button, targetInput) {
  if (!button) return;

  if (!SpeechRecognitionAPI) {
    button.disabled = true;
    button.title = 'Voice search is not supported in this browser';
    return;
  }

  const recognition = new SpeechRecognitionAPI();
  recognition.lang = 'en-IN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  let listening = false;
  let safetyTimer = null;

  function stopListening() {
    listening = false;
    button.setAttribute('aria-pressed', 'false');
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
  }

  button.addEventListener('click', () => {
    if (listening) {
      recognition.stop();
      return;
    }
    try {
      recognition.start();
      listening = true;
      button.setAttribute('aria-pressed', 'true');
      announce('Listening…');
      // Some browsers/environments never fire 'end' or 'error' if the
      // speech service can't be reached (e.g. no network). Force a
      // reset after 8s so the mic never gets stuck "listening" forever.
      safetyTimer = setTimeout(() => {
        if (listening) {
          recognition.stop();
          stopListening();
          announce('No speech detected — check your microphone or try typing instead.');
        }
      }, 8000);
    } catch (err) {
      // start() throws if called while already running/starting
      stopListening();
      announce('Voice search could not start — try again.');
    }
  });

  recognition.addEventListener('result', (event) => {
    const transcript = event.results[0][0].transcript;
    if (targetInput) {
      targetInput.value = transcript;
      targetInput.focus();
    }
    announce(`Heard: ${transcript}`);
  });

  recognition.addEventListener('end', stopListening);

  recognition.addEventListener('error', (event) => {
    stopListening();
    const reason = event.error === 'not-allowed' || event.error === 'service-not-allowed'
      ? 'Microphone permission was blocked.'
      : event.error === 'network'
        ? 'Voice search needs an internet connection.'
        : `Voice search error: ${event.error}`;
    announce(reason);
  });
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
const sortSelect = document.getElementById('a11ySortSelect');
const savedOnlyToggle = document.getElementById('a11ySavedOnly');

/* ---------- Save for Later (localStorage) ----------
   No database yet for Phase 1, so saved trips live in the browser's own
   localStorage as a simple array of trip ids — persists across refreshes
   without needing any backend change. */
const SAVED_TRIPS_KEY = 'seal-saved-trips';

function getSavedTrips() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_TRIPS_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function isTripSaved(id) {
  return getSavedTrips().includes(id);
}

function toggleSavedTrip(id) {
  const saved = getSavedTrips();
  const next = saved.includes(id) ? saved.filter((t) => t !== id) : [...saved, id];
  localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(next));
  return next.includes(id);
}

function buildQuery() {
  const map = { wheelchair: 'wheelchair', sensory: 'sensory', veg: 'veg', pet: 'pet', sign: 'sign' };
  const params = new URLSearchParams();
  filterInputs.forEach((input) => {
    if (input.checked) params.set(map[input.dataset.filter], 'true');
  });
  if (sortSelect && sortSelect.value) params.set('sort', sortSelect.value);
  return params.toString();
}

function renderTrips(trips) {
  if (!tripGrid) return;

  const visibleTrips = savedOnlyToggle?.checked
    ? trips.filter((trip) => isTripSaved(trip.id))
    : trips;

  if (!visibleTrips.length) {
    tripGrid.innerHTML = savedOnlyToggle?.checked
      ? '<p class="a11y-loading">No saved trips yet — tap the heart on a trip card to save it.</p>'
      : '<p class="a11y-loading">No trips match those filters yet — try removing one.</p>';
    return;
  }

  tripGrid.innerHTML = visibleTrips
    .map((trip) => {
      const activeTags = Object.entries(trip.tags)
        .filter(([, value]) => value)
        .map(([key]) => TAG_META[key])
        .filter(Boolean)
        .map((meta) => `<span class="a11y-tag"><ion-icon name="${meta.icon}"></ion-icon> ${meta.label}</span>`)
        .join('');

      const speakText = `${trip.name}. ${trip.description} Price: ${trip.price} rupees. Nearest hospital: ${trip.nearestHospital}.`;
      const saved = isTripSaved(trip.id);

      return `
        <article class="a11y-trip-card">
          <div class="a11y-trip-img-wrap">
            <img src="${trip.image}" alt="${trip.name}" loading="lazy">
            <button type="button" class="a11y-save-btn ${saved ? 'is-saved' : ''}" data-save-id="${trip.id}"
              aria-pressed="${saved}" aria-label="${saved ? 'Remove from saved trips' : 'Save this trip for later'}">
              <ion-icon name="${saved ? 'heart' : 'heart-outline'}"></ion-icon>
            </button>
          </div>
          <div class="a11y-trip-body">
            <h3>${trip.name}</h3>
            <p>${trip.description}</p>
            <div class="a11y-tag-list">${activeTags}</div>
            <p class="a11y-hospital"><ion-icon name="medkit-outline"></ion-icon> ${trip.nearestHospital}</p>
            ${trip.trust
              ? `<span class="a11y-trust"><ion-icon name="shield-checkmark-outline"></ion-icon> ${trip.trust.average}/5 trust score (${trip.trust.count} verified)</span>`
              : `<span class="a11y-trust"><ion-icon name="shield-outline"></ion-icon> Not yet verified by travelers</span>`}
            <button type="button" class="a11y-verify-btn" data-verify-id="${trip.id}" data-verify-name="${trip.name}">
              Have you been here? Confirm this listing
            </button>
            <div class="a11y-trip-footer">
              <div class="a11y-price-block">
                <span class="a11y-price">&#8377;${trip.price.toLocaleString('en-IN')}<span class="a11y-price-per"> / person</span></span>
                <span class="a11y-price-note">Land package only — excludes transit to city</span>
              </div>
              <button type="button" class="a11y-btn small" data-listen="${speakText.replace(/"/g, '&quot;')}">
                <ion-icon name="volume-medium-outline"></ion-icon> Listen
              </button>
            </div>
          </div>
        </article>`;
    })
    .join('');
}

let lastLoadedTrips = [];

async function loadTrips() {
  if (!tripGrid) return;
  try {
    const query = buildQuery();
    const res = await fetch(`/api/destinations${query ? `?${query}` : ''}`);
    const trips = await res.json();
    lastLoadedTrips = trips;
    renderTrips(trips);
  } catch (err) {
    tripGrid.innerHTML = '<p class="a11y-loading">Could not load trips. Is the SEAL server running?</p>';
  }
}

filterInputs.forEach((input) => input.addEventListener('change', loadTrips));
sortSelect?.addEventListener('change', loadTrips);
savedOnlyToggle?.addEventListener('change', () => renderTrips(lastLoadedTrips));

// Save/unsave heart button — event-delegated since cards are re-rendered often
tripGrid?.addEventListener('click', (e) => {
  const saveBtn = e.target.closest('[data-save-id]');
  if (!saveBtn) return;
  const nowSaved = toggleSavedTrip(saveBtn.dataset.saveId);
  announce(nowSaved ? 'Trip saved' : 'Trip removed from saved');
  renderTrips(lastLoadedTrips);
});

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

/* ---------- Dark mode ---------- */
const darkBtn = document.getElementById('a11yDarkToggle');
function setTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  darkBtn?.setAttribute('aria-pressed', String(dark));
  try { localStorage.setItem('seal-theme', dark ? 'dark' : 'light'); } catch (e) {}
}
if (darkBtn) {
  // reflect whatever the head-inline script already applied, so the button state matches on load
  darkBtn.setAttribute('aria-pressed', String(document.documentElement.getAttribute('data-theme') === 'dark'));
  darkBtn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    setTheme(!isDark);
    announce(!isDark ? 'Dark mode on' : 'Dark mode off');
  });
}

/* ---------- Scroll-to buttons (hero CTAs, header search icon) ---------- */
document.querySelectorAll('[data-scroll-to]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = document.querySelector(btn.dataset.scrollTo);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

/* ---------- Toolbar voice search (hero has no dedicated search bar) ---------- */
setupVoiceButton(voiceBtn, null);

/* ---------- Hero "Ask The Assistant" scroll-to buttons already handled by [data-scroll-to] ---------- */

/* ============================================================
   Entrance animations — Hero Reveal
   Skipped entirely for prefers-reduced-motion: those users see the
   final, fully-visible layout with nothing moving.
   ============================================================ */
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function revealHeroContent(startDelay = 0) {
  const items = Array.from(document.querySelectorAll('.hero-reveal'));
  if (!items.length) return;

  if (prefersReducedMotion) {
    items.forEach((el) => el.classList.add('hero-reveal-in'));
    return;
  }

  items.sort((a, b) => Number(a.dataset.revealOrder || 0) - Number(b.dataset.revealOrder || 0));
  items.forEach((el, i) => {
    setTimeout(() => el.classList.add('hero-reveal-in'), startDelay + i * 120);
  });
}
revealHeroContent(200);

function setupScrollReveal() {
  const targets = document.querySelectorAll('.package-card, .a11y-trip-card');
  if (!targets.length) return;

  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('scroll-reveal-in'));
    return;
  }

  targets.forEach((el) => el.classList.add('scroll-reveal'));

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('scroll-reveal-in');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  targets.forEach((el) => observer.observe(el));
}


revealHeroContent();
// Trip cards render async from the API, so give the grid a moment before
// wiring up scroll-reveal on both the static package cards and the trip cards.
setTimeout(setupScrollReveal, 400);

/* ============================================================
   Sign-in modal (replaces the removed face-login redirect and
   alert()-based login) + newsletter inline feedback (replaces
   its alert() too — a blocking native alert is a poor experience
   for cognitive/sensory-sensitive users, which this project is
   built around).
   ============================================================ */
const signInBtn = document.getElementById('sealSignInBtn');
const signInModal = document.getElementById('sealSignInModal');
const signInClose = document.getElementById('sealSignInClose');
const signInCancel = document.getElementById('sealSignInCancel');
const signInForm = document.getElementById('sealSignInForm');
const signInStatus = document.getElementById('sealSignInStatus');

signInBtn?.addEventListener('click', () => {
  signInStatus.textContent = '';
  signInModal?.showModal();
});
signInClose?.addEventListener('click', () => signInModal?.close());
signInCancel?.addEventListener('click', () => signInModal?.close());

signInForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  signInStatus.textContent = 'Sign-in is coming in a later review — this preview form doesn\'t send data anywhere yet.';
  setTimeout(() => signInModal?.close(), 1600);
});

/* ============================================================
   Passkey login (Review 2) — real WebAuthn, not a fake redirect.
   Uses the browser's native navigator.credentials API. Requires a
   secure context (HTTPS, or localhost) and an actual authenticator
   (fingerprint / Face ID / Windows Hello / hardware key) — this
   can't be exercised in a headless/sandboxed browser, so test it on
   a real device once deployed.
   ============================================================ */
function base64urlToBuffer(base64url) {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);
  return buffer.buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  bytes.forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function registerPasskey() {
  const username = document.getElementById('sealSignInUsername').value.trim();
  if (!username) {
    signInStatus.textContent = 'Enter a username first.';
    return;
  }
  if (!window.PublicKeyCredential) {
    signInStatus.textContent = 'Passkeys aren\'t supported in this browser.';
    return;
  }

  try {
    signInStatus.textContent = 'Requesting registration options…';
    const optionsRes = await fetch('/api/passkey/register-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const options = await optionsRes.json();
    if (!optionsRes.ok) throw new Error(options.error || 'Could not get registration options');

    options.challenge = base64urlToBuffer(options.challenge);
    options.user.id = base64urlToBuffer(options.user.id);
    (options.excludeCredentials || []).forEach((c) => { c.id = base64urlToBuffer(c.id); });

    signInStatus.textContent = 'Follow your device\'s prompt (fingerprint / Face ID / PIN)…';
    const credential = await navigator.credentials.create({ publicKey: options });

    const response = {
      id: credential.id,
      rawId: bufferToBase64url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
        attestationObject: bufferToBase64url(credential.response.attestationObject),
      },
      clientExtensionResults: credential.getClientExtensionResults(),
    };

    const verifyRes = await fetch('/api/passkey/register-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, response }),
    });
    const result = await verifyRes.json();
    if (!verifyRes.ok || !result.verified) throw new Error(result.error || 'Registration failed');

    signInStatus.textContent = `Passkey registered for "${username}" — you can now sign in with it.`;
  } catch (err) {
    signInStatus.textContent = `Passkey registration didn't complete: ${err.message}`;
  }
}

async function loginWithPasskey() {
  const username = document.getElementById('sealSignInUsername').value.trim();
  if (!username) {
    signInStatus.textContent = 'Enter your username first.';
    return;
  }
  if (!window.PublicKeyCredential) {
    signInStatus.textContent = 'Passkeys aren\'t supported in this browser.';
    return;
  }

  try {
    signInStatus.textContent = 'Requesting login challenge…';
    const optionsRes = await fetch('/api/passkey/login-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const options = await optionsRes.json();
    if (!optionsRes.ok) throw new Error(options.error || 'No passkey found for this username');

    options.challenge = base64urlToBuffer(options.challenge);
    (options.allowCredentials || []).forEach((c) => { c.id = base64urlToBuffer(c.id); });

    signInStatus.textContent = 'Follow your device\'s prompt…';
    const assertion = await navigator.credentials.get({ publicKey: options });

    const response = {
      id: assertion.id,
      rawId: bufferToBase64url(assertion.rawId),
      type: assertion.type,
      response: {
        clientDataJSON: bufferToBase64url(assertion.response.clientDataJSON),
        authenticatorData: bufferToBase64url(assertion.response.authenticatorData),
        signature: bufferToBase64url(assertion.response.signature),
        userHandle: assertion.response.userHandle ? bufferToBase64url(assertion.response.userHandle) : null,
      },
      clientExtensionResults: assertion.getClientExtensionResults(),
    };

    const verifyRes = await fetch('/api/passkey/login-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, response }),
    });
    const result = await verifyRes.json();
    if (!verifyRes.ok || !result.verified) throw new Error(result.error || 'Login failed');

    if (result.token) { localStorage.setItem('seal_token', result.token); localStorage.setItem('seal_logged_in_user', username); if (typeof loggedInUser !== 'undefined') loggedInUser = username; loadMyRequests(); }
    signInStatus.textContent = `Signed in as "${username}" with your passkey.`;
    setTimeout(() => signInModal?.close(), 1200);
  } catch (err) {
    signInStatus.textContent = `Passkey sign-in didn't complete: ${err.message}`;
  }
}

document.getElementById('sealPasskeyLogin')?.addEventListener('click', loginWithPasskey);
document.getElementById('sealPasskeyRegister')?.addEventListener('click', registerPasskey);

/* ============================================================
   Community verification / trust score modal (Review 2)
   ============================================================ */
const verifyModal = document.getElementById('sealVerifyModal');
const verifyForm = document.getElementById('sealVerifyForm');
const verifyStatus = document.getElementById('sealVerifyStatus');
const verifyStars = document.getElementById('sealVerifyStars');
const verifyRatingInput = document.getElementById('sealVerifyRating');
const verifyDestIdInput = document.getElementById('sealVerifyDestId');
const verifyDestNameEl = document.getElementById('sealVerifyDestName');

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-verify-id]');
  if (!btn) return;
  verifyDestIdInput.value = btn.dataset.verifyId;
  verifyDestNameEl.textContent = btn.dataset.verifyName;
  verifyRatingInput.value = '0';
  verifyStars?.querySelectorAll('button').forEach((s) => s.classList.remove('is-active'));
  verifyStatus.textContent = '';
  verifyModal?.showModal();
});

verifyStars?.addEventListener('click', (e) => {
  const star = e.target.closest('[data-star]');
  if (!star) return;
  const value = Number(star.dataset.star);
  verifyRatingInput.value = String(value);
  verifyStars.querySelectorAll('button').forEach((s) => {
    s.classList.toggle('is-active', Number(s.dataset.star) <= value);
  });
});

document.getElementById('sealVerifyClose')?.addEventListener('click', () => verifyModal?.close());
document.getElementById('sealVerifyCancel')?.addEventListener('click', () => verifyModal?.close());

verifyForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const rating = Number(verifyRatingInput.value);
  if (!rating) {
    verifyStatus.textContent = 'Pick a star rating first.';
    return;
  }
  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destinationId: verifyDestIdInput.value,
        rating,
        note: document.getElementById('sealVerifyNote').value,
      }),
    });
    if (!res.ok) throw new Error('Could not save your confirmation');
    verifyStatus.textContent = 'Thanks — this helps other travelers trust the listing.';
    setTimeout(() => {
      verifyModal?.close();
      loadTrips();
    }, 1200);
  } catch (err) {
    verifyStatus.textContent = err.message;
  }
});

const newsletterForm = document.getElementById('sealNewsletterForm');
const newsletterStatus = document.getElementById('sealNewsletterStatus');
newsletterForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const emailInput = document.getElementById('sealNewsletterEmail');
  newsletterStatus.textContent = `Thanks — we'll notify ${emailInput.value} when new accessible trips go live.`;
  newsletterForm.reset();
});

/* ---------- Trip inquiry form → backend file logger ----------
   Replaces the old alert()-only submit. Posts to /api/contact, which the
   server appends to a plain text log file (data/contact-log.txt) using
   Node's fs module — a lightweight stand-in for a database insert. */
const inquiryForm = document.getElementById('sealInquiryForm');
const inquiryStatus = document.getElementById('sealInquiryStatus');

inquiryForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const destination = document.getElementById('destination').value;
  const people = document.getElementById('people').value;
  const checkin = document.getElementById('checkin').value;
  const checkout = document.getElementById('checkout').value;

  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination, people, checkin, checkout }),
    });
    if (!res.ok) throw new Error('Request failed');
    inquiryStatus.textContent = `Thanks — we've logged your inquiry for ${destination}. Our team will follow up by email.`;
    inquiryForm.reset();
  } catch (err) {
    inquiryStatus.textContent = 'Could not send your inquiry right now — please try again in a moment.';
  }
});




/* ============================================================
   Freelance Accessibility Consultant (Replaces Cab Service)
   ============================================================ */
const consultantDestSelect = document.getElementById('consultantDest');
const consultantForm = document.getElementById('consultantForm');
const consultantStatus = document.getElementById('consultantBookingStatus');

function populateConsultantDestinations() {
  if (!consultantDestSelect || typeof lastLoadedTrips === 'undefined' || !lastLoadedTrips.length) return;
  const current = consultantDestSelect.value;
  consultantDestSelect.innerHTML = '<option value="">Select a destination</option>' +
    lastLoadedTrips.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  if (current) consultantDestSelect.value = current;
}

consultantForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!localStorage.getItem('seal_token')) {
    consultantStatus.style.color = '#ef4444';
    consultantStatus.textContent = 'Please sign in before booking a consultant.';
    document.getElementById('sealSignInModal')?.showModal();
    return;
  }
  const destId = consultantDestSelect.value;
  if (!destId) {
    consultantStatus.textContent = 'Please select a destination first.';
    return;
  }

  const lang = document.getElementById('consultantLang').value;
  const reqs = Array.from(document.querySelectorAll('input[name="consultantReq"]:checked')).map(cb => cb.value).join(', ');
  const budget = Number(document.getElementById('consultantBudget').value);
  if (!budget || budget < 100) {
    consultantStatus.style.color = '#ef4444';
    consultantStatus.textContent = 'Please enter a budget of at least ₹100.';
    return;
  }

  try {
    const res = await fetch('/api/consultant-booking', {
      method: 'POST',
      headers: sealAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        destinationId: destId,
        language: lang,
        requirements: reqs,
        budget,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Request failed');
    }

    consultantStatus.style.color = '#10b981';
    consultantStatus.textContent = `Success! Your request for a consultant speaking ${lang} has been sent. The freelancer (7% platform fee) will contact you soon.`;
    consultantForm.reset();
    loadMyRequests();
  } catch (err) {
    consultantStatus.style.color = '#ef4444';
    consultantStatus.textContent = `Could not process your request: ${err.message}. Please try again.`;
  }
});

setTimeout(populateConsultantDestinations, 500);


/* ============================================================
   Traveler's consultant requests + approval notifications
   Polls the server so a traveler sees "approved" without refreshing.
   ============================================================ */
function escHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showToast(message) {
  let toast = document.getElementById('sealToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sealToast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;background:#065f46;color:#fff;padding:14px 22px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);font-size:.92rem;max-width:90vw;';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.style.display = 'none'; }, 8000);
}

let myRequestsFirstLoad = true;
async function loadMyRequests() {
  const panel = document.getElementById('myRequestsPanel');
  if (!panel || !localStorage.getItem('seal_token')) return;
  try {
    const res = await fetch('/api/my-requests', { headers: sealAuthHeaders() });
    if (!res.ok) return;
    const rows = await res.json();

    // Notify once per newly-approved request (remembered per browser).
    const seen = JSON.parse(localStorage.getItem('seal_seen_approved') || '[]');
    rows.filter((r) => r.status === 'approved' && !seen.includes(r.id)).forEach((r) => {
      showToast(`Good news! ${r.consultant} accepted your consultant request (${destName(r.destination_id)}).`);
      seen.push(r.id);
    });
    localStorage.setItem('seal_seen_approved', JSON.stringify(seen));

    if (!rows.length) { panel.innerHTML = ''; return; }
    panel.innerHTML = '<h4 style="margin:24px 0 10px;color:#0f172a;">Your consultant requests</h4>' + rows.map((r) => `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;">
        <div style="font-size:.88rem;color:#334155;">
          <strong>${escHtml(destName(r.destination_id))}</strong> &middot; ${escHtml(r.language)} &middot; &#8377;${Number(r.budget_inr).toLocaleString('en-IN')}<br>
          <span style="color:#64748b;">${r.status === 'approved' ? 'Accepted by ' + escHtml(r.consultant) : 'Waiting for a matching consultant'}</span>
        </div>
        <span style="font-size:.72rem;font-weight:700;padding:4px 10px;border-radius:12px;background:${r.status === 'approved' ? '#d1fae5' : '#fef3c7'};color:${r.status === 'approved' ? '#065f46' : '#92400e'};">${r.status.toUpperCase()}</span>
      </div>`).join('');
  } catch (e) { /* offline — try again on the next poll */ }
}

function destName(id) {
  const t = (typeof lastLoadedTrips !== 'undefined' ? lastLoadedTrips : []).find((x) => x.id === id);
  return t ? t.name : id;
}

setTimeout(loadMyRequests, 1200);
setInterval(loadMyRequests, 15000);
