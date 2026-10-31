# Vela Marketplace

独立的 Vela 插件市场平台：发布者账号、管理员审核、分类精选、评分评论、搜索下载，以及浏览器管理后台。Vela Desktop 的 Plugin Market 应用通过 HTTP API 读取和安装已上架插件。

本仓从 [ShiningRay/vela](https://github.com/ShiningRay/vela) 的 `services/marketplace` 独立出来，可单独部署。

## 本地启动

要求 Node 22+、pnpm 12+。

```bash
pnpm install
MARKETPLACE_ADMIN_TOKEN=change-me \
MARKETPLACE_ADMIN_USERNAME=admin \
MARKETPLACE_ADMIN_PASSWORD=change-me-too \
pnpm dev
```

默认地址 `http://127.0.0.1:4320`，管理页 `/`，数据在 `data/`（已 gitignore）。

可选环境变量：

- `MARKETPLACE_PORT`：默认 `4320`
- `MARKETPLACE_HOST`：默认 `127.0.0.1`；容器内为 `0.0.0.0`
- `MARKETPLACE_DATA_DIR`：元数据、账号、会话与 VPK 文件目录
- `MARKETPLACE_ADMIN_TOKEN`：机器上传/管理用 Bearer token；也可登录管理员账号
- `MARKETPLACE_ADMIN_USERNAME` / `MARKETPLACE_ADMIN_PASSWORD`：首次启动时创建管理员账号
- `VELA_APPS_VPK_DIR`：`pnpm seed` 的 VPK 来源，默认 `../vela-apps/dist/vpk`

## 账号与角色

- `publisher`：注册即获得，可上传 VPK；新上传进入 `pending`。
- `admin`：由启动环境变量引导创建；可审核、拒绝、设置分类与精选。
- 会话 token 7 天有效，保存在 `data/accounts.json`（密码 scrypt 哈希，不保存明文）。
- 上传 API 也接受 `MARKETPLACE_ADMIN_TOKEN`，用于 CI/脚本；该 token 自动视为管理员。

## 审核与上架

状态：`pending` → `published` / `rejected`，管理员也可将已上架插件设为 `suspended`。

发布者可在 Web「我的插件」查看状态与拒绝原因。管理员在「待审核」面板中批准/拒绝，并可设置：

- 分类：`productivity` / `developer` / `finance` / `fun` / `system` / `other`
- 精选：`featured`

公开列表只返回 `published`；默认按更新时间排序，也可按下载量/评分排序。

## 评分评论

登录用户可对已上架插件评分（1-5）与评论；每个用户对同一插件保留一条评价，重复提交会覆盖。发布者不能给自己的插件评分。插件列表返回平均分与评价数，卡片可查看评论。

## 导入演示包

在启动服务之前运行，或导入后重启服务：

```bash
pnpm build # 在同级 vela-apps 仓内
pnpm seed
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/meta` | 分类与状态枚举 |
| POST | `/api/auth/register` | `{username,password}`，注册发布者 |
| POST | `/api/auth/login` | 登录，返回会话 token |
| GET | `/api/auth/me` | 当前用户 |
| POST | `/api/auth/logout` | 注销 |
| GET | `/api/me/plugins` | 发布者自己的插件与审核状态 |
| GET | `/api/plugins?q=&category=&featured=&sort=&page=&pageSize=` | 已上架搜索/分页 |
| GET | `/api/plugins/:id` | 详情、版本、评论 |
| GET | `/api/plugins/:id/reviews` | 评论列表 |
| POST | `/api/plugins/:id/reviews` | `{rating,body}`，需登录 |
| GET | `/api/plugins/:id/download?version=latest` | 下载 VPK，返回 `X-VPK-SHA256` |
| POST | `/api/plugins` | multipart 上传；发布者需登录，管理员 token 也可 |
| GET | `/api/admin/plugins?status=pending` | 管理员审核列表 |
| POST | `/api/admin/plugins/:id/status` | `{status,note}` |
| PATCH | `/api/admin/plugins/:id` | `{category,featured}` |

上传字段：`file`、`description`、`author`、`homepage`、`category`、`tags`（逗号分隔）。服务会校验 ZIP、`manifest.json`、id、semver、入口与 VPK 大小限制，并计算 SHA-256。

## 测试

```bash
pnpm typecheck
pnpm test
```

## Docker

```bash
docker build -t vela-marketplace .
docker run -d --name vela-marketplace -p 4320:4320 \
  -v vela-market-data:/data \
  -e MARKETPLACE_ADMIN_TOKEN=change-me \
  -e MARKETPLACE_ADMIN_USERNAME=admin \
  -e MARKETPLACE_ADMIN_PASSWORD=change-me-too \
  vela-marketplace
```

容器内 `MARKETPLACE_HOST=0.0.0.0`、数据目录 `/data`，带 `/api/health` healthcheck。也提供 `docker-compose.yml`。公网部署需在前面加 TLS 反向代理，并限制上传 token 权限。

## 存储与安全

- 元数据：`data/plugins.json`；账号/会话：`data/accounts.json`；均原子写。
- 文件：`data/files/<id>/<version>.vpk`。
- 上传限制：单文件 5 MB、总计 6 MB；解压前用 fflate filter 检查原始体积，防 ZIP bomb。
- 上传令牌/管理员密码只从环境变量读取，不写入仓库。
- 单实例 JSON 存储：无邮箱验证、找回密码、对象存储、病毒扫描或签名校验。

## License

MIT
