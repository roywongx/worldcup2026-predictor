# CLAUDE.md — World Cup 2026 Predictor Development Guide

## Development Methodology

This project follows the **Superpowers** development methodology:

### Before Any Code Change
1. **Brainstorm first** — Use `/brainstorming` skill to explore requirements before coding
2. **Write a plan** — Use `/writing-plans` skill for multi-step tasks
3. **Test-driven** — Use `/test-driven-development` skill: write test, verify red, implement, verify green

### Before Claiming Completion
4. **Verify before completion** — Use `/verification-before-completion` skill:
   - Run verification commands and confirm output
   - Never claim "done" without evidence
   - No "should work" or "probably fixed"

### When Debugging
5. **Systematic debugging** — Use `/systematic-debugging` skill:
   - Always find root cause before attempting fixes
   - No random fixes or symptom patches
   - Complete all 4 phases before proposing solutions

## Project-Specific Rules

### Data Validation
- Always run `validateData()` after changing team data or match schedule
- Cross-reference match dates with FIFA official schedule
- Verify flag codes: England=gb-eng, Scotland=gb-sct

### Model Changes
- Run backtest (2022 WC) after any model parameter change
- Check score distribution: 1-1 should be <40% of most-likely scores
- Check total λ average: target 2.5-3.0
- Check draw rate: target 20-28%

### Code Quality
- Single-file HTML: keep all JS inline, no external dependencies
- i18n: all user-facing strings must have zh/en translations
- Technical terms (API, RPS, Dixon-Coles) stay English in both languages

### Testing
- Test simulation: `runSimulation()` should complete without errors
- Test validation: `validateData()` should return 0 errors
- Test Monte Carlo: `runMonteCarloUI()` should complete 10,000 sims
- Test backtest: `runBacktest()` should return results for 30+ matches

## Available Skills

| Skill | Use When |
|-------|----------|
| `/verification-before-completion` | Before claiming work is done |
| `/systematic-debugging` | When encountering any bug |
| `/brainstorming` | Before creating features |
| `/test-driven-development` | Before implementing features |
| `/taste-skill` | When optimizing UI design |
