# Voice File Setup — Quick Reference

## Order of operations

1. **Install Wispr Flow** (Mac App Store, free) — voice → text dictation
2. **Create a Voice folder** on your Mac (e.g. `~/Documents/Voice`)
3. **Open a fresh Claude desktop chat** — Opus 4.7, Extended Thinking ON
4. **Paste `prompt-1-interview.txt`** → answer all 100 questions via Wispr Flow (~90 min)
5. Save the resulting markdown dump as `voice_archive.md`
6. **In the same chat, paste `prompt-2-compile.txt`** → outputs compressed about-me file
7. Save as `jay.md` (or `[your_name].md`) into your Voice folder
8. **Test in a blank Claude chat** (no folder mounted) — paste the file inline, run a writing task, verify it sounds like you
9. **Mount Voice folder to Cowork** — file gets read on every turn automatically
10. **Install Obsidian** (free, optional) — point it at Voice folder for easy editing

## Files in this folder

- `prompt-1-interview.txt` — the 100-question Taste Interviewer prompt
- `prompt-2-compile.txt` — the Voice Compiler prompt that compresses the dump
- `README-voice-setup.md` — this file

## Why a fresh chat (not this one)

This Cowork session already has loaded plugins, system context, and prior turns. The interview needs ~2 hours of clean context to work properly. Open a new chat for the interview, then come back to Cowork once the file is built.

## Portability

Same `jay.md` file works in ChatGPT, Gemini, Grok — upload as standing instructions or paste at the top of a session. One source of truth across all AIs.
