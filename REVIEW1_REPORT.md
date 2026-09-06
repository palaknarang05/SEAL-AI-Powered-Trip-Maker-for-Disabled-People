# SEAL — AI-Powered Trip Maker for Disabled People
## Review 1 Report (Phase 1)

### 1. Problem Statement
Travel-booking platforms in India rarely expose accessibility information (step-free
access, sensory load, dietary safety, sign-language support) as structured, filterable
data. Disabled travelers are forced to cold-call hotels/monuments or rely on unverified
reviews, which discourages travel and creates real safety risk (e.g. no visibility into
nearest hospital). SEAL addresses this by making accessibility a first-class, filterable
attribute of every trip package, and by layering assistive tech (voice search, read-aloud,
high-contrast mode) directly into the booking flow instead of treating it as an
afterthought.

### 2. Feasibility & Scope
**In scope for the full project (Phases 1–2):**
- Accessible trip catalog with structured tags (wheelchair, sensory, diet, pets, sign
  language) and filtering.
- Browser-native assistive features: voice search (`SpeechRecognition`), read-aloud
  (`SpeechSynthesis`), high-contrast toggle, adjustable text size.
- Stress-free checkout: no countdown timers, save-for-later, one-page checkout, an
  assistance-request checkbox for airport/hotel help.
- AI travel assistant chat widget answering accessibility questions.
- Medical Map: nearest hospital/pharmacy per destination.

**Explicitly descoped / Phase 2+:** face-based biometric login, a production LLM
integration (Gemini/OpenAI) replacing the current rule-based assistant, and a real
payments gateway. These need API budget, a review of ethical/consent concerns for
biometric login, and are called out separately so Phase 1 stays achievable in the current
timeline.

### 3. Initial Prototype (this submission)
A working prototype (~20–25% of full scope) is included:
- Static frontend (HTML/CSS/JS) with a new **Accessible Trip Finder** section, filter
  chips, and trip cards rendered from a backend API.
- Express.js backend (`server.js`) exposing:
  - `GET /api/destinations` (with query filters `wheelchair`, `pet`, `sensory`, `veg`, `sign`)
  - `GET /api/destinations/:id`
  - `POST /api/assistance-request` (checkout assistance checkbox → stored request)
  - `POST /api/assistant` (rule-based chat stub, same contract Phase 2's LLM call will use)
- Accessibility toolbar: high-contrast toggle, font-size steps, voice search, read-aloud
  (page-level and per-card "Listen" buttons).
- JSON dataset (`data/destinations.json`) with 6 Indian destinations, each tagged and
  carrying a "nearest hospital" field for the Medical Map feature.

### 4. Research & Literature Review (summary)
Key references informing the design (see citations in submitted literature review doc):
- WCAG 2.1 guidelines for perceivable/operable interfaces — informs contrast ratio,
  focus states, and `aria-live` usage in the toolbar and chat widget.
- W3C Web Speech API spec — basis for using native `SpeechRecognition` /
  `SpeechSynthesis` instead of a paid STT/TTS API for Phase 1, keeping the prototype
  zero-cost and dependency-free.
- Published UX research on travel-booking friction for disabled users (absence of
  structured accessibility metadata, over-reliance on phone confirmation) — this
  motivated the tag-based filtering model over free-text descriptions.
- Studies on cognitive-load-reducing checkout design (no countdown timers, single-page
  flow) — applied to the "stress-free booking" requirement.

*(Full annotated bibliography with citations goes in your literature-review document —
this section is a pointer so the report and prototype line up.)*

### 5. Methodology & Approach
- **Stack:** Vanilla HTML/CSS/JS frontend (kept from the existing template to save
  time), Node.js + Express backend, flat-file JSON storage for Phase 1 (no DB
  provisioning needed yet).
- **Design approach:** accessibility-first — features are additive layers
  (`accessibility.css` / `accessibility.js`) on top of the existing UI rather than a
  rewrite, so Phase 1 stayed inside the time budget.
- **API contract discipline:** the `/api/assistant` stub already matches the shape a
  real LLM call will return (`{ reply }`), so Phase 2 only swaps the function body, not
  the frontend.
- **Validation:** manual testing with keyboard-only navigation, screen-reader spot
  checks (VoiceOver/NVDA), and toggling high-contrast mode against WCAG AA contrast
  ratios.

### 6. Timeline
| Milestone | Status |
|---|---|
| UI template selection & audit | Done |
| Accessibility toolbar (contrast, font size) | Done — this submission |
| Voice search + read-aloud | Done — this submission |
| Accessible trip filter + API | Done — this submission |
| Assistance-request checkout flow | Done (backend) — frontend checkout wiring next |
| Rule-based assistant stub | Done — this submission |
| Phase 2: real LLM integration | Planned, post Review 1 |
| Phase 2: biometric login research | Planned, post Review 1 |
| Phase 2: payment gateway | Planned, post Review 1 |

---
*Full project build (all Phase 2 features) is tracked separately — ask for the
`SEAL-full` build once Review 1 is submitted.*
