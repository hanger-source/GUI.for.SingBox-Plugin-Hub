const DefaultFakeIPV4Range = '198.18.0.0/15'
const DefaultFakeIPV6Range = 'fc00::/18'
const DefaultBootstrapDNSTag = 'Bootstrap-DNS'
const DefaultBootstrapDNSType = 'udp'
const DefaultBootstrapDNSServer = '8.8.8.8'
const DefaultBootstrapDNSPort = '53'
const DangerousBootstrapDetours = ['🚀 Select', '🎈 Auto', 'GLOBAL', '🐟 Fallback']
const PrivateDomainSuffixes = [
  'local',
  'localhost',
  'lan',
  'home.arpa',
  'arpa',
  'invalid',
  'test'
]
const hasTag = (items, tag) => Array.isArray(items) && items.some((item) => item?.tag === tag)

const uniq = (items) => Array.from(new Set((items || []).filter(Boolean)))
const configList = (value) => {
  const items = Array.isArray(value)
    ? value
    : String(value || '')
        .split(/[\n,]/)
        .map((item) => item.trim())
  return uniq(items)
}
const configString = (value, fallback) => {
  const result = String(value || '').trim()
  return result || fallback
}
const configBool = (value, fallback) => {
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase())
}
const configPort = (value, fallback) => {
  const port = Number(configString(value, fallback))
  return Number.isFinite(port) && port > 0 ? port : Number(fallback)
}

const uniqRules = (rules) => {
  const seen = new Set()
  return rules.filter((rule) => {
    const key = JSON.stringify(rule)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const isManagedDNSRule = (rule) => rule?.server === 'Fake-IP'

const hasAnyCIDR = (rule, cidrs) => (rule?.ip_cidr || []).some((cidr) => cidrs.includes(cidr))

const isFakeIPRouteRule = (rule, fakeIPRanges) =>
  hasAnyCIDR(rule, fakeIPRanges) && !['🛑 Block', 'block'].includes(rule?.outbound)

const isConfiguredBlockRule = (rule, blockedCIDRs) =>
  hasAnyCIDR(rule, blockedCIDRs) && ['🛑 Block', 'block'].includes(rule?.outbound)

const isManagedBlockNeighbor = (rules, index, fakeIPRanges) => {
  const rule = rules[index]
  const nextRule = rules[index + 1]
  return (
    Array.isArray(rule?.ip_cidr) &&
    rule.ip_cidr.length > 0 &&
    ['🛑 Block', 'block'].includes(rule?.outbound) &&
    isFakeIPRouteRule(nextRule, fakeIPRanges)
  )
}

const removeManagedDNSRules = (rules) => (rules || []).filter((rule) => !isManagedDNSRule(rule))

const removeManagedRouteRules = (rules, blockedCIDRs, fakeIPRanges) =>
  (rules || []).filter(
    (rule, index, allRules) =>
      !isFakeIPRouteRule(rule, fakeIPRanges) &&
      !isConfiguredBlockRule(rule, blockedCIDRs) &&
      !isManagedBlockNeighbor(allRules, index, fakeIPRanges)
  )

const getExistingFakeIPRanges = (config) => {
  const existing = (config.dns?.servers || []).find((server) => server?.tag === 'Fake-IP')
  return uniq([existing?.inet4_range, existing?.inet6_range])
}

const ensureFakeIPServer = (config, fakeIPV4Range, fakeIPV6Range) => {
  config.dns ||= {}
  config.dns.servers ||= []
  const existing = config.dns.servers.find((server) => server?.tag === 'Fake-IP')
  if (existing) {
    existing.type = existing.type || 'fakeip'
    existing.inet4_range = fakeIPV4Range
    existing.inet6_range = fakeIPV6Range
    return existing.tag
  }
  config.dns.servers.unshift({
    tag: 'Fake-IP',
    type: 'fakeip',
    inet4_range: fakeIPV4Range,
    inet6_range: fakeIPV6Range
  })
  return 'Fake-IP'
}

const ensureBootstrapDNSServer = (config, options) => {
  config.dns ||= {}
  config.dns.servers ||= []

  const tag = configString(options.tag, DefaultBootstrapDNSTag)
  const type = configString(options.type, DefaultBootstrapDNSType)
  const server = configString(options.server, DefaultBootstrapDNSServer)
  const serverPort = configPort(options.port, DefaultBootstrapDNSPort)
  const path = String(options.path || '').trim()
  const requestedDetour = String(options.detour || '').trim()
  const detour = DangerousBootstrapDetours.includes(requestedDetour) ? '' : requestedDetour

  const next = {
    tag,
    type,
    server,
    server_port: serverPort
  }
  if (path) next.path = path
  if (detour) next.detour = detour

  const existing = config.dns.servers.find((dnsServer) => dnsServer?.tag === tag)
  if (existing) {
    Object.keys(existing).forEach((key) => delete existing[key])
    Object.assign(existing, next)
    return tag
  }

  config.dns.servers.push(next)
  return tag
}

const insertAfterDNSHijack = (rules, inserts) => {
  const index = rules.findIndex((rule) => rule?.action === 'hijack-dns' || rule?.protocol === 'dns')
  if (index === -1) return [...inserts, ...rules]
  return [...rules.slice(0, index + 1), ...inserts, ...rules.slice(index + 1)]
}

const onGenerate = async (config, profile) => {
  config.dns ||= {}
  config.dns.rules ||= []
  config.route ||= {}
  config.route.rules ||= []

  const fakeIPV4Range = configString(Plugin.fakeIPV4Range, DefaultFakeIPV4Range)
  const fakeIPV6Range = configString(Plugin.fakeIPV6Range, DefaultFakeIPV6Range)
  const previousFakeIPRanges = getExistingFakeIPRanges(config)
  const fakeIPRanges = [fakeIPV4Range, fakeIPV6Range]
  const fakeIPTag = ensureFakeIPServer(config, fakeIPV4Range, fakeIPV6Range)
  const outbound = hasTag(config.outbounds, '🚀 Select') ? '🚀 Select' : config.route.final
  const block = hasTag(config.outbounds, '🛑 Block') ? '🛑 Block' : 'block'
  const blockedCIDRs = configList(Plugin.blockedCIDRs)
  const enableBootstrapDNS = configBool(Plugin.enableBootstrapDNS, true)
  const forceBootstrapDomainResolver = configBool(Plugin.forceBootstrapDomainResolver, true)
  const disableDNSCache = configBool(Plugin.disableDNSCache, true)
  const bootstrapDNSTag = enableBootstrapDNS
    ? ensureBootstrapDNSServer(config, {
        tag: Plugin.bootstrapDNSTag,
        type: Plugin.bootstrapDNSType,
        server: Plugin.bootstrapDNSServer,
        port: Plugin.bootstrapDNSPort,
        path: Plugin.bootstrapDNSPath,
        detour: Plugin.bootstrapDNSDetour
      })
    : ''

  config.dns.independent_cache = true
  config.dns.reverse_mapping = true
  if (disableDNSCache) {
    config.dns.disable_cache = true
  }
  if (enableBootstrapDNS && forceBootstrapDomainResolver) {
    config.route.default_domain_resolver = {
      server: bootstrapDNSTag
    }
  }

  const dnsPrivateRule = {
    domain_suffix: PrivateDomainSuffixes,
    server: 'Local-DNS',
    action: 'route'
  }

  const dnsPrivateRuleSet = {
    rule_set: ['GeoSite-Private'],
    server: 'Local-DNS',
    action: 'route'
  }

  const dnsFakeAllRule = {
    query_type: ['A', 'AAAA'],
    server: fakeIPTag,
    action: 'route',
    disable_cache: true
  }

  const routeFakeIPRangeRule = {
    ip_cidr: fakeIPRanges,
    outbound,
    action: 'route'
  }

  config.dns.rules = uniqRules([
    dnsPrivateRule,
    dnsPrivateRuleSet,
    dnsFakeAllRule,
    ...removeManagedDNSRules(config.dns.rules)
  ])
  config.route.rules = uniqRules(
    insertAfterDNSHijack(
      removeManagedRouteRules(config.route.rules, blockedCIDRs, uniq([...previousFakeIPRanges, ...fakeIPRanges])),
      [
        ...(blockedCIDRs.length
          ? [
              {
                ip_cidr: blockedCIDRs,
                outbound: block,
                action: 'route'
              }
            ]
          : []),
        routeFakeIPRangeRule
      ]
    )
  )

  return config
}
