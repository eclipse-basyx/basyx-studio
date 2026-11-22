#!/bin/sh
# Adds the example's AAS content to the BaSyx environment: the climate
# sensor's shell, its Time Series Data submodel, the concept descriptions
# that name the units, and the CSV of the ExternalSegment. Content that
# exists already (HTTP 409) is kept, so the stack can restart.
set -eu

BASYX_URL="${BASYX_URL:-http://basyx:5004}"
SUBMODEL_ID='https://example.org/basyx-studio/time-series/sm/ClimateSensorTimeSeries'

echo "Waiting for ${BASYX_URL}"
for _ in $(seq 1 90); do
  curl -sf -o /dev/null "${BASYX_URL}/description" && break
  sleep 2
done
curl -sf -o /dev/null "${BASYX_URL}/description" || { echo "BaSyx did not answer" >&2; exit 1; }

post () {
  status="$(curl -s -o /tmp/answer -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "@/seed/$2" "${BASYX_URL}$1")"
  case "${status}" in
    201|409) echo "POST $1 ($2): ${status}" ;;
    *) echo "POST $1 ($2) failed with ${status}: $(cat /tmp/answer)" >&2; exit 1 ;;
  esac
}

post /concept-descriptions concept-description-temperature.json
post /concept-descriptions concept-description-humidity.json
post /submodels submodel.json
post /shells shell.json

# AAS identifiers in paths are base64url-encoded without padding.
encoded="$(printf '%s' "${SUBMODEL_ID}" | base64 | tr '+/' '-_' | tr -d '=\n')"
status="$(curl -s -o /tmp/answer -w '%{http_code}' -X PUT \
  -F 'fileName=commissioning.csv' -F 'file=@/seed/commissioning.csv;type=text/csv' \
  "${BASYX_URL}/submodels/${encoded}/submodel-elements/Segments.ExternalSegment.File/attachment")"
case "${status}" in
  200|204) echo "PUT attachment: ${status}" ;;
  *) echo "PUT attachment failed with ${status}: $(cat /tmp/answer)" >&2; exit 1 ;;
esac
echo "Seeded the climate sensor"
