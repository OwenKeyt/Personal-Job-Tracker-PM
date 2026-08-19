# pm-watch

Personal alerter for Summer 2027 PM (and optionally data science) internships.
Filtered for one person: bachelor's candidate, class of 2028.

**What it is:** a diff-and-push layer on top of trackers that already scrape well.
**What it isn't:** a scraper, a public list, or a competitor to Simplify.

## Setup (~10 minutes)

1. **Create a repo** and drop these files in. Private is fine (2,000 free Actions
   minutes/month covers a 30-minute cron with room to spare; public is unlimited).

2. **Pick an ntfy topic.** Any string, but it's the *only* thing protecting your
   feed — anyone who guesses it can read your alerts. Use something random:
   ```
   openssl rand -hex 8
   ```
   Install the ntfy app (iOS/Android), subscribe to that topic. No account needed.

3. **Add the secret.** Repo → Settings → Secrets and variables → Actions → New
   repository secret, named `NTFY_TOPIC`, value = your topic string.

4. **Run it once manually.** Actions tab → pm-watch → Run workflow. The first run
   seeds `state/seen.json` with everything currently open and deliberately sends
   *nothing* — otherwise you'd get 36 notifications in one burst. Every run after
   that only alerts on genuinely new postings.

5. **Read what it seeded.** Open `state/seen.json` after that first run. Those are
   roles that are already live and that you have not applied to.

## Local testing

```bash
node check.mjs          # no NTFY_TOPIC set = dry run, prints what it would send
node test/run.mjs       # parser + filter against a fixture
```

## Tuning

Everything lives in `config.json`.

- **Too quiet?** Add `"ds"` to `categories` to pull in the data science section.
- **Too noisy?** Tighten `includeTitle`, or set `locationAllow`.
- **Wrong drops?** Run `node check.mjs` locally — the dry run prints a reason for
  every rejection, so you can see exactly which rule ate a role you wanted.

`excludeAdvancedDegree` is the filter doing the most work. A meaningful share of
"PM Intern" reqs at large companies are MBA-only, and upstream flags them with a
graduate-cap emoji that no public list filters on for you.

## Honest limitations

- **Latency is bounded by upstream, not by you.** They refresh hourly-ish; you
  poll every 30 minutes. Realistic worst case is a couple of hours behind the
  actual posting. GitHub's cron also runs late under load — treat "30 minutes"
  as "usually under an hour."
- **Coverage is upstream's coverage.** Roughly 36 PM roles today. Anything they
  miss, you miss. That's the trade for not maintaining scrapers.
- **The tracker ecosystem is tech-only.** Product internships at fintech, CPG,
  media, and health companies mostly never appear in these repos, and several of
  those skew friendlier to a liberal-arts applicant than FAANG APM does. The
  calendar entries include a recurring nudge to sweep those by hand.
- **`programs.json` dates are mixed quality.** Entries marked `confirmed live`
  or `reported` are grounded. The ones marked `estimate — verify` are guesses
  from the general August–November cycle; replace them with real per-company
  dates when you have ten minutes.

## The part that matters more than the code

Applications for Summer 2027 PM roles opened in August 2026 and run through
November. Several are live right now. Google APM reportedly runs a 2–4 week
window in mid-October and closes; it's roughly 40 seats against ~8,000
applicants. Nearly all of these are rolling.

This tool is worth about a weekend. Spending three weeks polishing it while the
window is open would be a bad trade, and it's the most likely way this project
fails. Ship it, then go apply.
