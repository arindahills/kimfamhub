# ADR-003: AI Stack — Claude Sonnet + Gemini + Groq Fallback Chain
## Status: Accepted
## Context: Ask KimFam RAG needed a capable LLM with tool-use support. OpenAI was previously used but removed to cut cost to /bin/zsh/month on free tiers. RAG uses local ChromaDB with sentence-transformers embeddings.
## Decision: Claude Sonnet 4.x (primary, via Anthropic API) -> Gemini 2.5 Flash (fallback) -> Groq llama-3.3-70b (final fallback). ChromaDB stores governance doc embeddings locally.
## Consequences: Near-zero AI cost on low volume; Claude API billed on arinda.hillary@gmail.com; embedding model runs on-server (CPU, acceptable latency for this use case).
