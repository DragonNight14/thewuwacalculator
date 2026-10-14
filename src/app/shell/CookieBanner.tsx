/*
  Author: Runor Ewhro
  description: displays the cookie-consent banner and links users to the
               privacy policy when they want more detail.
*/

import { useNavX } from '@/shared/navigation/useNavX'
import { Cookie } from 'lucide-react'

interface CkBnnrPrps {
  visible: boolean
  open: boolean
  closing: boolean
  onAccept: () => void
}

export function CookieBanner({ visible, open, closing, onAccept }: CkBnnrPrps) {
  const navigate = useNavX()

  if (!visible) return null

  return (
    <div
      className={`ckb ${open ? 'open' : ''} ${closing ? 'closing' : ''}`}
      role="region"
      aria-label="Cookie consent"
    >
      <div className="ckb__icon-wrap" aria-hidden="true">
        <Cookie size="1.125rem" />
      </div>
      <div className="ckb__body">
        <p className="ckb__text">
          Cookies are used for basic analytics only, nothing personal, nothing sold.{' '}
          <button
            type="button" className="ckb__link"
            onClick={() => navigate('/privacy')}
          >
            Privacy Policy
          </button>
        </p>
      </div>
      <button
        type="button" className="ckb__accept"
        onClick={onAccept}
      >
        Got it~
      </button>
    </div>
  )
}
