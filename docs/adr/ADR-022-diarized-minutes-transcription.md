# ADR-022: Diarized Meeting Transcription (Deepgram) + Full-Call Recording

## Status: Accepted

## Context
KimFam meeting minutes were persistently wrong and needed heavy manual correction every meeting. Root-cause audit of KIM 015/2026 (meeting id 16) found:
1. The in-app "conductor recording" captured only the presenter's microphone (`getUserMedia` + `echoCancellation: true`, 24 kbps). Remote participants — the treasurer, and the shared farm device that carries Dad (Israel), Solomon, and sometimes Mum — were never in the recording. A 2h22m meeting yielded only ~15 min of usable audio, all Hillary. Helen's treasurer report and Max's investment analysis were 100% absent.
2. Minutes therefore fell back on the garbled Tactiq transcript, which labels every shared-device speaker as one "KIMFAM INVESTMENT CLUB" — so Dad's voice was scattered across other members.
3. The narrative map-reduce used Haiku for the fidelity-critical per-chunk extraction (MAP), mangling figures/attributions before Sonnet (REDUCE) ever saw raw text.
4. No speaker diarization existed anywhere, so even clean audio could not be attributed.

## Decision
1. **Recording captures the whole call.** `MeetingConductor.startRecording` now requests the Google Meet **tab audio** via `getDisplayMedia` (video requested for the picker, then dropped) and mixes it with the presenter's mic through a Web Audio `MediaStreamDestination`, recorded at 64 kbps. Falls back to mic-only (with a warning) if the presenter does not share tab audio, or if the AudioContext cannot be resumed. Requires the presenter to tick "Share tab audio" once per meeting.
2. **Deepgram is the primary transcription provider, with speaker diarization.** New `_transcribe_deepgram()` (nova-3, `diarize=true`, `utterances=true`) returns `[Speaker N] ...` turns. Groq Whisper remains the fallback when `DEEPGRAM_API_KEY` is unset or Deepgram fails/times out (300 s cap). Provider selection: Deepgram -> Whisper.
3. **MAP extraction upgraded Haiku -> Sonnet** and made **concurrent** (bounded ThreadPoolExecutor, max 2) so MAP wall-clock stays low and MAP + REDUCE stays under the 1800 s nginx `proxy_read_timeout`. Cap is 2 (not higher) because the MAP calls shell out to the Claude CLI which shares `~/.claude`; a live 2-way concurrent run was verified clean on the box.
4. **Speaker-attribution context** added to the narrative prompt: office-bearer roles (from `club_office_bearers`) + the rule that "KIMFAM INVESTMENT CLUB" is the shared farm device (Dad/Solomon/Mum), instructing the writer to use the diarized `[Speaker N]` turns to separate them and to write "a member" rather than guess.

## Consequences
- Better: the recording finally contains every participant; diarization separates the shared-device voices that Tactiq physically cannot; Sonnet MAP + attribution context sharply reduce the attribution/figure errors.
- Worse / watch: one extra click per meeting (Share tab audio); a new external dependency and key (`DEEPGRAM_API_KEY`, ~$0.26/hr diarized, $200 free credit ≈ years — see the STT provider memory + swap table); concurrent Sonnet MAP spawns up to 2 `claude` CLI processes at once; full validation only possible at the next live meeting (KIM 015's audio was already mic-only and cannot be re-captured).
- Swap path if Deepgram ever costs too much: AssemblyAI (same shape), then self-hosted pyannote + Groq Whisper (zero cost). Recorded in the STT provider reference memory.
