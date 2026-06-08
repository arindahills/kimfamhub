# ADR-002: FastAPI + Vanilla JS PWA (Current), React (Future)
## Status: Accepted
## Context: KimFam Hub started as a single-file PWA for fast iteration. FastAPI was chosen over Flask for async support (SSE, background tasks). React is deferred to Phase 2; current frontend is Vanilla JS in index.html.
## Decision: FastAPI + Gunicorn (2 UvicornWorkers) serving both API and HTML. React migration planned after feature set stabilises.
## Consequences: Fast iteration now; technical debt in large index.html file; React migration will require separate build pipeline and Cloudflare Pages deploy.
