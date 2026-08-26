# QMReader 自托管 ECS 运维手册

本文只描述单用户 Docker Compose 部署。业务代码仍以仓库根目录的上游实现为准；`.env` 和 `data/` 永远只保留在服务器上。

## 1. 首次部署

在 ECS 上准备 Docker、Docker Compose、Nginx，并确认安全组只放行：

- TCP 22：仅你的固定 IP；
- TCP 80：公网访问（HTTP 验证阶段）；
- TCP 443：启用 HTTPS 后使用；
- 不放行 3088。

```bash
sudo mkdir -p /opt/qmreader/data
sudo chown -R "$USER":"$(id -gn)" /opt/qmreader
cd /opt/qmreader
```

将代码同步到 `/opt/qmreader`，但不要覆盖服务器上的 `.env` 和 `data/`：

```bash
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude data \
  --exclude .env \
  ./ user@ecs:/opt/qmreader/
```

首次配置：

```bash
cd /opt/qmreader
cp .env.example .env
chmod 600 .env
${EDITOR:-vi} .env
```

公网 IP + HTTP 验证阶段，将 `COOKIE_SECURE` 设为空或 `0`；切换到域名 HTTPS 后改为 `1`。个人实例应设置 `ALLOW_REGISTRATION=0`，由服务端拒绝新账号注册。个人试用建议先减少启用源，并设置 `STARTUP_REFRESH_DELAY_MS=-1`，确认服务稳定后再手动刷新。

启动并查看日志：

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 -f qmreader
```

Compose 会把应用限制在 `127.0.0.1:3088`，由 Nginx 转发到公网 80/443。

## 2. 冒烟检查

```bash
curl -fsS http://127.0.0.1:3088/api/sources >/dev/null
curl -fsS http://127.0.0.1:3088/api/entries >/dev/null
docker compose restart qmreader
curl -fsS http://127.0.0.1:3088/api/sources >/dev/null
```

随后在浏览器验证管理员登录、RSS 刷新、标题翻译、改写和文章对话。不要把响应中的公开内容、日志或截图提交到 Git。

## 3. 备份与升级

备份 `data/`、`.env`、当前 commit 和 Compose 配置：

```bash
sudo /opt/qmreader/ops/backup-qmreader.sh
```

升级前在本地 Fork 仓库同步上游：

```bash
git fetch upstream
git checkout -b upstream-sync-$(date +%Y%m%d)
git merge upstream/main
```

通过本地检查后再同步到 ECS。生产机不要直接执行 `git pull`；部署完成后检查：

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 qmreader
curl -fsS http://127.0.0.1:3088/api/sources >/dev/null
```

若升级失败，先恢复上一个已验证 commit 并重新构建；如果涉及 SQLite schema 变化，再恢复同一时间点的 `data/` 备份。

## 4. Git 远端约定

在你的 Fork 本地仓库执行：

```bash
git remote add upstream https://github.com/joeseesun/qmreader.git
git fetch --all --tags
```

`origin` 指向你的 Fork，`upstream` 指向原作者仓库。生产只部署经过验证的 `main` 或明确的发布 commit；二次开发使用 `feature/*` 分支。
