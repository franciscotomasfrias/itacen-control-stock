#!/usr/bin/env bash
# Manda un mensaje al Slack de Francisco via Incoming Webhook.
# Uso: notify-slack.sh "texto del mensaje"
# Lee la URL del webhook de la variable de entorno SLACK_WEBHOOK_URL
# (nunca la recibe como argumento, para que no quede en logs de Actions).
set -euo pipefail

if [ -z "${SLACK_WEBHOOK_URL:-}" ]; then
  echo "SLACK_WEBHOOK_URL no esta seteada, no se puede notificar." >&2
  exit 1
fi

MSG="${1:?Uso: notify-slack.sh \"texto del mensaje\"}"

PAYLOAD=$(jq -n --arg text "$MSG" '{text: $text}')

curl -s --fail --show-error --connect-timeout 5 --max-time 15 \
  -X POST -H "Content-type: application/json" \
  --data "$PAYLOAD" \
  "$SLACK_WEBHOOK_URL" > /dev/null
