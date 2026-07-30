/*
  Author: Runor Ewhro
  Description: Generates rotation share payloads through the remote-token path
               with an inline-token fallback, while keeping export and clipboard
               state scoped to the selected saved rotation.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import type { InvRotEnt } from '@/domain/entities/inventoryStorage.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import {
  mkRotShare,
  mkRotXprtPay,
  slgfRotFileN,
  type RotShare,
} from '@/modules/calculator/features/rotation/lib/savedRotations.ts'
import { xprtAppFile } from '@/shared/lib/fileCodec.ts'

interface RotShareMdlPrps {
  visible: boolean
  open: boolean
  closing?: boolean
  entry: InvRotEnt | null
  onClose: () => void
}

type Channel = 'token' | 'link'

export function RotShareMdl({ visible, open, closing = false, entry, onClose }: RotShareMdlPrps) {
  const showToast = useTstStr((state) => state.show)
  const [share, setShare] = useState<RotShare | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<Channel | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Share output depends on remote KV availability, so regenerate per entry/open
  // instead of caching a possibly stale fallback decision.
  /* eslint-disable react-hooks/set-state-in-effect -- this effect owns the async share-generation lifecycle for the modal. */
  useEffect(() => {
    if (!visible || !entry) return

    let active = true
    setLoading(true)
    setShare(null)
    setCopied(null)

    void mkRotShare(entry).then((result) => {
      if (active) {
        setShare(result)
        setLoading(false)
      }
    })

    return () => {
      active = false
    }
  }, [visible, entry])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  const onCopy = useCallback(async (channel: Channel, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(channel)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(null), 1600)
    } catch {
      showToast({ content: 'Clipboard write failed.', variant: 'error', duration: 3000 })
    }
  }, [showToast])

  const onExport = useCallback(async () => {
    if (!entry) return
    const payload = mkRotXprtPay(entry)
    await xprtAppFile(
      `${slgfRotFileN(entry.name || entry.resonatorName || 'rotation')}.json`,
      JSON.stringify(payload),
    )
    showToast({ content: `Exported "${entry.name}"`, variant: 'success', duration: 2500 })
  }, [entry, showToast])

  const renderField = (channel: Channel, value: string) => (
    <div className={`rot-share__field${channel === 'token' ? ' rot-share__field--token' : ''}${copied === channel ? ' is-copied' : ''}`}>
      {loading ? (
        <span className="rot-share__loading" aria-label="Generating">Generating…</span>
      ) : (
        <code className={`rot-share__code${channel === 'link' ? ' rot-share__code--link' : ''}`}>{value}</code>
      )}
      <button
        type="button"
        className="rot-share__copy"
        onClick={() => onCopy(channel, value)}
        disabled={loading}
      >
        {copied === channel ? <Check size="0.9rem" /> : <Copy size="0.9rem" />}
        {copied === channel ? 'Copied' : 'Copy'}
      </button>
    </div>
  )

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="rotation-share"
      ariaLabel={entry ? `Share ${entry.name}` : 'Share rotation'}
      onClose={onClose}
    >
      <div className="rot-share">
        <div className="rot-share__head">
          <span className="rot-share__eyebrow">Share rotation</span>
          <h2 className="rot-share__title">{entry?.name ?? 'Rotation'}</h2>
          <p className="rot-share__note">
            {loading
              ? 'Generating a shareable token…'
              : share?.remote
                ? 'Token expires in 90 days'
                : 'Encoded token'}
          </p>
        </div>

        <div className="rot-share__channel">
          <span className="rot-share__label">Token</span>
          {renderField('token', share?.token ?? '')}
        </div>

        <div className="rot-share__channel">
          <span className="rot-share__label">Link</span>
          {renderField('link', share?.link ?? '')}
        </div>

        <div className="rot-share__foot">
          <button type="button" className="rot-share__export" onClick={() => void onExport()}>
            <Download size="0.9rem" />
            Export file
          </button>
          <button type="button" className="rot-share__done" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </AppModal>
  )
}
