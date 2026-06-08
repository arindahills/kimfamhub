# ADR-004: Cloudflare R2 for Documents and Media
## Status: Proposed
## Context: Meeting minutes, receipts, expenditure photos, and project documents were stored directly on the Hetzner filesystem. This does not scale and is lost if VPS is reprovisioned. GitHub is not appropriate for binary blobs.
## Decision: Migrate all docs/media to Cloudflare R2 bucket (same Cloudflare account as kimfamhub.com, same as DSN). 10GB free tier, zero egress fees. Serve via R2 public URL or Cloudflare CDN.
## Consequences: No egress cost; CDN-cached static assets; app must be updated to use R2 URLs; initial migration effort required; .gitignore already excludes these paths from repo.
