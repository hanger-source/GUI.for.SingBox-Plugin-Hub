# GUI.for.SingBox Plugin Hub

这是一个个人维护的 GUI.for.SingBox 插件源。

## 订阅地址

在 GUI.for.SingBox 的插件源里添加：

```text
https://raw.githubusercontent.com/hanger-source/GUI.for.SingBox-Plugin-Hub/main/plugins/generic.json
```

## 插件列表

- `dns-fakeip-guard`：为 sing-box profile 注入稳定的 FakeIP DNS 规则和 FakeIP 路由规则。

## GUI.for.SingBox 本地状态位置

macOS 上排查插件是否生效时，优先看这些路径：

```text
GUI 数据目录:
~/Library/Application Support/GUI.for.SingBox

已安装插件列表:
~/Library/Application Support/GUI.for.SingBox/plugins.yaml

已安装插件源码:
~/Library/Application Support/GUI.for.SingBox/plugins/dns-fakeip-guard.js
/Applications/GUI.for.SingBox.app/Contents/MacOS/data/plugins/dns-fakeip-guard.js

用户设置:
~/Library/Application Support/GUI.for.SingBox/user.yaml

生成后的 sing-box 运行配置:
~/Library/Application Support/GUI.for.SingBox/sing-box/config.json
/Applications/GUI.for.SingBox.app/Contents/MacOS/data/sing-box/config.json

插件源缓存:
~/Library/Application Support/GUI.for.SingBox/.cache/plugin-list.json
```

在当前 macOS 安装形态里，`~/Library/Application Support/GUI.for.SingBox/...`
和 `/Applications/GUI.for.SingBox.app/Contents/MacOS/data/...` 下的对应文件可能是同一个 inode。
不要先假设它们是两份独立文件，需要时用 `stat` 确认。

插件配置不是只从一个地方读取：

1. `plugins.yaml` 保存已安装插件的元数据和 `configuration[].value` 默认值。
2. `user.yaml` 保存用户覆盖值，路径是 `pluginSettings.<plugin-id>.<configuration-key>`。
3. GUI 生成运行时 `Plugin.<key>` 对象时，会先取 `plugins.yaml` 默认值，再用 `user.yaml` 覆盖。
4. `sing-box/config.json` 只是已经生成出来的运行配置。插件默认值或用户设置变更后，它可能仍然保留旧值，直到 GUI 重新生成 profile/core 配置。

如果设置界面里仍显示旧的 FakeIP 网段，先检查用户覆盖值：

```bash
yq '.pluginSettings."plugin-dns-fakeip-guard"' \
  "$HOME/Library/Application Support/GUI.for.SingBox/user.yaml"
```

`user.yaml` 里的用户覆盖值优先级高于插件默认值。

## `dns-fakeip-guard`

`dns-fakeip-guard` 是一个 `on::generate` 插件。它在 GUI.for.SingBox 生成 sing-box 配置时改写 profile，然后再由核心启动。

插件做的事：

- 确保存在一个 `Fake-IP` DNS server。
- 默认设置 FakeIP 网段为 `198.18.0.0/15` 和 `fc00::/18`。
- 启用 `dns.independent_cache`。
- 启用 `dns.reverse_mapping`，让 sing-box 能从 FakeIP 反查回原始域名。
- 默认启用 `dns.disable_cache`，减少旧 DNS 结果残留。
- 把本地/私有后缀和 `GeoSite-Private` 规则集送到 `Local-DNS`。
- 把普通应用发起的 `A` / `AAAA` 查询送到 `Fake-IP`。
- 添加 FakeIP 网段路由规则，让连向 FakeIP 的连接进入选中的出站。
- 可选添加额外 `Blocked CIDRs` 阻断规则。

配置变更不会热更新已经运行中的 sing-box core。修改插件配置后，需要让 GUI.for.SingBox 重新生成配置并重启核心。修改 FakeIP 网段或 DNS 缓存设置后，如果系统或浏览器仍看到旧结果，再清理 macOS DNS 缓存和浏览器 DNS 缓存。

这个插件刻意不做两件事：

- 不注入 Bootstrap DNS。
- 不改变代理节点域名解析。

代理节点 `server` 域名的解析仍然由当前 profile 的 `route.default_domain_resolver` 决定。也就是说，macOS 工具里看到某个节点域名被解析成 FakeIP，只能证明“应用 DNS 查询”走到了 TUN/FakeIP 路径；不能证明 sing-box 自己拨号该节点时也用 FakeIP。sing-box 拨号节点域名时看的是 `route.default_domain_resolver.server`。

## 和 GUI/sing-box 默认 Fake-IP DNS 的关系

GUI.for.SingBox / sing-box 本来就支持 `type: "fakeip"` 的 DNS server。这个插件不是重新实现 FakeIP，也不是替代 sing-box 的 FakeIP 能力。

内核原生 FakeIP 能力负责：

- 给域名分配 `198.18.x.x` / `fc00::x` 这类假 IP。
- 保存 FakeIP 到域名的映射。
- 在连接进入 sing-box 后，通过 `reverse_mapping` 找回原始域名。

插件负责的是“把这套能力稳定地接进当前 profile”：

- 确保 `Fake-IP` server 存在且网段一致。
- 确保 `A` / `AAAA` 查询会被 DNS rule 送到 `Fake-IP`。
- 确保 FakeIP 网段有 route rule，连接进入正确出站。
- 确保本地/私有域名先走 `Local-DNS`，不被通用 FakeIP 规则误接管。
- 确保配置项和生成结果可检查、可复现。

不要把 profile 的默认 DNS server 直接设置成 `fakeip`。sing-box 的默认 DNS server 应该是真实 DNS server；FakeIP 应该通过 DNS rule 被选择，而不是作为默认 DNS。这个插件采用的方式是添加：

```text
query_type: [A, AAAA] -> Fake-IP
```

这样既能让普通应用域名进入 FakeIP，也能保留本地/私有域名和节点域名解析的边界。

## 为什么需要这个插件

这个插件要解决的核心问题不是“sing-box 没有 FakeIP”，而是：在复杂网络环境里，应用一旦先通过普通 DNS 拿到真实地址，后续连接就已经被那个地址绑定了。这个地址可能不可用、受策略影响，或者和我们希望的代理路径不一致。等连接已经指向这个地址之后，再靠路由规则或代理规则补救就很被动。

FakeIP 的价值是把“域名”保留到 sing-box 里面再做决策：

```text
应用查询域名
  -> DNS 返回 FakeIP
  -> 应用连接 FakeIP
  -> TUN 把连接送进 sing-box
  -> sing-box 通过 reverse_mapping 找回原始域名
  -> 再按规则选择 proxy / direct / block
```

这样连接不会先被外部 DNS 结果锁死，sing-box 还能基于原始域名做规则判断。

单靠 GUI 里“存在一个 Fake-IP DNS server”还不够。真正稳定需要同时满足四件事：

1. DNS 查询要进入 FakeIP server。
2. FakeIP 网段要能进入 TUN。
3. sing-box 要能通过 `reverse_mapping` 找回原始域名。
4. 本地/私有域名、代理节点域名、普通应用域名不能混在同一条 DNS 语义里。

如果只手动改 GUI 配置，很容易出现这些问题：

- 设置界面改了，但 `user.yaml` 覆盖值仍是旧的。
- `config.json` 还没重新生成，核心继续用旧配置。
- DNS 缓存里仍然保留旧 FakeIP。
- 默认 DNS server 被误设成 `fakeip`，导致核心无法启动。
- 看到某个域名走 FakeIP，却误以为节点拨号也走了 FakeIP。
- FakeIP 网段和其他 TUN/代理核心的网段冲突。

插件的价值是把 FakeIP 相关的 DNS rule、route rule、缓存策略和可检查的配置项固定下来，确保普通应用域名优先以 FakeIP 形式进入 sing-box，而不是先被普通 DNS 结果决定命运。这样后续代理、直连、阻断和排查都围绕原始域名展开，状态更可控。

## 配置项

- `FakeIP IPv4 Range`：默认 `198.18.0.0/15`。修改后需要重新生成配置并重启核心，必要时清理 macOS/浏览器 DNS 缓存。
- `FakeIP IPv6 Range`：默认 `fc00::/18`。修改后需要重新生成配置并重启核心，必要时清理 macOS/浏览器 DNS 缓存。
- `Blocked CIDRs`：可选，每行一个 CIDR。用于在 FakeIP 路由规则之前插入显式阻断。修改后需要重新生成配置并重启核心。
- `Disable DNS Cache`：禁用 sing-box DNS 缓存，减少旧解析结果残留。它不会清理 macOS 或浏览器里已经存在的缓存。

## macOS TUN 路由说明

GUI.for.SingBox 默认 TUN 配置形态类似：

```json
{
  "address": ["172.18.0.1/30", "fdfe:dcba:9876::1/126"],
  "auto_route": true,
  "strict_route": true,
  "route_address": [],
  "route_exclude_address": []
}
```

当 `route_address` 为空且 `auto_route` 开启时，sing-box 会把路由创建交给 `sing-tun`。在 macOS 上，`sing-tun` 会把默认 IPv4 路由拆成多个子网段：

```text
1.0.0.0/8
2.0.0.0/7
4.0.0.0/6
8.0.0.0/5
16.0.0.0/4
32.0.0.0/3
64.0.0.0/2
128.0.0.0/1
```

所以 `route -n get 100.64.0.1` 在 TUN 开启时可能显示当前 GUI TUN 接口。这个现象只说明该地址被 macOS 的 auto-route 默认路由覆盖到了，不等于当前 FakeIP 配置仍然是 `100.64.0.0/10`。

判断一个 `utun` 是否是当前 GUI.for.SingBox 创建的，不要只看 `utun` 编号。`utun5` / `utun6` 这类编号是动态分配的。应该同时看三个信号：

```bash
pgrep -fl 'GUI.for.SingBox|sing-box run'
ifconfig utunX
at-grep 'inbound/tun\\[tun-in\\]: started at utun' \
  "$HOME/Library/Application Support/GUI.for.SingBox/sing-box/sing-box.log" \
  --limit 20
```

当前 GUI TUN 接口应该带有 profile 里的 TUN 地址，例如 `172.18.0.1` 和 `fdfe:dcba:9876::1`。这些是虚拟网卡自身地址，不是目标网站地址。目标域名拿到的 FakeIP 是 `198.18.x.x` 或 `fc00::x`。

## 健康检查

检查生成配置：

```bash
jq '.dns.servers[] | select(.tag == "Fake-IP"), .route.rules[] | select(.ip_cidr? != null)' \
  "$HOME/Library/Application Support/GUI.for.SingBox/sing-box/config.json"
```

期望看到：

```json
{
  "tag": "Fake-IP",
  "type": "fakeip",
  "inet4_range": "198.18.0.0/15",
  "inet6_range": "fc00::/18"
}
```

并且 route rule 里包含：

```json
["198.18.0.0/15", "fc00::/18"]
```

检查系统解析是否已经进入当前 FakeIP：

```bash
dscacheutil -q host -a name chatgpt.com
dig +time=2 +tries=1 +short chatgpt.com A
```

检查 FakeIP 网段当前路由：

```bash
route -n get 198.18.0.16
route -n get 198.19.255.254
```

如果修改配置后仍看到旧 FakeIP，按这个顺序排查：

1. `plugins.yaml` 里的默认 `configuration[].value`。
2. `user.yaml` 里的 `pluginSettings.plugin-dns-fakeip-guard` 用户覆盖。
3. `sing-box/config.json` 是否已经重新生成。
4. sing-box core 是否已经重启。
5. macOS resolver 缓存和浏览器 DNS 缓存是否仍有旧结果。

浏览器自己的 DNS/host cache 也可能需要单独清理。
