---
name: model-arbitrage
description: >-
  Route each task to the cheapest model that can do it reliably, and escalate
  to a stronger model only when the task genuinely requires it. Use on every
  task to decide the right tier. Triggers for escalation: irreversible actions,
  financial or security decisions, public-facing copy, ambiguous multi-step
  work, or repeated failure of the cheap tier. Do NOT escalate routine tool
  work, drafting, or research — that stays on the default model.
---

# Model Arbitrage — right model for each task

Hermes runs on a **cheap, proven default** and escalates only when the task's
stakes or difficulty justify the cost. This skill is the judgment layer; the
config (`config.yaml`) provides the fallback safety net automatically.

## The tiers

| Tier | Model | Cost (blended $/M) | Use for |
|------|-------|--------------------|---------|
| **Default** | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | ~$0.66 | The bulk of turns: tool work, terminal, file ops, code, web, memory, drafting, research. |
| **Escalate** | Best available Anthropic Sonnet above Haiku | higher | Ambiguous multi-step tasks; public-facing copy drafts; anything where a wrong answer is worse than a refusal. Prefer Sonnet 5 if present; otherwise the newest Sonnet Hermes can actually resolve. Verify with `/model <id> --once` before relying on it. |
| **High-stakes** | Best available Anthropic Opus (`Opus 4.8` preferred) | highest | Irreversible actions; financial or security decisions; unreviewed public publication. Prefer Opus 4.8 (best measured calibration — abstains rather than fabricates). If Hermes cannot resolve it, escalate to the strongest Opus that answers a throwaway call. Do NOT use Opus 5 if available — it regressed on calibration vs 4.8. |
| **Fallback** | `kimi-k3` via `kimi` | automatic | Provider failure only. Configured in `fallback_providers`. Not a choice. (kimi-k2 / kimi-k2.6 do not resolve on this install.) |

## When to escalate (and when NOT to)

**Escalate one tier when ANY of these is true:**
- The action is **irreversible** or hard to undo (publishing, deleting, sending, spending money).
- It touches **money, security, credentials, or legal/public claims**.
- It is **public-facing copy** going out under the CitizenProof name without a human review pass.
- The task is **genuinely ambiguous** — a reasonable person could do it two different ways and the choice matters.
- The **cheap tier has already failed this task twice** — stop retrying, go up.

**Do NOT escalate for:**
- Routine tool calls, terminal commands, file reads/writes, web search, memory.
- First drafts, exploration, research, summarizing retrieved material.
- Anything you (Hermes) can verify with a tool before asserting.

**Rule of thumb:** escalate on *stakes and ambiguity*, never on *volume*. A long
task is not automatically a hard task.

## How to escalate

Use Hermes' native one-turn override so the strong model handles only the turn
that needs it, then the session returns to the default:

```
/model <strong-model> --once
```

For a sustained hard session, switch for the session instead of one turn. Keep
the default cheap — escalation is the exception, not the rule.

## Hallucination discipline (applies at every tier)

Model choice is the *smallest* lever. These matter more and cost nothing:

1. **Cite before you assert.** Quote the retrieved file, doc, or search result
   for any factual claim. If you can't point to a source, say so.
2. **Verify with a tool.** If a claim can be checked (a URL, a file, a number),
   check it rather than trust memory.
3. **Abstain over fabricate.** "I don't know / I couldn't verify that" is a
   better answer than a confident guess, especially for CitizenProof.
4. **Route low confidence up.** If you're not sure, that's an escalation
   trigger — treat it like ambiguity.

## CitizenProof

For CitizenProof, judgment and positioning decisions route to **Kern** via the
`consult-gateway` skill — that is a separate channel from model tiers. Model
arbitrage governs *how Hermes executes*; consult-gateway governs *what Kern
decides*. A task can be low-tier (cheap model) and still warrant a Kern consult
(on positioning), or high-tier (strong model) on a decision Hermes owns.
