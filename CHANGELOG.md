# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-08-20

Initial release as a dsh (DeepSeek Harness) bundle.

### Added

- Conversational bookkeeping: record expenses/income via `bookkeeping_add`
  with strict amount validation, natural-language dates, and auto category
  detection.
- SQLite ledger with exact integer minor-unit storage (WAL mode).
- Built-in categories with keyword auto-classification and custom rules.
- Reports: daily / monthly / category / trend, filterable by month, range,
  category, type and tag.
- Exports: RFC 4180 CSV and self-contained HTML.
- Monthly budgets (overall or per category) with near-limit and over-budget
  warnings at record time.
- Nine model-callable tools plus a standalone CLI (`dsh-bookkeeping`) with
  identical behavior.
