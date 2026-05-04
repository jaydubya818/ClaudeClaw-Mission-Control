---
name: meta-ads
description: Pull, summarize, and analyze Meta (Facebook/Instagram) ad performance via the Meta CLI. Used by the daily 7:30 AM ad brief and on-demand by Ops/Research.
triggers: meta ads, facebook ads, instagram ads, roas, ad spend, campaign performance
---

# Meta Ads

V3 transcript ch.6 — the practical example. Wraps the Meta command-line interface with a custom report format.

## When to use
- Daily 7:30 AM scheduled ad brief
- User asks: "how are my ads doing?", "ROAS today?", "should I kill campaign X?"
- Ops or Content needs to reference current ad performance

## Inputs
- `period`: string — `today` | `yesterday` | `7d` | `30d` | `YYYY-MM-DD..YYYY-MM-DD`
- `account_id`: string (optional) — defaults to `META_DEFAULT_ACCOUNT_ID` env var

## Behavior
1. Shell out to `meta-ads-cli report --period {period} --account {account_id} --format json`
2. Parse spend, impressions, clicks, conversions, ROAS per campaign
3. Identify winners (ROAS > 2.0), losers (ROAS < 0.8 with spend > $20)
4. Flag blind spots: campaigns with $0 spend in last 24h, frozen creatives older than 14 days
5. Render as the deliverable below
6. Append one-line summary to `hive_mind` table

## Output format
```
META ADS — {period}
━━━━━━━━━━━━━━━━
SPEND: ${spend} ({delta_vs_prior})
ACTIONS: {conversions}
ROAS: {roas}

🏆 WINNERS (n)
- [{campaign_name}](https://business.facebook.com/...): ${spend} → ROAS {roas}

🔻 LOSERS (n)
- [{campaign_name}](https://business.facebook.com/...): ${spend} → ROAS {roas} — recommend pause

⚠ BLIND SPOTS
- {observation}

QUICK TAKE
{2-sentence Claude analysis: which lever to pull next}
```

## Tools used
- `meta-ads-cli` (must be installed globally: `npm install -g meta-ads-cli`)
- bash

## Cost notes
- meta-ads-cli: free (uses your Meta access token)
- Quick-take generation: Sonnet, ~$0.003 per invocation

## See also
- `skills/nano-banana/SKILL.md` — for generating new ad creatives when this skill flags a loser
- `scheduler/cron.yaml` — `meta_ads_brief` mission fires this skill at 07:30
