#!/usr/bin/env bash
# 每日刷新（cron 06:30）：国家队赛事 + 在赛联赛。参数原样传给 refresh（如 --sims 2000）。
set -u
cd "$(dirname "$0")/.." || exit 1
exec node engine/cli.js refresh "$@"
