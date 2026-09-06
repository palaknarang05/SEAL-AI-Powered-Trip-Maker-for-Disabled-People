

const a11yStatus = document.getElementById('a11yStatus');
function announce(msg) {
  if (a11yStatus) a11yStatus.textContent = msg;
}

function setSealHeaderHeightVar() {
  const candidates = [
    document.querySelector('.a11y-bar'),
    document.querySelector('.header-top'),
    document.querySelector('.header-bottom'),
  ].filter(Boolean);

  const maxBottom = candidates.reduce((max, el) => {
    return Math.max(max, el.getBoundingClientRect().bottom);
  }, 0);

  document.documentElement.style.setProperty('--seal-header-height', `${Math.max(maxBottom, 0)}px`);
}
setSealHeaderHeightVar();
window.addEventListener('resize', setSealHeaderHeightVar);
window.addEventListener('load', setSealHeaderHeightVar); // fonts can still be swapping in at DOMContentLoaded
// ion-icon is a web component that upgrades asynchronously and can nudge
// header height slightly after first paint — one more late check catches that.
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

/* ---------- Hero search: submits into the trip-finder filters ---------- */
const heroSearchForm = document.getElementById('heroSearchForm');
const heroSearchInput = document.getElementById('heroSearchInput');
heroSearchForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  document.querySelector('#accessible-trips')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // trip data is small and local, so a simple client-side name filter is enough for Phase 1
  const q = heroSearchInput.value.trim().toLowerCase();
  if (!q || !tripGrid) return;
  const cards = tripGrid.querySelectorAll('.a11y-trip-card');
  cards.forEach((card) => {
    const name = card.querySelector('h3')?.textContent.toLowerCase() || '';
    card.style.display = name.includes(q) ? '' : 'none';
  });
});

/* ---------- Hero voice search button (shares setupVoiceButton with the toolbar mic) ---------- */
const heroVoiceBtn = document.getElementById('heroVoiceBtn');
setupVoiceButton(voiceBtn, heroSearchInput);
setupVoiceButton(heroVoiceBtn, heroSearchInput);

/* ---------- Hero "Ask The Assistant" button ---------- */
document.getElementById('heroAskAssistant')?.addEventListener('click', () => toggleChat(true));

/* ============================================================
   Entrance animations — SEAL wordmark, hero reveal, scroll reveal
   Skipped entirely for prefers-reduced-motion (see accessibility.css
   for why): those users see the final, fully-visible layout with
   nothing moving.
   ============================================================ */
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ============================================================
   Entrance animations — Typewriter SEAL Logo & Hero Reveal
   ============================================================ */
function typewriteSealLogo() {
  const target = document.getElementById('sealTypewriter');
  if (!target) return;

  const text = 'Explore Without Limits.';

  if (prefersReducedMotion) {
    target.textContent = text;
    document.querySelector('.seal-cursor')?.remove();
    revealHeroContent(0);
    return;
  }

  let index = 0;
  function typeChar() {
    if (index < text.length) {
      target.textContent += text.charAt(index);
      index++;
      setTimeout(typeChar, 180);
    } else {
      // Reveal the rest of the hero once typing completes
      setTimeout(() => {
        revealHeroContent(200);
      }, 250);
    }
  }

  // Brief pause before typing begins
  setTimeout(typeChar, 300);
}

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

// Initialize
typewriteSealLogo();

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
   Stats strip count-up + hero mouse-parallax
   Both skip their motion for prefers-reduced-motion (see the
   prefersReducedMotion flag set earlier) — numbers just show
   their final value instantly, and the hero doesn't shift at all.
   ============================================================ */
function animateStatNumbers() {
  const numbers = document.querySelectorAll('.seal-stat-number');
  if (!numbers.length) return;

  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    numbers.forEach((el) => {
      const target = Number(el.dataset.countTo || 0);
      el.textContent = target + (el.dataset.suffix || '');
    });
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = Number(el.dataset.countTo || 0);
        const suffix = el.dataset.suffix || '';
        const duration = 900;
        const start = performance.now();

        function tick(now) {
          const progress = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
          el.textContent = Math.round(target * eased) + suffix;
          if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        observer.unobserve(el);
      });
    },
    { threshold: 0.4 }
  );

  numbers.forEach((el) => observer.observe(el));
}
animateStatNumbers();

/* ---------- Subtle hero mouse-parallax ---------- */
function setupHeroParallax() {
  const hero = document.getElementById('home');
  if (!hero || prefersReducedMotion) return;
  // Skip on touch devices — there's no meaningful "mouse position" there
  if (window.matchMedia('(pointer: coarse)').matches) return;

  const targets = hero.querySelectorAll('.seal-logo, .hero-eyebrow, .hero-title');
  targets.forEach((el) => el.classList.add('hero-parallax'));

  hero.addEventListener('mousemove', (e) => {
    const rect = hero.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5;

    targets.forEach((el, i) => {
      const strength = 6 + i * 2; // deeper elements move a touch more
      el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
    });
  });

  hero.addEventListener('mouseleave', () => {
    targets.forEach((el) => { el.style.transform = 'translate(0, 0)'; });
  });
}
setupHeroParallax();
