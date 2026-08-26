#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/qmreader}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/qmreader-backups}"
COMPOSE_FILE="${COMPOSE_FILE:-${APP_DIR}/docker-compose.yml}"

if [[ "$(id -u)" != "0" ]]; then
  echo "请使用 root 或 sudo 运行此脚本。" >&2
  exit 1
fi

for required in "${APP_DIR}/data" "${APP_DIR}/.env" "${COMPOSE_FILE}"; do
  if [[ ! -e "${required}" ]]; then
    echo "缺少备份目标：${required}" >&2
    exit 1
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  echo "未找到可用的 Docker Compose。" >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${BACKUP_ROOT}/${timestamp}"
install -d -m 700 "${backup_dir}"

docker compose -f "${COMPOSE_FILE}" stop qmreader >/dev/null
restart_needed=1
cleanup() {
  if [[ "${restart_needed}" == "1" ]]; then
    docker compose -f "${COMPOSE_FILE}" start qmreader >/dev/null || true
  fi
}
trap cleanup EXIT

tar -C "${APP_DIR}" -czf "${backup_dir}/data.tar.gz" data
install -m 600 "${APP_DIR}/.env" "${backup_dir}/.env"
install -m 600 "${COMPOSE_FILE}" "${backup_dir}/docker-compose.yml"

if git -C "${APP_DIR}" rev-parse HEAD >/dev/null 2>&1; then
  git -C "${APP_DIR}" rev-parse HEAD > "${backup_dir}/commit.txt"
  chmod 600 "${backup_dir}/commit.txt"
fi

(cd "${backup_dir}" && sha256sum data.tar.gz .env docker-compose.yml > SHA256SUMS)
chmod 600 "${backup_dir}/SHA256SUMS"

restart_needed=0
docker compose -f "${COMPOSE_FILE}" start qmreader >/dev/null
trap - EXIT

echo "备份完成：${backup_dir}"

