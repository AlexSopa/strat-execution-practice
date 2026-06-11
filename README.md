# TheStrat Execution Practice

A **100% free**, browser-only trainer for executing TheStrat reversal setups. No account, no API keys, no
backend — synthetic candles generated in your browser, stats saved locally.

**Live app:** `https://<your-github-username>.github.io/strat-execution-practice/`

## What it trains

The five reversal scenarios, long and short:

| Scenario | Pattern (bullish form) | Entry |
| --- | --- | --- |
| 2-2 | 2d → break back up | buy stop over the 2d high + 0.01 |
| 2-1-2 | 2d → inside 1 → break up | buy stop over the inside high + 0.01 |
| 3-1-2 | outside 3 → inside 1 → break against the 3 | buy stop over the inside high + 0.01 |
| 1-2-2 | inside 1 → 2d → break back up | buy stop over the 2d high + 0.01 |
| 3-2-2 | outside 3 → 2d → break back up | buy stop over the 2d high + 0.01 |

Three skills are graded on every trade:

1. **Entry** — pre-place the stop order at the trigger, on the right side, before the break. Letting a
   failed setup go unfilled counts in your favor.
2. **Stops** — initial stop matches your declared style (**spread + 0.01** at the trigger bar's far extreme,
   or **setup stop** at the pattern extreme) and is never widened.
3. **Management** — trail the stop under each successive 2u low (over each 2d high in shorts) as price runs
   2u-2u-2u, hold winners, and add only at fresh actionable signals (inside-bar breaks, pullback reversals).

Hammers, shooters, and dojis are classified and labeled — reversal setup bars are biased toward the shapes
that support them, so shape-reading is part of every drill.

## Modes

- **Replay trainer** — bar-by-bar replay with hidden future. Place stop entries, choose your stop style,
  trail manually (no auto-trailing — discipline *is* the drill), add to winners, and get an end-of-session
  report card scoring Entry / Stops / Management with per-trade notes. Sessions are seeded: share a seed to
  practice the same tape.
- **Pattern quiz** — fast reps: name the armed scenario (or "no setup"), pick the side, click the exact
  trigger level. Your most-missed scenarios get served more often.
- **My stats** — local history of quiz accuracy and session report cards.

## Run locally

```bash
npm install
npm run dev      # local dev server
npm test         # engine unit tests (classification, detection, fills, grading)
npm run build    # production build
```

## Deploy your own (free)

1. Fork or push this repo to GitHub.
2. In repo **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main` — the included workflow tests, builds, and deploys automatically.

If your repo name isn't `strat-execution-practice`, change `base` in `vite.config.ts` to match.

## How it works

Everything is deterministic and client-side: a seeded generator builds regime-switching candles with the
five scenarios (and decoy near-misses) injected at controlled frequency. Every bar carries an intrabar path
— the order it visited its high and low — so entry fills, tight-stop wick-outs, and stop-vs-target races
inside a single bar resolve realistically. The grader replays your stop history against the bars to score
trailing discipline.

## Disclaimer

Educational practice tool only. Synthetic data. Not financial advice.
