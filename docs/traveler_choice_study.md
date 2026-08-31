# Traveler choice study and extension gate

This is a small directional product test, not statistical proof. It asks whether
Connection Risk can change a real booking preference and whether travelers
understand the trade-off without being told what to choose.

## Before recruiting participants: validate local ADRR

After running the documented `first-adrr-run` workflow, validate the product claims:

```bash
connection-risk validate-adrr-product \
  --dataset data/processed/adrr_flights.parquet \
  --routes BER-IST,BER-BUD \
  --min-samples 30 \
  --json-output benchmark/output/adrr_product_validation.json
```

The report must show the actual source, sample counts and match levels. For the
inspected ADRR Flights schema, zero passenger flight numbers and unavailable
exact-flight matching are expected. A route is suitable for the product test only
when it reaches the configured minimum and reports `match_level=route`; the UI must
not relabel this as exact-flight evidence.

If neither target route is supported, select a route inventoried by the ADRR
benchmark rather than lowering the safety threshold silently.

## Participants

Recruit 5–8 adults who have personally compared or booked an international
one-stop itinerary in the last two years. Do not collect names, emails, passport
details, booking references or loyalty-account information.

Ask each participant to use a fresh study round at:

```text
http://127.0.0.1:8000/demo?study=1
```

Do not explain which flight is safer before they complete step one.

## Flow

1. Participant chooses between the lower fare and larger-buffer option without
   Connection Risk labels.
2. The page reveals risk badges, separate-ticket status and the `Why this risk?`
   drawer.
3. Participant makes a final choice.
4. Participant answers one comprehension question: the safer option costs more
   and takes longer but lowers estimated miss risk; it does not guarantee success.
5. Researcher selects **Start next participant**.
6. After the last participant, select **Export anonymous CSV**.

Responses stay in that browser's local storage until explicitly cleared. The CSV
contains choices, interaction booleans, comprehension and completion time only.

## Gate for extension work

Proceed with the compact Google Flights integration only when all are true:

- at least 5 completed responses;
- at least 80% answer the trade-off comprehension question correctly;
- at least 2 participants who initially chose the lower fare switch to the safer
  option after risk is revealed;
- at least half open risk details or the safer-option comparison;
- no participant describes the risk estimate as a guarantee after the task.

With such a small sample, report counts rather than significance or broad
conversion claims. If the gate fails, review the observed confusion and iterate on
the playground before changing the extension.

## Extension scope after the gate

Reuse only the compact pieces that proved useful: inline LOW/MODERATE/HIGH badge,
separate-ticket warning, scheduled-versus-practical buffer, top reasons, confidence,
and a link to compare a safer result when one is actually present. Keep unsupported
parsing explicit and do not inject a large dashboard into Google Flights.
