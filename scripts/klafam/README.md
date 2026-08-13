# KlaFam module — server-side scripts (source of truth)

The KlaFam ROSCA (tanda) feature has three parts. The **app** part (frontend page +
API endpoints) lives in the normal repo (`frontend/src/pages/KlaFamPage.tsx`,
`main.py`) and deploys via CI. The two parts below run **outside** `/var/www/kimfamhub/`,
so the app CI deploy does not touch them. They are version-controlled here so they
can never again be lost by living only on the server.

> History: the whole module was originally built directly on the server and never
> committed. A CI rsync overwrote the working tree and wiped the app page + endpoints
> (the Postgres data survived). Recovered from the session transcript on 2026-08-13.
> **Rule going forward: nothing lives only on the server — everything is in git.**

## Files

| File | Runs as | Server location |
|---|---|---|
| `klafam_migration.sql` | one-time schema + member seed | applied to Postgres `kimfamhub` |
| `klafam_import.py` | one-time historical data import | run once from `/var/www/kimfamhub` |
| `klafam_reminder.py` | **daily cron** — chases the latest overdue cycle (WhatsApp + Web Push) and auto-creates the current month's cycle | `/opt/klafam_reminder.py`, cron `0 6 * * *` |
| `agent_klafam_section.py` | reference extract of the KlaFam helpers inside the WhatsApp agent | `/opt/whatsapp-agent/orchestrator.py` |

## Due-date convention

A cycle for month **M** is **due on the 28th of the month before M** (e.g. the Aug
cycle is due 28 Jul; the Jan cycle is due 28 Dec of the prior year). This rule is
implemented in three places, all kept in sync:
- `main.py` → `_klafam_due_date()` (+ idempotent `_klafam_fix_due_dates()` at startup)
- `main.py` → `POST /api/klafam/cycles` (create_cycle)
- `klafam_reminder.py` → `_auto_create_cycle()`

## Deploying the cron / agent

These are **not** auto-deployed. To update the running copies, copy the corrected
file to its server location and (for the agent) restart `whatsapp-agent`. Do this
through a reviewed step — never edit the server copy directly, or it drifts from git.
