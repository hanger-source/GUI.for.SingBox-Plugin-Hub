# GUI.for.SingBox Plugin Hub

Personal plugin hub for GUI.for.SingBox.

## Subscription

Use this URL as a plugin source:

```text
https://raw.githubusercontent.com/hanger-source/GUI.for.SingBox-Plugin-Hub/main/plugins/generic.json
```

## Plugins

- `dns-fakeip-guard`: generic FakeIP DNS guard for sing-box profiles.

### `dns-fakeip-guard`

This plugin protects two separate DNS paths:

- FakeIP path for ordinary target domains, with `reverse_mapping` and FakeIP
  CIDR routing.
- Bootstrap DNS path for proxy node server domains, via `Bootstrap-DNS` and
  `route.default_domain_resolver.server`.

The bootstrap path is intentionally independent from `🚀 Select` / `🎈 Auto`.
Those outbounds require node domains to be resolved before they can connect, so
using them to resolve node domains can create a startup loop.

Default bootstrap settings:

```text
tag: Bootstrap-DNS
type: udp
server: 8.8.8.8
port: 53
detour: empty, meaning direct
```
