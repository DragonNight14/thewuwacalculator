/*
  Author: Runor Ewhro
  description: renders versioned changelog entries with route metadata and anchored release navigation.
*/

import React from 'react'
import { AxLink } from '@/shared/navigation/useNavX'
import { chngSctn, getLatestWhatsNew, getLinkedWhatsNew } from '@/data/content/changelogEntries'
import { HtmlContent } from '@/shared/ui/HtmlContent'
import { whatsNewHref } from '@/shared/lib/appRoutes'
import { History, Radio, ArrowRight } from 'lucide-react'
import { CllpPageHeyf } from '@/shared/ui/CollapsiblePageHero'

export function ChngPage() {
  const linkedLatestWhatsNew = getLatestWhatsNew()
  const latestWhatsNewId = linkedLatestWhatsNew?.id ?? null

  return (
    <div className="page">
      <CllpPageHeyf
        variant="split"
        eyebrow="History"
        title="Changelog"
        meta="Complete history of updates and patches."
        layoutKey="changelog-hero"
        trailing={
          linkedLatestWhatsNew ? (
            <AxLink to={whatsNewHref()} className="chl-whatsnew-cta">
              <span className="chl-whatsnew-cta__icon" aria-hidden="true">
                <Radio size="1.125rem" />
              </span>
              <span className="chl-whatsnew-cta__text">
                <span className="chl-whatsnew-cta__eyebrow">What's New · latest update</span>
                <span className="chl-whatsnew-cta__title">{linkedLatestWhatsNew.title}</span>
              </span>
              <ArrowRight size="1rem" className="chl-whatsnew-cta__arrow" aria-hidden="true" />
            </AxLink>
          ) : undefined
        }
      />

      <div className="page-bento">
        {chngSctn.map((section, sectionIndex) => {
          const rvrsEnts = [...section.entries].reverse()

          return (
            <React.Fragment key={section.id}>
              {sectionIndex > 0 ? (
                <div className="chl-section-divider" aria-label={`${section.label} changelog`}>
                  <span className="chl-section-divider__line" />
                  <div className="chl-section-divider__content">
                    <span className="chl-section-divider__label">{section.label}</span>
                    <span className="chl-section-divider__sub">old stuff below...</span>
                  </div>
                  <span className="chl-section-divider__line" />
                </div>
              ) : null}

            <div className="chl-section">
              {rvrsEnts.map((log, index) => {
                const linkedWhatsNew = getLinkedWhatsNew(log)
                const showWhatsNewLink = Boolean(linkedWhatsNew && linkedWhatsNew.id !== latestWhatsNewId)

                return (
                  <section key={`${section.id}-${index}`} className="page-tile page-tile--full chl-entry">
                    <div className="chl-header">
                      <div className="tile-icon"><History /></div>
                      <div className="chl-header-text">
                        <h3 className="chl-date">{log.date}</h3>
                        {log.patchVersion && (
                          <span className="page-pill">{log.patchVersion}</span>
                        )}
                      </div>
                      {showWhatsNewLink && linkedWhatsNew ? (
                        <AxLink
                          to={whatsNewHref(linkedWhatsNew.id)} className="chl-whatsnew-cta chl-whatsnew-cta--entry"
                        >
                          <span className="chl-whatsnew-cta__icon" aria-hidden="true">
                            <Radio size="1rem" />
                          </span>
                          <span className="chl-whatsnew-cta__text">
                            <span className="chl-whatsnew-cta__eyebrow">What's New · earlier update</span>
                            <span className="chl-whatsnew-cta__title">{linkedWhatsNew.title}</span>
                          </span>
                          <ArrowRight size="1rem" className="chl-whatsnew-cta__arrow" aria-hidden="true" />
                        </AxLink>
                      ) : null}
                    </div>
                    {log.shortDesc && (
                      <HtmlContent html={log.shortDesc} className="chl-short" as="span" />
                    )}
                    <ul className="chl-detail-list">
                      {log.entries.map((entry, entryIndex) =>
                        entry.type === 'paragraph' ? (
                          <HtmlContent key={entryIndex} html={entry.content} as="li" />
                        ) : null,
                      )}
                    </ul>
                  </section>
                )
              })}
            </div>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
