#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/deploy-production.sh [--yes] [commit]

Deploy an immutable image for a commit already contained in origin/main.

Environment variables:
  DEPLOY_HOST       SSH host alias (default: hermes-ecs)
  REMOTE_APP_DIR    ECS application directory (default: /opt/qmreader)
  BACKUP_ROOT       ECS backup directory (default: /opt/qmreader-backups)
  IMAGE_REPOSITORY  Container repository (default: ghcr.io/galong/qmreader)
USAGE
}

assume_yes=0
commit_arg=""
while (($#)); do
  case "$1" in
    --yes)
      assume_yes=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "${commit_arg}" ]]; then
        echo "Only one commit may be specified." >&2
        exit 2
      fi
      commit_arg="$1"
      ;;
  esac
  shift
done

for command_name in git ssh; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command not found: ${command_name}" >&2
    exit 1
  fi
done

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Run this script from the QMReader Git repository." >&2
  exit 1
}
cd "${repo_root}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "The working tree must be clean before production deployment." >&2
  exit 1
fi

echo "Refreshing origin/main..."
git fetch --quiet origin main

requested_commit="${commit_arg:-HEAD}"
commit="$(git rev-parse --verify "${requested_commit}^{commit}" 2>/dev/null)" || {
  echo "Unknown commit: ${requested_commit}" >&2
  exit 1
}

if ! git merge-base --is-ancestor "${commit}" origin/main; then
  echo "Refusing to deploy ${commit}: it is not contained in origin/main." >&2
  exit 1
fi

deploy_host="${DEPLOY_HOST:-hermes-ecs}"
remote_app_dir="${REMOTE_APP_DIR:-/opt/qmreader}"
backup_root="${BACKUP_ROOT:-/opt/qmreader-backups}"
image_repository="${IMAGE_REPOSITORY:-ghcr.io/galong/qmreader}"
image="${image_repository}:sha-${commit}"

if [[ "${remote_app_dir}" != /* || "${remote_app_dir}" == "/" ]]; then
  echo "REMOTE_APP_DIR must be an absolute non-root path." >&2
  exit 1
fi
if [[ "${backup_root}" != /* || "${backup_root}" == "/" ]]; then
  echo "BACKUP_ROOT must be an absolute non-root path." >&2
  exit 1
fi

echo "Commit: ${commit}"
echo "Image:  ${image}"
echo "Target: ${deploy_host}:${remote_app_dir}"

if [[ "${assume_yes}" != "1" ]]; then
  read -r -p "Deploy this version to production? [y/N] " answer
  case "${answer}" in
    y|Y|yes|YES) ;;
    *)
      echo "Deployment cancelled."
      exit 0
      ;;
  esac
fi

ssh "${deploy_host}" bash -s -- "${image}" "${commit}" "${remote_app_dir}" "${backup_root}" <<'REMOTE_SCRIPT'
set -Eeuo pipefail

image="$1"
commit="$2"
app_dir="$3"
backup_root="$4"

cd "${app_dir}"
for required_path in .env .deploy.env docker-compose.yml data; do
  if [[ ! -e "${required_path}" ]]; then
    echo "Missing production path: ${app_dir}/${required_path}" >&2
    exit 1
  fi
done

echo "Pulling ${image}..."
docker pull "${image}"

image_revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "${image}")"
if [[ "${image_revision}" != "${commit}" ]]; then
  echo "Image revision mismatch: expected ${commit}, got ${image_revision:-<empty>}." >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${backup_root}/${timestamp}"
install -d -m 700 "${backup_dir}"
install -m 600 .env "${backup_dir}/.env"
install -m 600 .deploy.env "${backup_dir}/.deploy.env"
install -m 600 docker-compose.yml "${backup_dir}/docker-compose.yml"
if [[ -f DEPLOYED_COMMIT ]]; then
  install -m 600 DEPLOYED_COMMIT "${backup_dir}/DEPLOYED_COMMIT"
fi

rollback_needed=1
rollback() {
  if [[ "${rollback_needed}" == "1" ]]; then
    echo "Deployment failed; restoring the previous image configuration." >&2
    install -m 600 "${backup_dir}/.deploy.env" .deploy.env
    docker compose --env-file .deploy.env up -d --no-build qmreader || true
  fi
}
trap rollback EXIT

docker compose --env-file .deploy.env stop qmreader >/dev/null
tar -czf "${backup_dir}/data.tar.gz" data
chmod 600 "${backup_dir}/data.tar.gz"
(cd "${backup_dir}" && sha256sum data.tar.gz .env .deploy.env docker-compose.yml > SHA256SUMS)
chmod 600 "${backup_dir}/SHA256SUMS"

printf 'QMREADER_IMAGE=%s\n' "${image}" > .deploy.env.next
chmod 600 .deploy.env.next
mv .deploy.env.next .deploy.env

docker compose --env-file .deploy.env config --quiet
docker compose --env-file .deploy.env up -d --no-build qmreader

healthy=0
for _ in $(seq 1 60); do
  container_id="$(docker compose --env-file .deploy.env ps -q qmreader)"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${container_id}" 2>/dev/null || true)"
  if [[ "${health}" == "healthy" ]] && curl -fsS http://127.0.0.1:3088/api/sources >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done

if [[ "${healthy}" != "1" ]]; then
  echo "The new container did not become healthy within 60 seconds." >&2
  docker compose --env-file .deploy.env logs --tail=80 --no-color qmreader >&2 || true
  exit 1
fi

printf '%s\n' "${commit}" > DEPLOYED_COMMIT.next
chmod 600 DEPLOYED_COMMIT.next
mv DEPLOYED_COMMIT.next DEPLOYED_COMMIT

rollback_needed=0
trap - EXIT

echo "Deployment succeeded."
echo "Backup: ${backup_dir}"
echo "Commit: ${commit}"
docker compose --env-file .deploy.env ps qmreader
REMOTE_SCRIPT
