function metadata(base, run, sha) {
  if (!/^\d+\.\d+\.\d+$/.test(base) || !/^[a-f0-9]{40}$/.test(sha) || !/^\d+$/.test(String(run)) || Number(run) < 1 || Number(run) > 65535 || base.split('.').some(n => Number(n) > 65535)) throw new Error('INVALID_RELEASE_METADATA')
  const version = `${base}-main.${run}.${sha.slice(0, 7)}`
  return { version, tag: `v${version}`, buildVersion: `${base}.${run}`, sha }
}
module.exports = { metadata }
