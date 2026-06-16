const DefaultDomainSuffixes = [
  'icloud.com',
  'icloud.com.cn',
  'apple.com',
  'apple-dns.net',
  'kdocs.cn',
  'ksord.com',
  'ksosoft.com'
]

const ManagedDomainSuffixes = DefaultDomainSuffixes

const uniq = (items) => Array.from(new Set((items || []).filter(Boolean)))

const configList = (value) => {
  const items = Array.isArray(value)
    ? value
    : String(value || '')
        .split(/[\n,]/)
        .map((item) => item.trim())
  return uniq(items)
}

const configString = (value, fallback = '') => {
  const result = String(value || '').trim()
  return result || fallback
}

const hasTag = (items, tag) => Array.isArray(items) && items.some((item) => item?.tag === tag)

const normalizeProtocol = (protocol) => {
  if (Array.isArray(protocol)) return protocol
  return protocol ? [protocol] : []
}

const matchesQUIC = (rule) => normalizeProtocol(rule?.protocol).includes('quic')

const overlaps = (left, right) => {
  const rightSet = new Set(right || [])
  return (left || []).some((item) => rightSet.has(item))
}

const isManagedRule = (rule, domainSuffixes) =>
  rule?.action === 'route' &&
  matchesQUIC(rule) &&
  Array.isArray(rule?.domain_suffix) &&
  overlaps(rule.domain_suffix, uniq([...ManagedDomainSuffixes, ...domainSuffixes])) &&
  !['🛑 Block', 'block'].includes(rule?.outbound)

const isQUICBlockRule = (rule) =>
  rule?.action === 'route' && matchesQUIC(rule) && ['🛑 Block', 'block'].includes(rule?.outbound)

const isDNSHijackRule = (rule) => rule?.action === 'hijack-dns' || rule?.protocol === 'dns'

const isLikelyPreviousManagedRule = (rules, index) => {
  const rule = rules[index]
  if (
    rule?.action !== 'route' ||
    !matchesQUIC(rule) ||
    !Array.isArray(rule?.domain_suffix) ||
    ['🛑 Block', 'block'].includes(rule?.outbound)
  ) {
    return false
  }

  return isDNSHijackRule(rules[index - 1]) || isQUICBlockRule(rules[index + 1])
}

const removeManagedRules = (rules, domainSuffixes) =>
  (rules || []).filter((rule, index, allRules) => !isManagedRule(rule, domainSuffixes) && !isLikelyPreviousManagedRule(allRules, index))

const insertBeforeQUICBlockOrAfterDNSHijack = (rules, inserts) => {
  const index = rules.findIndex((rule) => rule?.action === 'hijack-dns' || rule?.protocol === 'dns')
  const quicBlockIndex = rules.findIndex(isQUICBlockRule)
  if (index === -1 && quicBlockIndex === -1) return [...inserts, ...rules]
  if (index === -1 || (quicBlockIndex !== -1 && quicBlockIndex < index)) {
    return [...rules.slice(0, quicBlockIndex), ...inserts, ...rules.slice(quicBlockIndex)]
  }
  return [...rules.slice(0, index + 1), ...inserts, ...rules.slice(index + 1)]
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

const selectOutbound = (config) => {
  const requested = configString(Plugin.outbound)
  if (requested && hasTag(config.outbounds, requested)) return requested
  if (hasTag(config.outbounds, '🚀 Select')) return '🚀 Select'
  return config.route?.final || 'direct'
}

const onGenerate = async (config, profile) => {
  config.route ||= {}
  config.route.rules ||= []

  const domainSuffixes = configList(Plugin.domainSuffixes)
  const enabledSuffixes = domainSuffixes.length ? domainSuffixes : DefaultDomainSuffixes
  const outbound = selectOutbound(config)

  const cleanedRules = removeManagedRules(config.route.rules, enabledSuffixes)
  const quicGuardRule = {
    protocol: 'quic',
    domain_suffix: enabledSuffixes,
    outbound,
    action: 'route'
  }

  config.route.rules = uniqRules(insertBeforeQUICBlockOrAfterDNSHijack(cleanedRules, [quicGuardRule]))

  return config
}
