import { useEffect, useId, useRef, type ReactNode } from 'react'

export function Dialog({ open, title, description, onClose, children }: {
  open: boolean; title: string; description: string; onClose: () => void; children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null), id = useId()
  useEffect(() => {
    const dialog = ref.current
    if (open && !dialog?.open) dialog?.showModal()
    if (!open && dialog?.open) dialog.close()
  }, [open])
  return <dialog ref={ref} className="ui-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); onClose() }}>
    <h2 id={`${id}-title`}>{title}</h2><p id={`${id}-description`}>{description}</p>
    <div className="ui-dialog-actions">{children}</div>
  </dialog>
}
