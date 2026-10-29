# SEAL — AI-Powered Trip Maker for Disabled People (Review 2 build)

## Run it
```bash
npm install
npm start
```
Open http://localhost:3000

The site works fully without any setup — the LLM assistant and itinerary planner
run in a rule-based fallback mode by default. To enable the **real** LLM:

```bash
npm start
```
The server logs on startup which mode it's running in.

Passkey login (WebAuthn) needs a secure context and a real device — see
`REVIEW2_REPORT.md` §4 before demoing it.

## What's here

**Review 1:** accessibility widget (contrast, text size, voice search,
read-aloud, dark mode), Accessible Trip Finder with filters + sort, save-for-later,
assistance-request + trip-inquiry logging to `data/`.

**Review 2 (new):**
- Real LLM integration for the assistant (`/api/assistant`)
- **AI Itinerary Planner** — energy-paced, personalized multi-day trip plans
  grounded on the real destinations dataset (`/api/itinerary`)
- **Community trust score** — travelers confirm listing accuracy (`/api/verify`)
- Real WebAuthn passkey login, replacing the old face-login redirect
  (`/api/passkey/*`)


## API
- `GET /api/destinations?wheelchair=true&sensory=true&sort=price_asc...`
- `GET /api/destinations/:id`
- `POST /api/assistance-request` `{ name, email, destinationId, needsAssistance, notes }`
- `POST /api/contact` `{ destination, people, checkin, checkout }`
- `POST /api/assistant` `{ message }`
- `POST /api/itinerary` `{ mobility, days, energyLevel, wheelchair, sensory, veg, signLanguage }`
- `POST /api/verify` `{ destinationId, rating, note }`
- `POST /api/passkey/register-options` / `/register-verify` / `/login-options` / `/login-verify`
