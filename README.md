# 混合视频路由器公共价格中心

每天由 GitHub Actions 在云端运行 Playwright，登录“分镜图生成器 · 运境”，读取价格表并更新 `public/prices.json`。客户端只读取公开 JSON，不会获得网站账号密码。

## 一次性配置

在仓库 `Settings → Secrets and variables → Actions` 中添加：

- `PRICE_SITE_USERNAME`：网站登录账号
- `PRICE_SITE_PASSWORD`：网站登录密码

随后在 `Actions → Refresh shared prices → Run workflow` 手动运行一次。以后北京时间每天 04:23 自动更新。

## 公共读取地址

`https://raw.githubusercontent.com/xidoct/mixed-video-router-prices/main/public/prices.json`

## 安全边界

- 账号密码只通过 GitHub Secrets 注入运行环境。
- 日志不输出账号、密码和 Cookie。
- 采集结果少于 5 个模型时任务失败，不覆盖上一版价格。
- 登录或网页异常时保留上一版 JSON，第二天自动重试。
