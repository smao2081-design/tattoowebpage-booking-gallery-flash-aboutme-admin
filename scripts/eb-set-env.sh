#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/eb-set-env.sh .env.production
# Requires: AWS CLI configured or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars

if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [env-file]"
  exit 1
fi

ENVFILE=${1:-.env.production}
if [ ! -f "$ENVFILE" ]; then
  echo "Env file '$ENVFILE' not found. Create it from .env.production.example and fill values." >&2
  exit 2
fi

if [ -z "${EB_APP_NAME:-}" ] || [ -z "${EB_ENV_NAME:-}" ]; then
  echo "Please set EB_APP_NAME and EB_ENV_NAME environment variables before running." >&2
  echo "Example: EB_APP_NAME=tattoo-app EB_ENV_NAME=tattoo-app-prod $0 $ENVFILE" >&2
  exit 3
fi

NS='aws:elasticbeanstalk:application:environment'

opts=()
while IFS= read -r line || [ -n "$line" ]; do
  # skip comments and empty lines
  line=${line%%#*}
  line=$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  if [ -z "$line" ]; then continue; fi
  if ! echo "$line" | grep -q '='; then continue; fi
  key=${line%%=*}
  val=${line#*=}
  # strip surrounding quotes
  val=$(echo "$val" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
  # skip blank values
  if [ -z "$val" ]; then continue; fi
  opts+=("{\"Namespace\":\"$NS\",\"OptionName\":\"$key\",\"Value\":\"$val\"}")
done < "$ENVFILE"

if [ ${#opts[@]} -eq 0 ]; then
  echo "No variables to set in $ENVFILE" >&2
  exit 0
fi

json='['$(IFS=,; echo "${opts[*]}")']'

echo "Updating Elastic Beanstalk environment '$EB_ENV_NAME' in application '$EB_APP_NAME'..."
aws elasticbeanstalk update-environment \
  --application-name "$EB_APP_NAME" \
  --environment-name "$EB_ENV_NAME" \
  --option-settings "$json"

echo "Done. Elastic Beanstalk will apply the settings and redeploy the environment." 
