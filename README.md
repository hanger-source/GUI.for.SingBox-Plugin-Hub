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

This plugin protects the FakeIP DNS path:

- FakeIP path for domains requested by apps, with `reverse_mapping` and FakeIP
  CIDR routing.

This plugin currently does not inject Bootstrap DNS. Proxy node server domains
are still resolved by the current profile's `route.default_domain_resolver`.
That resolver is the path sing-box uses when it dials outbound node `server`
domains.

Seeing a proxy node domain resolve to FakeIP from macOS tools only proves an app
query went through the TUN DNS path. It does not prove sing-box used FakeIP to
dial the node. The node dialing path is controlled by
`route.default_domain_resolver.server`.

FakeIP ranges must not conflict with ranges already captured by another TUN or
proxy core. A quick macOS check is:

```bash
route -n get 100.64.0.1
route -n get 198.18.0.16
```

Before GUI TUN starts, the selected FakeIP range should not already point to
another `utun`. After GUI TUN starts, connections to the selected FakeIP range
must enter GUI.for.SingBox's sing-box TUN; otherwise `reverse_mapping` cannot
recover the original domain.
