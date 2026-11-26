---
name: gilt-ladder
description: Builds a UK gilt ladder that funds a client's year-by-year cash needs (e.g. essential expenditure from a cash flow model or CFM report) and reports the capital needed today, the after-tax IRR, the gilt and nominal for each payout, and a funding check that every payout is covered. Use when the user wants gilts to pay out each year to meet known future spending, asks how much capital a gilt ladder needs, or asks for a ladder's IRR. Runs a tested calculator script — never do gilt arithmetic by hand.
---

# Gilt ladder

This skill runs the Gilt Terminal ladder engine (`scripts/ladder.mjs`) on a client's payout schedule. The script does all the maths: coupon schedules, accrued interest, ex-dividend rules, coupon tax (including UK bands and the accrued income scheme), sizing, IRR and the funding check. Your job is to build the input correctly, run the script, and report its output faithfully.

The user is a regulated financial adviser using this for their own client work. Treat the output as a calculation for the adviser to review, not as advice to the client.

## Rules

- **Never calculate gilt figures yourself** (prices, accrued, yields, IRR, capital). Only report what the script prints. If a number is needed that the script doesn't produce, say so.
- **Don't add inflation twice.** Cash flow model figures are normally already inflated to each year's money: pass them as they are with `inflation` 0 (the default). Only set `inflation` if the user says the amounts are in today's money.
- **Anonymise.** Put no names, addresses or other personal details in the input file; use a reference such as "Client A" in `clientRef`.
- **Neutral language.** Describe the ladder as "the gilts that match the selection rule". Don't call any gilt "best", "recommended" or "suitable". Suitability is the adviser's judgement.
- **Show the price date** and any warnings from the script every time.

## Workflow

1. **Get the payout schedule.** Read the year-by-year amounts from the user's document (e.g. essential expenditure for years 1–10 of a CFM report). Show the user the list you extracted and confirm it before running.
2. **Confirm when each year's money is needed** (a date or month per payout). If the report only gives years, ask; suggest the start of each plan year. Each gilt must mature on or before its payout date, so later dates allow more choice.
3. **Account and tax.** Ask which wrapper holds the gilts:
   - `GIA`: coupons are taxed. Prefer `{"otherIncome": …, "otherSavings": …}`, the client's other taxable income a year (pensions, earnings, rental) and other savings interest, so tax is worked out by UK band. Otherwise use `{"band": "basic"|"higher"|"additional"}` (applies the 2026/27 rate and the higher savings rates from 6 April 2027) or a flat `{"rate": 0.4}` as a last resort.
   - `ISA` / `SIPP`: coupons untaxed. Note for a SIPP that withdrawals are taxed separately; that isn't modelled.
4. **Prices.** The script fetches the current DMO reference prices from the Gilt Terminal site (gilt-terminal.vercel.app, refreshed each weekday evening). If it can't, for example because the sandbox has no network access, it uses the copy bundled with the skill and says so in the warnings. The report always states the price date and source; it warns if prices are more than 4 days old. Tell the user if the bundled copy was used. If they have dealing (offer) prices from their platform, put them in `"prices": {"EPIC": clean}`. A `gilt-prices.json` they upload can be passed with `--prices`.
5. **Write the input file** (format below) and run, from the directory containing this SKILL.md:

   ```bash
   node scripts/ladder.mjs input.json --json result.json --csv ladder.csv
   ```

   If it exits with "Input problems", fix the input and run again. Don't work around a validation error by changing the client's figures.
6. **Report**, in this order:
   - capital required today and the after-tax IRR
   - whether every payout is covered
   - the gilt table
   - the funding check
   - the warnings, verbatim
   - the basis lines

   Offer `ladder.csv` / `result.json` as files. If the script says the tax "did not settle", re-run with `"selection": "lowCoupon"` before presenting figures.

## Input format

```json
{
  "clientRef": "Client A",
  "liabilities": [
    { "date": "2027-06", "amount": 30750 },
    { "date": "2028-06-15", "amount": 31519 }
  ],
  "account": "GIA",
  "tax": { "otherIncome": 40000, "otherSavings": 0 },
  "sizing": "couponOffset",
  "selection": "lowCoupon",
  "cashRate": 0,
  "windowMonths": 12,
  "incrementGBP": 100,
  "inflation": 0,
  "settlement": "2026-11-27",
  "prices": { "TS27": 99.90 },
  "dealingCosts": { "perTrade": 0, "percent": 0 },
  "benchmarkCashRate": 0.035,
  "choices": { "2027-06-01": "T27A" }
}
```

Only `liabilities` (and `tax` for a GIA) are required. Defaults and meanings:

| Field | Default | Meaning |
|---|---|---|
| `liabilities` | — | One entry per payout: `date` as YYYY-MM (1st of month) or YYYY-MM-DD, `amount` in £ already in that year's money. |
| `account` | `GIA` | `GIA`, `ISA` or `SIPP`. |
| `tax` | — | GIA only: `otherIncome`/`otherSavings` (UK bands), `band`, or `rate`. |
| `sizing` | `couponOffset` | `couponOffset` = minimum capital: coupons received before each payout count towards it. `simple` = each redemption alone covers its payout; coupons are surplus. |
| `selection` | `lowCoupon` for GIA, `netYield` otherwise | Which gilt to use when several mature in the window. |
| `cashRate` | `0` | Interest assumed on coupons and redemptions held as cash until the payout. 0 is conservative. |
| `windowMonths` | `12` | A gilt may mature up to this many months before its payout (widened automatically if none). |
| `incrementGBP` | `100` | Nominal is rounded up to this. |
| `inflation` | `0` | Only if amounts are in today's money. |
| `settlement` | next business day | Purchase settlement date. |
| `prices` | — | Clean price overrides per EPIC, e.g. platform offer prices. |
| `dealingCosts` | none | Added to capital; IRR also shown net of them. `percent` 0.1 means 0.1%. |
| `benchmarkCashRate` | — | Adds a comparison with a cash deposit at this net rate. |
| `choices` | — | Use a specific gilt for a payout (key = payout date YYYY-MM-DD, value = EPIC). Each rung's `alternatives` in `result.json` lists the other gilts in its window. |

## Reading the output

- **Capital required today**: the cost of all the gilts at the DMO mid dirty price (clean plus accrued) at settlement. Dealing prices are usually slightly higher; use `prices` or `dealingCosts` to reflect them.
- **Portfolio IRR after tax**: the annual effective return on the ladder's own cash flows (purchase, after-tax coupons, redemptions). It excludes interest on cash held between payouts.
- **Funding check**: each coupon and redemption is assigned to the first payout on or after it. A surplus of a few pounds is rounding to the nominal increment. "SHORT" or "not funded" must be raised with the user.
- **Days early**: how long the redemption sits in cash before the payout.
- **Tax by tax year** (band mode): the client's tax on the ladder's coupons, assuming their other income stays the same each year.

## Limitations to mention when relevant

- Prices are DMO end-of-day mid prices, not live dealing prices.
- UK bank holidays aren't modelled for settlement or ex-dividend dates.
- Coupon tax is deducted when the coupon is paid (in reality it's paid through self-assessment later). Band mode doesn't model dividends, Scottish non-savings rates, marriage allowance, pension or gift-aid band extensions, or changes in other income between years. Rates from 2027/28 follow the Autumn Budget 2025 savings rates.
- Payouts after the longest conventional gilt can't be funded and are listed as "not funded".
- Conventional gilts only: the ladder doesn't hedge inflation beyond the amounts entered.
