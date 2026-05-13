#!/bin/bash
set -e

REPO=/home/kilango/Git/vatsim-logbook
PYTHON=/home/kilango/Environments/current/bin/python
LOG=/var/log/vatsim/deploy.log

exec >> "$LOG" 2>&1
echo "--- Deploy started at $(date) ---"

cd "$REPO"
git pull origin master

cd "$REPO/frontend"
npm install --silent
npm run build

cd "$REPO"
sudo supervisorctl restart vatsim

echo "--- Deploy finished at $(date) ---"
