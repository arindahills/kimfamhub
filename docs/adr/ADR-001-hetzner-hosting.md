# ADR-001: Hetzner VPS as Production Host
## Status: Accepted
## Context: KimFam Hub needed an affordable, always-on Linux host with SSH access, a public IP, and no cold-start latency. Serverless options (Vercel, Render free tier) have cold starts incompatible with SSE streaming.
## Decision: Hetzner CX11 VPS at 89.167.121.193, Ubuntu 22.04, behind Nginx SSL proxy. Deployed via git pull + systemctl restart.
## Consequences: Full control over server; ~4 EUR/month cost; requires manual failover if VPS goes down; no auto-scaling.
