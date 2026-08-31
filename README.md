# SEAL — AI-Powered Trip Maker for Disabled People (Review 1 build)

## Run it
```bash
npm install
npm start
```
Open http://localhost:3000

## What's here (Review 1 / Phase 1)
- Accessibility toolbar: high contrast, text size, voice search, read-aloud
- Accessible Trip Finder: filterable trip cards (wheelchair/sensory/veg/pet/sign-language)
- Assistant chat widget (rule-based stub, calls `/api/assistant`)
- Assistance-request API for checkout (`/api/assistance-request`)

See `REVIEW1_REPORT.md` for the problem statement, scope, research summary, methodology,
and timeline write-up for your review document.

## API
- `GET /api/destinations?wheelchair=true&sensory=true...`
- `GET /api/destinations/:id`
- `POST /api/assistance-request` `{ name, email, destinationId, needsAssistance, notes }`
- `POST /api/assistant` `{ message }`
