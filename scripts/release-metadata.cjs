function metadata(base, run, sha) {
  if (!/^\d+\.\d+\.\d+$/.test(base) || !/^[a-f0-9]{40}$/.test(sha) || !/^\d+$/.test(String(run)) || Number(run) < 1 || Number(run) > 65535 || base.split('.').some(n => Number(n) > 65535)) throw new Error('INVALID_RELEASE_METADATA')
  const version = `${base}-main.${run}.g${sha.slice(0, 7)}`
  const macBundleVersion = `${Math.floor(Number(run) / 10000) + 1}.${Math.floor(Number(run) / 100) % 100}.${Number(run) % 100}`
  return { macBundleVersion, version, tag: `v${version}`, buildVersion: `${base}.${run}`, sha }
}
module.exports = { metadata }
