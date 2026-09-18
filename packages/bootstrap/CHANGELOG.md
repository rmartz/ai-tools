# Changelog

## [0.9.0](https://github.com/rmartz/ai-tools/compare/bootstrap-v0.8.0...bootstrap-v0.9.0) (2026-09-18)


### ⚠ BREAKING CHANGES

* **bootstrap:** adopt @rmartz/bot-automerge — seed the reusable-workflow caller, retire the inline auto-merge ([#270](https://github.com/rmartz/ai-tools/issues/270))

### Features

* **bootstrap:** adopt @rmartz/bot-automerge — seed the reusable-workflow caller, retire the inline auto-merge ([#270](https://github.com/rmartz/ai-tools/issues/270)) ([d0129f9](https://github.com/rmartz/ai-tools/commit/d0129f996e2fcc48b71ab5f642847f41a9cc15a2))

## [0.8.0](https://github.com/rmartz/ai-tools/compare/bootstrap-v0.7.0...bootstrap-v0.8.0) (2026-09-16)


### ⚠ BREAKING CHANGES

* **bootstrap:** seed repo-hygiene.yml as the reusable-workflow caller ([#261](https://github.com/rmartz/ai-tools/issues/261))

### Features

* **bootstrap:** seed repo-hygiene.yml as the reusable-workflow caller ([#261](https://github.com/rmartz/ai-tools/issues/261)) ([48ec987](https://github.com/rmartz/ai-tools/commit/48ec987a48b13b4cebd711a8cc002faa5c3fdd99))

## [0.7.0](https://github.com/rmartz/ai-tools/compare/bootstrap-v0.6.0...bootstrap-v0.7.0) (2026-09-16)


### ⚠ BREAKING CHANGES

* **bootstrap:** stop seeding stale .eslintignore and retire existing ones (ESLint 10) ([#254](https://github.com/rmartz/ai-tools/issues/254))

### Bug Fixes

* **bootstrap:** stop seeding stale .eslintignore and retire existing ones (ESLint 10) ([#254](https://github.com/rmartz/ai-tools/issues/254)) ([f0b5487](https://github.com/rmartz/ai-tools/commit/f0b5487b4542256a3107f2c422a060d3dd80d52e))

## [0.6.0](https://github.com/rmartz/ai-tools/compare/bootstrap-v0.5.0...bootstrap-v0.6.0) (2026-09-16)


### ⚠ BREAKING CHANGES

* **bootstrap:** machine-enforce gate-before-go-live for the auto-merge workflow ([#249](https://github.com/rmartz/ai-tools/issues/249))

### Features

* **bootstrap:** add a read-only fleet audit of the auto-merge gate ([#246](https://github.com/rmartz/ai-tools/issues/246)) ([56ae0ea](https://github.com/rmartz/ai-tools/commit/56ae0ead739a1da13fff6777d3df477fd28cc10c))
* **bootstrap:** machine-enforce gate-before-go-live for the auto-merge workflow ([#249](https://github.com/rmartz/ai-tools/issues/249)) ([1b81ef5](https://github.com/rmartz/ai-tools/commit/1b81ef5948e8cdbed155354a30a4b4f1c63cb7db))
* **bootstrap:** seed a golden-sync workflow so golden updates reach the fleet without re-bootstrap ([#250](https://github.com/rmartz/ai-tools/issues/250)) ([dfff939](https://github.com/rmartz/ai-tools/commit/dfff939a68cd9f498c82fcd4d4ae04b59af2aa23))

## [0.5.0](https://github.com/rmartz/ai-tools/compare/bootstrap-v0.4.0...bootstrap-v0.5.0) (2026-09-16)


### ⚠ BREAKING CHANGES

* **bootstrap:** provision the auto-merge gate via a Ruleset, not classic branch protection ([#241](https://github.com/rmartz/ai-tools/issues/241))

### Features

* **bootstrap:** provision the auto-merge gate via a Ruleset, not classic branch protection ([#241](https://github.com/rmartz/ai-tools/issues/241)) ([213635c](https://github.com/rmartz/ai-tools/commit/213635c88c687e9ccaaf71b81438186678776027))

## [0.4.0](https://github.com/rmartz/ai-tools/compare/bootstrap-v0.3.1...bootstrap-v0.4.0) (2026-09-15)


### ⚠ BREAKING CHANGES

* **pr-review:** narrow merge-safety label triggers to `breaking change` + skip closed/merged PRs ([#230](https://github.com/rmartz/ai-tools/issues/230))
* **config:** stop seeding .git-worktrees/ into golden ignore files ([#223](https://github.com/rmartz/ai-tools/issues/223))

### Features

* **bootstrap:** confirm/apply squash-merge setting in the auto-merge gate + refresh /bootstrap skill ([#227](https://github.com/rmartz/ai-tools/issues/227)) ([379d499](https://github.com/rmartz/ai-tools/commit/379d4998f0403bba0f7582f6ad7880f7a4192b46))
* **bootstrap:** enforce conventional-commit subjects on main — squash-title verifier + post-merge tripwire ([#225](https://github.com/rmartz/ai-tools/issues/225)) ([8f68126](https://github.com/rmartz/ai-tools/commit/8f68126ffd86d123325031d442da3761e1d71747))


### Bug Fixes

* **pr-review:** narrow merge-safety label triggers to `breaking change` + skip closed/merged PRs ([#230](https://github.com/rmartz/ai-tools/issues/230)) ([a1d576a](https://github.com/rmartz/ai-tools/commit/a1d576a05b1092e5bbef76176c68b4a49d50d6a1))


### Miscellaneous Chores

* **config:** stop seeding .git-worktrees/ into golden ignore files ([#223](https://github.com/rmartz/ai-tools/issues/223)) ([0df22f7](https://github.com/rmartz/ai-tools/commit/0df22f74e244de6e25a2726f73ce7f0b40255a3b))

## [0.3.1](https://github.com/rmartz/ai-tools/compare/bootstrap-v0.3.0...bootstrap-v0.3.1) (2026-09-15)


### Bug Fixes

* **deps:** use caret ranges for internal [@rmartz](https://github.com/rmartz) dependencies ([#221](https://github.com/rmartz/ai-tools/issues/221)) ([15d5da6](https://github.com/rmartz/ai-tools/commit/15d5da650020ee499b18054ecceb56aed94bfd99))

## [0.3.0](https://github.com/rmartz/ai-tools/compare/bootstrap-v0.2.0...bootstrap-v0.3.0) (2026-09-14)


### ⚠ BREAKING CHANGES

* **bootstrap:** manage golden workflow files + Dependabot auto-merge gate verifier ([#196](https://github.com/rmartz/ai-tools/issues/196))

### Features

* **bootstrap:** manage golden workflow files + Dependabot auto-merge gate verifier ([#196](https://github.com/rmartz/ai-tools/issues/196)) ([6df44f9](https://github.com/rmartz/ai-tools/commit/6df44f9de3bf8aa7d0d62d3ae3c85729ac245221))

## [0.2.0](https://github.com/rmartz/ai-tools/compare/bootstrap-v0.1.1...bootstrap-v0.2.0) (2026-09-14)


### Features

* complete repo/cwd targeting across every ai-* CLI ([#179](https://github.com/rmartz/ai-tools/issues/179)) ([7606572](https://github.com/rmartz/ai-tools/commit/7606572257cfd98fd36174c2320ccec9fe8441fb))
