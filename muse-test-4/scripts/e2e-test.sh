#!/usr/bin/env bash
#
# Run the deployed-stack tests (app/tests/integration/test_deployed.py) as a
# throwaway Cognito user, deleted on exit.
#
#   scripts/e2e-test.sh            # after `npx cdk deploy`
#   scripts/e2e-test.sh -k memory  # extra args go to pytest
#
set -euo pipefail
cd "$(dirname "$0")/.."

stack="${STACK:-MuseTest4Stack}"
output() {
  aws cloudformation describe-stacks --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
url="$(output Url)"
pool="$(output UserPoolId)"
client="$(output UserPoolClientId)"

user="muse-e2e-$(date +%s)@example.com"
password="E2e-$(openssl rand -hex 12)!"
aws cognito-idp admin-create-user --user-pool-id "$pool" --username "$user" --message-action SUPPRESS >/dev/null
trap 'aws cognito-idp admin-delete-user --user-pool-id "$pool" --username "$user"' EXIT
aws cognito-idp admin-set-user-password --user-pool-id "$pool" --username "$user" --password "$password" --permanent
token="$(aws cognito-idp initiate-auth --client-id "$client" --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters "USERNAME=$user,PASSWORD=$password" --query AuthenticationResult.AccessToken --output text)"

cd app
MUSE_URL="$url" MUSE_TOKEN="$token" uv run pytest -m deployed -v -s "$@"
