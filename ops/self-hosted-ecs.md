# QMReader 自托管 ECS 运维手册

本文只描述单用户 Docker Compose 部署。业务代码以 GitHub `main` 和对应的不可变容器镜像为准；`.env`、`.deploy.env` 和 `data/` 永远只保留在服务器上。

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

首次部署可以将代码同步到 `/opt/qmreader`，但不要覆盖服务器上的 `.env` 和 `data/`：

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
cp .deploy.env.example .deploy.env
chmod 600 .env
chmod 600 .deploy.env
${EDITOR:-vi} .env
```

公网 IP + HTTP 验证阶段，将 `COOKIE_SECURE` 设为空或 `0`；切换到域名 HTTPS 后改为 `1`。个人实例应设置 `ALLOW_REGISTRATION=0`，由服务端拒绝新账号注册。个人试用建议先减少启用源，并设置 `STARTUP_REFRESH_DELAY_MS=-1`，确认服务稳定后再手动刷新。

启动并查看日志：

```bash
docker compose --env-file .deploy.env up -d --build
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

## 3. 日常开发与 CI

`main` 是唯一生产基线。自己的修改从 `main` 建立 `feature/*` 分支，经 GitHub Pull Request 合并：

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/my-change
# 修改并测试
npm test
git push -u origin feature/my-change
```

`.github/workflows/ci.yml` 会在 PR 上执行依赖安装、语法检查、完整测试和 Docker 构建。PR 合并到 `main` 后，`.github/workflows/publish-container.yml` 再次运行测试，并发布两个镜像标签：

```text
ghcr.io/galong/qmreader:sha-<完整 Git commit>
ghcr.io/galong/qmreader:latest
```

生产只使用 `sha-<完整 Git commit>`，不使用会移动的 `latest`。首次发布后，需要在 GitHub Package 设置中把 `qmreader` 容器设为 Public；否则 ECS 必须先使用只读 token 登录 GHCR。

## 4. 生产发布与回滚

在 GitHub Actions 的 `Publish container` 成功后，从干净的本地仓库执行：

```bash
git switch main
git pull --ff-only origin main
bash scripts/deploy-production.sh
```

脚本只接受已包含在 `origin/main` 的提交。显示提交、镜像和服务器后等待人工确认，然后依次执行：

1. 在不中断旧服务时拉取新镜像并校验镜像 revision；
2. 备份服务器 `.env`、`.deploy.env`、Compose 配置和 `data/`；
3. 使用精确 commit 镜像启动容器；
4. 等待 Compose healthcheck 和 `/api/sources` 同时通过；
5. 失败时自动恢复上一镜像配置。

发布指定提交或回滚到较早的 `main` 提交：

```bash
bash scripts/deploy-production.sh <完整或可解析的提交号>
```

脚本的默认 SSH 别名是 `hermes-ecs`，可通过 `DEPLOY_HOST` 覆盖。备份默认写入 `/opt/qmreader-backups/<UTC时间>`。涉及不兼容 SQLite schema 变化时，镜像回滚后仍应人工恢复同一时间点的数据备份。

## 5. 手工备份

备份 `data/`、`.env`、`.deploy.env`、当前部署 commit 和 Compose 配置：

```bash
sudo /opt/qmreader/ops/backup-qmreader.sh
```

## 6. 合并原作者更新

`origin` 指向自己的 Fork，`upstream` 指向原作者仓库。使用专门分支同步上游，再通过 PR 合并到自己的 `main`：

```bash
git fetch upstream --tags
git switch main
git pull --ff-only origin main
git switch -c upstream-sync-$(date +%Y%m%d)
git merge upstream/main
npm test
git push -u origin HEAD
```

解决冲突并通过 CI 后再合并 PR。不要直接在 ECS 上执行 `git pull`，也不要把未进入自己 `main` 的上游提交直接部署到生产。
