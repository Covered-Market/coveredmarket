## What and why

## How it was checked
- [ ] `bin/coveredmarket test`
- [ ] `bin/coveredmarket e2e` (if the contract changed)
- [ ] `bin/coveredmarket up && bin/coveredmarket e2e-stack` (if a user flow changed)

## Contract changes
- [ ] None
- [ ] Yes: the four invariants in [docs/SECURITY-MODEL.md](../docs/SECURITY-MODEL.md#invariants-to-read-first) still hold, and a deployed contract will need a fresh, locked deploy
