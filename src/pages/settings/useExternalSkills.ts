import { useEffect, useRef, useState } from 'react'
import type { ExternalMCPTarget } from '../../shared/external-mcp'
import type { ExternalSkillsError, ExternalSkillsInspection, ExternalSkillsOutcome, ExternalSkillsStatus } from '../../shared/external-skills'

export function useExternalSkills() {
  const [inspection, setInspection] = useState<ExternalSkillsInspection | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState<ExternalSkillsError | null>(null)
  const [busy, setBusy] = useState<ExternalMCPTarget | 'other' | null>(null)
  const [confirm, setConfirm] = useState<ExternalSkillsStatus | null>(null)
  const [outcomes, setOutcomes] = useState<Partial<Record<ExternalMCPTarget, ExternalSkillsOutcome>>>({})
  const [openError, setOpenError] = useState<ExternalSkillsError | null>(null), [opened, setOpened] = useState(false)
  const alive = useRef(true), working = useRef(false), generation = useRef(0)
  async function refresh() {
    const current = ++generation.current
    setLoading(true); setError(null)
    try {
      const result = await window.externalSkills.inspect({})
      if (!alive.current || current !== generation.current) return
      if (result.ok) { setInspection(result.value); setOutcomes({}) }
      else setError(result.error)
    } catch { if (alive.current && current === generation.current) setError('SKILLS_UNAVAILABLE') }
    finally { if (alive.current && current === generation.current) setLoading(false) }
  }
  useEffect(() => {
    alive.current = true
    void refresh()
    return () => { alive.current = false; generation.current++ }
  }, [])
  async function install(status: ExternalSkillsStatus, replace = false) {
    if (working.current) return
    working.current = true; setBusy(status.target)
    setOutcomes(previous => ({ ...previous, [status.target]: undefined }))
    try {
      const result = await window.externalSkills.install({ target: status.target, revision: status.revision, replace })
      if (!alive.current) return
      if (result.ok) {
        setInspection(previous => previous && ({ clients: previous.clients.map(client => client.target === status.target ? result.value.status : client) }))
        setOutcomes(previous => ({ ...previous, [status.target]: result.value }))
      } else {
        await refresh()
        if (alive.current) setOutcomes(previous => ({ ...previous, [status.target]: {
          status, completed: [], pending: status.skills.filter(skill => skill.state !== 'installed').map(skill => skill.name), error: result.error
        } }))
      }
    } catch {
      if (alive.current) { await refresh(); if (alive.current) setError('INSTALL_FAILED') }
    } finally { working.current = false; if (alive.current) setBusy(null) }
  }
  async function openBundle() {
    if (working.current) return
    working.current = true; setBusy('other'); setOpenError(null); setOpened(false)
    try {
      const result = await window.externalSkills.openBundle({})
      if (alive.current) { if (result.ok) setOpened(true); else setOpenError(result.error) }
    } catch { if (alive.current) setOpenError('OPEN_FAILED') }
    finally { working.current = false; if (alive.current) setBusy(null) }
  }
  return { inspection, loading, error, busy, confirm, setConfirm, outcomes, openError, opened, refresh, install, openBundle }
}
