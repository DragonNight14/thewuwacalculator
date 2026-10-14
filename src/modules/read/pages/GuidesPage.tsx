/*
  Author: Runor Ewhro
  description: builds searchable guide navigation, deep-link resolution,
               chapter selection, active-section tracking, and authored block
               rendering from the guide content catalog.
*/

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties as CssProps,
  type KeyboardEvent as RctKybrVnt,
  type MouseEvent as RctMsVnt,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { AnimatePresence as NmtPrsn, LayoutGroup, motion } from 'motion/react'
import { ChevronLeft, Search, X } from 'lucide-react'
import {
  gdCtgr,
  type GuideArticle,
  type GuideBlock,
  type GuideCategory,
  type GuidePlateStep,
} from '@/data/content/guidesContent'
import { resGdCtgr } from '@/modules/read/model/guides'
import { CllpPageHeyf } from '@/shared/ui/CollapsiblePageHero'
import { useNavX } from '@/shared/navigation/useNavX'
import { AnchoredAppPopup, useAppPopupDismiss } from '@/shared/ui/AppPopup'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger'

type ActiveTarget = {
  categoryId: string
  articleId: string | null
  secNchr?: string | null
} | null

const pad2 = (n: number) => String(n).padStart(2, '0')

function countBlocks(category: GuideCategory) {
  let sections = 0
  let blocks = 0
  for (const article of category.articles) {
    sections += article.sections.length
    for (const section of article.sections) {
      blocks += section.blocks.length
    }
  }
  return { articles: category.articles.length, sections, blocks }
}

function sctnNchrId(articleId: string, sectionIndex: number) {
  return `gd-s-${articleId}-${sectionIndex}`
}

function rtclNchrId(articleId: string) {
  return `gd-a-${articleId}`
}

type GuideHitKind = 'chapter' | 'article' | 'section' | 'block'

type GdSrchHit = {
  kind: GuideHitKind
  categoryId: string
  chapterIndex: number
  articleId: string | null
  secNchr: string | null
  display: string
  matchStart: number
  matchEnd: number
  breadcrumb: string
  score: number
}

type GdNdxEnt = {
  kind: GuideHitKind
  categoryId: string
  chapterIndex: number
  articleId: string | null
  articleIndex: number | null
  sectionIndex: number | null
  secNchr: string | null
  title: string
  text: string
  baseScore: number
  breadcrumb: string
}

function blckSrchText(block: GuideBlock): string {
  switch (block.type) {
    case 'paragraph':
      return block.text.join(' ')
    case 'bullets':
      return block.items.join(' ')
    case 'definitions':
      return block.items.map((entry) => `${entry.term}: ${entry.description}`).join(' ')
    case 'note':
      return block.text
    case 'steps':
      return block.items.map((entry) => `${entry.title} ${entry.description}`).join(' ')
    case 'plate':
      return block.steps.map((entry) => `${entry.title} ${entry.description}`).join(' ')
    default:
      return ''
  }
}

function mkGdSrchNdx(): GdNdxEnt[] {
  const out: GdNdxEnt[] = []
  gdCtgr.forEach((category, chapterIndex) => {
    const chapterNum = pad2(chapterIndex + 1)
    out.push({
      kind: 'chapter',
      categoryId: category.id,
      chapterIndex,
      articleId: null,
      articleIndex: null,
      sectionIndex: null,
      secNchr: null,
      title: category.title,
      text: `${category.title} ${category.summary}`,
      baseScore: 100,
      breadcrumb: `§ ${chapterNum}`,
    })
    category.articles.forEach((article, articleIndex) => {
      const articleNum = `${chapterIndex + 1}.${articleIndex + 1}`
      out.push({
        kind: 'article',
        categoryId: category.id,
        chapterIndex,
        articleId: article.id,
        articleIndex,
        sectionIndex: null,
        secNchr: null,
        title: article.title,
        text: `${article.title} ${article.summary}`,
        baseScore: 80,
        breadcrumb: `§ ${chapterNum} · ${articleNum}`,
      })
      article.sections.forEach((section, sectionIndex) => {
        const anchor = sctnNchrId(article.id, sectionIndex)
        const sectionNum = `${articleNum}.${sectionIndex + 1}`
        out.push({
          kind: 'section',
          categoryId: category.id,
          chapterIndex,
          articleId: article.id,
          articleIndex,
          sectionIndex,
          secNchr: anchor,
          title: section.title,
          text: section.title,
          baseScore: 60,
          breadcrumb: `§ ${chapterNum} · ${sectionNum}`,
        })
        section.blocks.forEach((block) => {
          const text = blckSrchText(block)
          if (!text) return
          out.push({
            kind: 'block',
            categoryId: category.id,
            chapterIndex,
            articleId: article.id,
            articleIndex,
            sectionIndex,
            secNchr: anchor,
            title: section.title,
            text,
            baseScore: 30,
            breadcrumb: `§ ${chapterNum} · ${sectionNum} · ${block.type}`,
          })
        })
      })
    })
  })
  return out
}

function makeSnippet(text: string, matchIdx: number, matchLen: number, window = 60) {
  const start = Math.max(0, matchIdx - window)
  const end = Math.min(text.length, matchIdx + matchLen + window)
  const prefix = start > 0 ? '... ' : ''
  const suffix = end < text.length ? ' ...' : ''
  const display = prefix + text.slice(start, end) + suffix
  const newMtchStart = prefix.length + (matchIdx - start)
  return {
    display,
    matchStart: newMtchStart,
    matchEnd: newMtchStart + matchLen,
  }
}

function searchGuides(index: GdNdxEnt[], query: string, limit = 8): GdSrchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  type Scored = { entry: GdNdxEnt, score: number, matchIdx: number }
  const scored: Scored[] = []
  for (const entry of index) {
    const haystack = entry.text.toLowerCase()
    const idx = haystack.indexOf(q)
    if (idx === -1) continue
    let score = entry.baseScore
    if (idx === 0) score += 20
    score -= Math.min(idx, 100) * 0.1
    scored.push({ entry, score, matchIdx: idx })
  }

  scored.sort((a, b) =>
    b.score - a.score
    || a.entry.chapterIndex - b.entry.chapterIndex
    || (a.entry.articleIndex ?? 0) - (b.entry.articleIndex ?? 0)
    || (a.entry.sectionIndex ?? 0) - (b.entry.sectionIndex ?? 0),
  )

  return scored.slice(0, limit).map(({ entry, score, matchIdx }) => {
    if (entry.kind === 'block') {
      const snippet = makeSnippet(entry.text, matchIdx, q.length)
      return {
        kind: entry.kind,
        categoryId: entry.categoryId,
        chapterIndex: entry.chapterIndex,
        articleId: entry.articleId,
        secNchr: entry.secNchr,
        display: snippet.display,
        matchStart: snippet.matchStart,
        matchEnd: snippet.matchEnd,
        breadcrumb: entry.breadcrumb,
        score,
      }
    }

    // title-bearing hit: match position may be in the summary half of `text`,
    // but we only display the title. recompute against the title.
    const titleIdx = entry.title.toLowerCase().indexOf(q)
    const start = titleIdx === -1 ? 0 : titleIdx
    const end = titleIdx === -1 ? 0 : titleIdx + q.length
    return {
      kind: entry.kind,
      categoryId: entry.categoryId,
      chapterIndex: entry.chapterIndex,
      articleId: entry.articleId,
      secNchr: entry.secNchr,
      display: entry.title,
      matchStart: start,
      matchEnd: end,
      breadcrumb: entry.breadcrumb,
      score,
    }
  })
}

const CONTENT_EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]
const CNTNFADEFAST = { duration: 0.24, ease: CONTENT_EASE }
const CONTENT_FADE = { duration: 0.5, ease: CONTENT_EASE }
const CNTNFADEOUT = { duration: 0.48, ease: CONTENT_EASE }
const CELL_TRNS = {
  layout: { type: 'spring' as const, duration: 0.6, bounce: 0 },
}
const CNTN_NTR = { duration: 0.42, delay: 0.46, ease: CONTENT_EASE }
const LAYOUT_LAYER: { willChange: string } = { willChange: 'transform' }

function ChptCardBody({
                           category,
                           chapterIndex,
                           onOpen,
                         }: {
  category: GuideCategory
  chapterIndex: number
  onOpen: (categoryId: string, articleId?: string) => void
}) {
  const counts = useMemo(() => countBlocks(category), [category])
  const number = pad2(chapterIndex + 1)

  return (
    <>
      <button
        type="button" className="gd-chapter-card__head"
        onClick={() => onOpen(category.id)}
        aria-label={`Open chapter ${number}: ${category.title}`}
      >
        <span className="gd-chapter-card__number" aria-hidden="true">§ {number}</span>
        <h2 className="gd-chapter-card__title">{category.title}</h2>
        <p className="gd-chapter-card__summary">{category.summary}</p>
      </button>

      <ol className="gd-chapter-card__contents" aria-label={`Articles in ${category.title}`}>
        {category.articles.map((article, articleIndex) => (
          <li key={article.id} className="gd-chapter-card__entry">
            <button
              type="button" className="gd-chapter-card__entry-btn"
              onClick={() => onOpen(category.id, article.id)}
            >
              <span className="gd-chapter-card__entry-num" aria-hidden="true">
                {chapterIndex + 1}.{articleIndex + 1}
              </span>
              <span className="gd-chapter-card__entry-title">{article.title}</span>
              <span className="gd-chapter-card__entry-leader" aria-hidden="true" />
              <span className="gd-chapter-card__entry-meta" aria-hidden="true">
                {article.sections.length} §
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="gd-chapter-card__meta" aria-hidden="true">
        <span>{counts.articles} {counts.articles === 1 ? 'GUIDE' : 'GUIDES'}</span>
        <span className="gd-chapter-card__dot">·</span>
        <span>{counts.sections} SECTIONS</span>
        <span className="gd-chapter-card__dot">·</span>
        <span>{counts.blocks} BLOCKS</span>
      </div>
    </>
  )
}

function ChptChipBody({
                           category,
                           chapterIndex,
                           onOpen,
                         }: {
  category: GuideCategory
  chapterIndex: number
  onOpen: (categoryId: string, articleId?: string) => void
}) {
  const number = pad2(chapterIndex + 1)
  return (
    <button
      type="button" className="gd-chip__btn"
      onClick={() => onOpen(category.id)}
      aria-label={`Open chapter ${number}: ${category.title}`}
    >
      <span className="gd-chip__num" aria-hidden="true">§ {number}</span>
      <span className="gd-chip__title">{category.title}</span>
    </button>
  )
}

function ChptCardCell({
                           category,
                           chapterIndex,
                           onOpen,
                         }: {
  category: GuideCategory
  chapterIndex: number
  onOpen: (categoryId: string, articleId?: string) => void
}) {
  return (
    <article className="gd-chapter-card"
      style={{ '--card-index': chapterIndex } as CssProps}
    >
      <div className="gd-cell-inner gd-cell-inner--card">
        <ChptCardBody category={category} chapterIndex={chapterIndex} onOpen={onOpen} />
      </div>
    </article>
  )
}

function ChptChipCell({
                           category,
                           chapterIndex,
                           onOpen,
                         }: {
  category: GuideCategory
  chapterIndex: number
  onOpen: (categoryId: string, articleId?: string) => void
}) {
  return (
    <motion.article
      layout
      layoutId={`gd-chapter-${category.id}`} className="gd-chip"
      transition={CELL_TRNS}
      style={LAYOUT_LAYER}
    >
      <div className="gd-cell-inner gd-cell-inner--chip">
        <ChptChipBody category={category} chapterIndex={chapterIndex} onOpen={onOpen} />
      </div>
    </motion.article>
  )
}

function NoteBlock({ block }: { block: Extract<GuideBlock, { type: 'note' }> }) {
  const tone = block.tone ?? 'info'
  const label = tone === 'warning' ? 'WARNING' : 'NOTE'
  return (
    <aside className={`gd-note gd-note--${tone}`}>
      <span className="gd-note__label" aria-hidden="true">{label}</span>
      <p className="gd-note__text">{block.text}</p>
    </aside>
  )
}

function ExampleBlock({ block }: { block: Extract<GuideBlock, { type: 'example' }> }) {
  return (
    <article className="gd-example">
      <header className="gd-example__head">
        <span className="gd-example__label" aria-hidden="true">Example</span>
        <h5 className="gd-example__title">{block.title}</h5>
      </header>
      <div className="gd-example__body">
        {block.setup.length > 0 ? (
          <section className="gd-example__section">
            <h6 className="gd-example__section-title">Setup</h6>
            <ul className="gd-example__list">
              {block.setup.map((item, index) => (
                <li key={index} className="gd-example__item">{item}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {block.observation.length > 0 ? (
          <section className="gd-example__section">
            <h6 className="gd-example__section-title">What Happens</h6>
            <ul className="gd-example__list">
              {block.observation.map((item, index) => (
                <li key={index} className="gd-example__item">{item}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {block.takeaway.length > 0 ? (
          <section className="gd-example__section">
            <h6 className="gd-example__section-title">Takeaway</h6>
            <ul className="gd-example__list">
              {block.takeaway.map((item, index) => (
                <li key={index} className="gd-example__item">{item}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </article>
  )
}

function StepsBlock({ block }: { block: Extract<GuideBlock, { type: 'steps' }> }) {
  return (
    <ol className="gd-steps">
      {block.items.map((item, index) => (
        <li key={`${item.title}-${index}`} className="gd-steps__item">
          <span className="gd-steps__number" aria-hidden="true">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div className="gd-steps__copy">
            <h5 className="gd-steps__title">{item.title}</h5>
            <p className="gd-steps__text">{item.description}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function CmprBlck({ block }: { block: Extract<GuideBlock, { type: 'comparison' }> }) {
  return (
    <div className="gd-compare" role="table" aria-label={`${block.leftLabel} compared with ${block.rightLabel}`}>
      <div role="rowgroup">
        <div className="gd-compare__row gd-compare__row--head" role="row">
          <span className="gd-compare__cell gd-compare__cell--label" role="columnheader" />
          <span className="gd-compare__cell gd-compare__cell--heading" role="columnheader">{block.leftLabel}</span>
          <span className="gd-compare__cell gd-compare__cell--heading" role="columnheader">{block.rightLabel}</span>
        </div>
      </div>
      <div role="rowgroup">
        {block.rows.map((row) => (
          <div key={row.label} className="gd-compare__row" role="row">
            <span className="gd-compare__cell gd-compare__cell--label" role="rowheader">{row.label}</span>
            <span className="gd-compare__cell" role="cell">{row.left}</span>
            <span className="gd-compare__cell" role="cell">{row.right}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatTblBlck({ block }: { block: Extract<GuideBlock, { type: 'statTable' }> }) {
  return (
    <div className="gd-stats-table" role="table" aria-label="Stat reference table">
      <div className="gd-stats-table__row gd-stats-table__row--head" role="row">
        <span className="gd-stats-table__cell gd-stats-table__cell--heading" role="columnheader">Stat</span>
        <span className="gd-stats-table__cell gd-stats-table__cell--heading" role="columnheader">Structure</span>
        <span className="gd-stats-table__cell gd-stats-table__cell--heading" role="columnheader">Meaning</span>
        <span className="gd-stats-table__cell gd-stats-table__cell--heading" role="columnheader">Seen In</span>
      </div>
      {block.rows.map((row) => (
        <div key={row.stat} className="gd-stats-table__row" role="row">
          <span className="gd-stats-table__cell gd-stats-table__cell--stat" role="rowheader">{row.stat}</span>
          <span className="gd-stats-table__cell" role="cell">{row.structure}</span>
          <span className="gd-stats-table__cell" role="cell">{row.meaning}</span>
          <span className="gd-stats-table__cell" role="cell">{row.surfaces}</span>
        </div>
      ))}
    </div>
  )
}

function WrnnListBlck({ block }: { block: Extract<GuideBlock, { type: 'warningList' }> }) {
  return (
    <aside className="gd-warning-list">
      <span className="gd-warning-list__label" aria-hidden="true">Watch For</span>
      <ul className="gd-warning-list__items">
        {block.items.map((item, index) => (
          <li key={index} className="gd-warning-list__item">{item}</li>
        ))}
      </ul>
    </aside>
  )
}

function ImageBlock({ block }: { block: Extract<GuideBlock, { type: 'image' }> }) {
  return (
    <figure className="gd-image">
      <img className="gd-image__img"
        src={block.src}
        alt={block.alt}
        loading="lazy"
      />
      <figcaption className="gd-image__caption">{block.caption}</figcaption>
    </figure>
  )
}

const SPARK_PATH = 'M15 1.5C16.3 10 20 13.7 28.5 15C20 16.3 16.3 20 15 28.5C13.7 20 10 16.3 1.5 15C10 13.7 13.7 10 15 1.5Z'

function Spark({ n }: { n: number }) {
  return (
    <>
      <svg className="gd-spark" viewBox="0 0 30 30" aria-hidden="true"><path d={SPARK_PATH} /></svg>
      <span className="gd-spark__n">{n}</span>
    </>
  )
}

function PlateBlock({ block }: { block: Extract<GuideBlock, { type: 'plate' }> }) {
  const shotRef = useRef<HTMLDivElement | null>(null)
  const [hot, setHot] = useState(0)
  const [held, setHeld] = useState(0)
  const [frame, setFrame] = useState({ w: 0, h: 0 })
  const lit = hot || held
  const natural = Math.round(block.width / 1.5)
  const wide = block.width / block.height >= 1.1 && natural >= 700

  useEffect(() => {
    const el = shotRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setFrame({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const toggle = (n: number) => setHeld((cur) => (cur === n ? 0 : n))

  let scale = 1
  let tx = 0
  let ty = 0
  if (held > 0 && frame.w > 0) {
    const [bx, by, bw, bh] = block.steps[held - 1].box
    const maxZoom = Math.max(1, (block.width / frame.w) * 1.2)
    scale = Math.max(1, Math.min(0.78 / (bw / 100), 0.66 / (bh / 100), maxZoom))
    const cx = ((bx + bw / 2) / 100) * frame.w
    const cy = ((by + bh / 2) / 100) * frame.h
    tx = Math.min(0, Math.max(frame.w - frame.w * scale, frame.w / 2 - cx * scale))
    ty = Math.min(0, Math.max(frame.h - frame.h * scale, frame.h / 2 - cy * scale))
  }
  const focus = lit > 0 ? block.steps[lit - 1].box : null

  const pinSize = 30
  const unmarked = new Set<number>()
  if (frame.w > 0) {
    const px = ([x, y, w, h]: GuidePlateStep['box']) => [(x / 100) * frame.w, (y / 100) * frame.h, (w / 100) * frame.w, (h / 100) * frame.h]
    block.steps.forEach(({ box }, i) => {
      const [x, y, w, h] = px(box)
      if (frame.h < 120 || w < pinSize * 1.35 || h < pinSize * 0.65) unmarked.add(i)
      block.steps.slice(i + 1).forEach(({ box: other }, j) => {
        const [ox, oy] = px(other)
        if (Math.hypot(x - ox, y - oy) < pinSize) {
          unmarked.add(i)
          unmarked.add(i + j + 1)
        }
      })
    })
  }

  const bind = (n: number) => ({
    onPointerEnter: () => setHot(n),
    onPointerLeave: () => setHot(0),
    onFocus: () => setHot(n),
    onBlur: () => setHot(0),
    onClick: (event: RctMsVnt) => {
      event.stopPropagation()
      toggle(n)
    },
  })

  return (
    <div
      className={`gd-plate gd-plate--${wide ? 'wide' : 'tall'}`}
      style={{ '--ar': block.width / block.height, '--nat': `${natural}px` } as CssProps}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && held) {
          event.stopPropagation()
          setHeld(0)
        }
      }}
    >
      <div
        ref={shotRef}
        className="gd-plate__shot"
        data-lit={lit > 0 || undefined}
        data-zoomed={held > 0 || undefined}
        style={{ aspectRatio: `${block.width} / ${block.height}`, maxWidth: `${natural}px` }}
        onClick={() => setHeld(0)}
      >
        <div
          className="gd-plate__rig"
          style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, '--inv': 1 / scale } as CssProps}
        >
          <img className="gd-plate__img" src={`/assets/app/guides/${block.shot}.webp`} alt={block.alt} width={block.width} height={block.height} loading="lazy" decoding="async" />
          {focus ? (
            <span
              className="gd-plate__focus"
              style={{ left: `${focus[0]}%`, top: `${focus[1]}%`, width: `${focus[2]}%`, height: `${focus[3]}%` }}
            />
          ) : null}
          {block.steps.map((step, index) => (
            <button
              key={step.title}
              type="button"
              className="gd-plate__pin"
              data-on={lit === index + 1 || undefined}
              data-bare={unmarked.has(index) || undefined}
              style={{ left: `max(0.95rem, ${step.box[0]}%)`, top: `max(0.95rem, ${step.box[1]}%)` }}
              aria-label={`${held === index + 1 ? 'Zoom out from' : 'Zoom to'} step ${index + 1}: ${step.title}`}
              tabIndex={-1}
              {...bind(index + 1)}
            >
              <Spark n={index + 1} />
            </button>
          ))}
        </div>
        {held > 0 ? (
          <button
            type="button"
            className="gd-plate__unzoom"
            onClick={(event) => {
              event.stopPropagation()
              setHeld(0)
            }}
          >
            <span>Step {held}</span> Zoom out
          </button>
        ) : null}
      </div>
      <ol className="gd-plate__steps">
        {block.steps.map((step, index) => (
          <li key={step.title}>
            <button
              type="button"
              className="gd-plate__step"
              data-on={lit === index + 1 || undefined}
              data-held={held === index + 1 || undefined}
              aria-pressed={held === index + 1}
              {...bind(index + 1)}
            >
              <span className="gd-plate__num" aria-hidden="true"><Spark n={index + 1} /></span>
              <span className="gd-plate__copy">
                <span className="gd-plate__title">{step.title}</span>
                <span className="gd-plate__text">{step.description}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

function assertNever(value: never): never {
  throw new Error(`Unsupported guide block: ${JSON.stringify(value)}`)
}

function renderBlocks(
  blocks: GuideBlock[],
  ctx: { sectionIndex: number, dropCapState: { used: boolean } },
): ReactNode[] {
  const out: ReactNode[] = []
  blocks.forEach((block, index) => {
    const key = `${block.type}-${index}`
    switch (block.type) {
      case 'paragraph': {
        block.text.forEach((entry, i) => {
          const withDropCap =
            ctx.sectionIndex === 0 && !ctx.dropCapState.used && i === 0
          if (withDropCap) ctx.dropCapState.used = true
          out.push(
            <p
              key={`${key}-${i}`}
              className={withDropCap ? 'gd-p gd-p--lede' : 'gd-p'}
            >
              {entry}
            </p>,
          )
        })
        break
      }
      case 'bullets': {
        out.push(
          <ol key={key} className="gd-bullets">
            {block.items.map((item, i) => (
              <li key={i} className="gd-bullets__item">{item}</li>
            ))}
          </ol>,
        )
        break
      }
      case 'definitions': {
        out.push(
          <dl key={key} className="gd-dict">
            {block.items.map((item) => (
              <Fragment key={item.term}>
                <dt className="gd-dict__term">{item.term}</dt>
                <dd className="gd-dict__desc">{item.description}</dd>
              </Fragment>
            ))}
          </dl>,
        )
        break
      }
      case 'note': {
        out.push(<NoteBlock key={key} block={block} />)
        break
      }
      case 'example': {
        out.push(<ExampleBlock key={key} block={block} />)
        break
      }
      case 'steps': {
        out.push(<StepsBlock key={key} block={block} />)
        break
      }
      case 'comparison': {
        out.push(<CmprBlck key={key} block={block} />)
        break
      }
      case 'statTable': {
        out.push(<StatTblBlck key={key} block={block} />)
        break
      }
      case 'warningList': {
        out.push(<WrnnListBlck key={key} block={block} />)
        break
      }
      case 'image': {
        out.push(<ImageBlock key={key} block={block} />)
        break
      }
      case 'plate': {
        out.push(<PlateBlock key={key} block={block} />)
        break
      }
      default: {
        assertNever(block)
      }
    }
  })
  return out
}

function ArticleView({
                       article,
                       chapterIndex,
                       articleIndex,
                     }: {
  article: GuideArticle
  chapterIndex: number
  articleIndex: number
}) {
  const rtclNmbr = `${chapterIndex + 1}.${articleIndex + 1}`
  const dropCapState = { used: false }

  return (
    <article id={rtclNchrId(article.id)} className="gd-article">
      <header className="gd-article__head">
        <span className="gd-article__number" aria-hidden="true">{rtclNmbr}</span>
        <div>
          <h3 className="gd-article__title">{article.title}</h3>
          <p className="gd-article__summary">{article.summary}</p>
        </div>
      </header>

      <div className="gd-article__body">
        {article.sections.map((section, sectionIndex) => (
          <section
            key={`${section.title}-${sectionIndex}`}
            id={sctnNchrId(article.id, sectionIndex)} className="gd-section"
            data-section-anchor={sctnNchrId(article.id, sectionIndex)}
          >
            <header className="gd-section__head">
              <span className="gd-section__number" aria-hidden="true">
                {rtclNmbr}.{sectionIndex + 1}
              </span>
              <h4 className="gd-section__title">{section.title}</h4>
            </header>
            <div className="gd-section__body">
              {renderBlocks(section.blocks, {
                sectionIndex,
                dropCapState,
              })}
            </div>
          </section>
        ))}
      </div>
    </article>
  )
}

function ChptRdr({
                         category,
                         chapterIndex,
                         ntlArtId: initRtclId,
                         ntlSecNchr: initSctnNchr,
                         onClose,
                         isSwtcChpt: isSwtcChpt,
                       }: {
  category: GuideCategory
  chapterIndex: number
  ntlArtId: string | null
  ntlSecNchr: string | null
  onClose: () => void
  isSwtcChpt: boolean
}) {
  const number = pad2(chapterIndex + 1)
  const containerRef = useRef<HTMLElement | null>(null)
  const [actSctnNchr, setActSctnNc] = useState<string | null>(() => {
    const first = category.articles[0]
    return first ? sctnNchrId(first.id, 0) : null
  })

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // defer anchor resolution until the selected chapter has committed its measurements.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const scroller = container.closest<HTMLElement>('.page')
    if (!scroller) return

    // a section anchor is more specific than its containing article anchor.
    const sctnTgt = initSctnNchr
      ? container.querySelector<HTMLElement>(`#${CSS.escape(initSctnNchr)}`)
      : null
    const rtclTgt = initRtclId
      ? container.querySelector<HTMLElement>(`#${CSS.escape(rtclNchrId(initRtclId))}`)
      : null
    const target = sctnTgt ?? rtclTgt ?? container
    const delay = isSwtcChpt ? 720 : 0
    const timer = window.setTimeout(() => {
      if (!target) return
      const targetTop = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      const remInPx = parseFloat(
        getComputedStyle(document.documentElement).fontSize
      )
      const offset = 8 * remInPx + 2
      scroller.scrollTo({
        top: scroller.scrollTop + targetTop - offset,
        behavior: 'smooth',
      })
    }, delay)
    return () => window.clearTimeout(timer)
  }, [category.id, initRtclId, initSctnNchr, isSwtcChpt])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const scroller = container.closest<HTMLElement>('.page')
    const observerRoot = scroller ?? null

    const anchors = Array.from(
      container.querySelectorAll<HTMLElement>('[data-section-anchor]'),
    )
    if (anchors.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
      // select the topmost intersecting section as the active anchor.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0) {
          setActSctnNc(visible[0].target.getAttribute('data-section-anchor'))
        }
      },
      {
        root: observerRoot,
        rootMargin: '-20% 0px -65% 0px',
        threshold: 0,
      },
    )

    for (const anchor of anchors) observer.observe(anchor)

    return () => observer.disconnect()
  }, [category.id])

  const jumpTo = useCallback((anchorId: string) => {
    const container = containerRef.current
    if (!container) return
    const scroller = container.closest<HTMLElement>('.page')
    const target = container.querySelector<HTMLElement>(`#${CSS.escape(anchorId)}`)
    if (!scroller || !target) return
    const targetTop = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTo({ top: scroller.scrollTop + targetTop - 24, behavior: 'smooth' })
  }, [])

  return (
    <motion.article
      ref={containerRef}
      layout
      layoutId={`gd-chapter-${category.id}`} className="gd-reader"
      transition={CELL_TRNS}
      style={LAYOUT_LAYER}
    >
      <motion.div className="gd-cell-inner gd-cell-inner--reader"
        initial={isSwtcChpt ? { opacity: 0 } : false}
        animate={{
          opacity: 1,
          transition: isSwtcChpt ? CNTN_NTR : CNTNFADEFAST,
        }}
      >
        <header className="gd-reader__masthead">
          <span className="gd-reader__number" aria-hidden="true">§ {number}</span>
          <div className="gd-reader__heading">
            <span className="gd-reader__eyebrow">Chapter {number}</span>
            <h2 className="gd-reader__title">{category.title}</h2>
            <p className="gd-reader__summary">{category.summary}</p>
          </div>
          <button
            type="button" className="gd-reader__close"
            onClick={onClose}
            aria-label="Close chapter"
          >
            <span>Close</span>
            <X size="0.875rem" aria-hidden="true" />
          </button>
        </header>

        <div className="gd-reader__layout">
          <aside className="gd-reader__rail" aria-label="On this page">
            <div className="gd-reader__rail-sticky">
              <span className="gd-reader__rail-label">On this page</span>
              <ol className="gd-reader__rail-list">
                {category.articles.map((article, articleIndex) => {
                  const rtclNchrAct = article.sections.some(
                    (_, idx) => sctnNchrId(article.id, idx) === actSctnNchr,
                  )
                  return (
                    <li key={article.id} className="gd-reader__rail-article">
                      <button
                        type="button" className="gd-reader__rail-article-btn"
                        data-active={rtclNchrAct || undefined}
                        onClick={() => jumpTo(rtclNchrId(article.id))}
                      >
                        <span className="gd-reader__rail-num" aria-hidden="true">
                          {chapterIndex + 1}.{articleIndex + 1}
                        </span>
                        <span>{article.title}</span>
                      </button>
                      <ol className="gd-reader__rail-sections">
                        {article.sections.map((section, sectionIndex) => {
                          const anchor = sctnNchrId(article.id, sectionIndex)
                          const isActive = anchor === actSctnNchr
                          return (
                            <li key={anchor}>
                              <button
                                type="button" className="gd-reader__rail-section-btn"
                                data-active={isActive || undefined}
                                aria-current={isActive ? 'location' : undefined}
                                onClick={() => jumpTo(anchor)}
                              >
                                {section.title}
                              </button>
                            </li>
                          )
                        })}
                      </ol>
                    </li>
                  )
                })}
              </ol>
            </div>
          </aside>

          <details className="gd-reader__rail-mobile">
            <summary>Contents</summary>
            <ol className="gd-reader__rail-mobile-list">
              {category.articles.map((article, articleIndex) => (
                <li key={article.id}>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                      jumpTo(rtclNchrId(article.id))
                    }}
                  >
                    <span className="gd-reader__rail-num">
                      {chapterIndex + 1}.{articleIndex + 1}
                    </span>
                    {article.title}
                  </button>
                </li>
              ))}
            </ol>
          </details>

          <div className="gd-reader__content">
            {category.articles.map((article, articleIndex) => (
              <ArticleView
                key={article.id}
                article={article}
                chapterIndex={chapterIndex}
                articleIndex={articleIndex}
              />
            ))}

            <footer className="gd-reader__footer">
              <button type="button" className="gd-reader__close gd-reader__close--bottom" onClick={onClose}>
                <X size="0.875rem" aria-hidden="true" />
                <span>Close · § {number}</span>
              </button>
            </footer>
          </div>
        </div>
      </motion.div>
    </motion.article>
  )
}

function GuideSearch({ onSelectHit }: { onSelectHit: (hit: GdSrchHit) => void }) {
  const index = useMemo(() => mkGdSrchNdx(), [])
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [selNdx, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)

  const hits = useMemo(() => searchGuides(index, query), [index, query])
  const trimmed = query.trim()
  const safeSelNdx = hits.length === 0 ? 0 : Math.min(selNdx, hits.length - 1)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== '/') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = document.activeElement as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      event.preventDefault()
      const input = inputRef.current
      if (!input) return
      // suppress implicit focus scrolling because this handler sets the scroll target.
      input.focus({ preventScroll: true })
      input.select()
      const field = rootRef.current ?? input
      field.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useAppPopupDismiss({
    open: isOpen,
    onDismiss: () => setIsOpen(false),
    hostRef: rootRef,
    popupRef,
  })

  const selectHit = useCallback((hit: GdSrchHit) => {
    onSelectHit(hit)
    setIsOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }, [onSelectHit])

  const onKeyDown = (event: RctKybrVnt<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (trimmed.length > 0 || isOpen) {
        event.preventDefault()
        setQuery('')
        setIsOpen(false)
      }
      return
    }
    if (!isOpen || hits.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((idx) => {
        const base = Math.min(idx, hits.length - 1)
        return (base + 1) % hits.length
      })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((idx) => {
        const base = Math.min(idx, hits.length - 1)
        return (base - 1 + hits.length) % hits.length
      })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[safeSelNdx]
      if (hit) selectHit(hit)
    }
  }

  const popoverOpen = isOpen && trimmed.length > 0

  return (
    <div ref={rootRef} className="gd-search" role="search">
      <div className="gd-search__field" data-open={popoverOpen || undefined}>
        <Search size="1rem" className="gd-search__icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setIsOpen(true)
            setActiveIndex(0)
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="search the guides"
          autoComplete="off"
          spellCheck={false} className="gd-search__input"
          aria-controls="guide-search-popover"
          aria-expanded={popoverOpen}
          aria-autocomplete="list"
        />
        <span className="gd-search__shortcut" aria-hidden="true">/</span>
      </div>
      <AnchoredAppPopup
        visible={popoverOpen}
        anchorRef={rootRef}
        popupRef={popupRef}
        anchorWidth="exact"
        maxHeight={448}
        id="guide-search-popover" className="gd-search__popover"
        open={popoverOpen}
        role="listbox"
      >
          {hits.length === 0 ? (
            <div className="gd-search__empty">no matches for &quot;{trimmed}&quot;</div>
          ) : (
            hits.map((hit, i) => {
              const isActive = i === safeSelNdx
              const before = hit.display.slice(0, hit.matchStart)
              const match = hit.display.slice(hit.matchStart, hit.matchEnd)
              const after = hit.display.slice(hit.matchEnd)
              return (
                <button
                  key={`${hit.kind}-${hit.categoryId}-${hit.articleId ?? ''}-${hit.secNchr ?? ''}-${i}`}
                  type="button" className="gd-search__hit"
                  data-active={isActive || undefined}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectHit(hit)}
                >
                  <span className="gd-search__badge">{hit.kind}</span>
                  <span className="gd-search__title">
                    {before}
                    {match ? <mark className="gd-search__mark">{match}</mark> : null}
                    {after}
                  </span>
                  <span className="gd-search__crumb">{hit.breadcrumb}</span>
                </button>
              )
            })
          )}
      </AnchoredAppPopup>
    </div>
  )
}

function RdrChipStrp({
                           activeCategory: activeCategory,
                           openChapter,
                           closeChapter,
                           openChptAt: openChptAt,
                         }: {
  activeCategory: GuideCategory
  openChapter: (categoryId: string, articleId?: string) => void
  closeChapter: () => void
  openChptAt: (target: {
    categoryId: string
    articleId?: string | null
    secNchr?: string | null
  }) => void
}) {
  const [searchOpen, setSrchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selNdx, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)

  const index = useMemo(() => mkGdSrchNdx(), [])
  const hits = useMemo(() => searchGuides(index, query), [index, query])
  const trimmed = query.trim()
  const safeSelNdx = hits.length === 0 ? 0 : Math.min(selNdx, hits.length - 1)
  const popoverOpen = searchOpen && trimmed.length > 0

  const openSearch = useCallback(() => {
    setSrchOpen(true)
    requestAnimationFrame(() => {
      const input = inputRef.current
      const wrap = wrapRef.current
      if (!input) return
      input.focus({ preventScroll: true })
      input.select()
      wrap?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const closeSearch = useCallback(() => {
    setSrchOpen(false)
    inputRef.current?.blur()
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== '/') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = document.activeElement as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      event.preventDefault()
      openSearch()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [openSearch])

  useAppPopupDismiss({
    open: searchOpen,
    onDismiss: closeSearch,
    hostRef: wrapRef,
    popupRef,
  })

  const selectHit = useCallback((hit: GdSrchHit) => {
    openChptAt({
      categoryId: hit.categoryId,
      articleId: hit.articleId,
      secNchr: hit.secNchr,
    })
    setSrchOpen(false)
    inputRef.current?.blur()
  }, [openChptAt])

  const onKeyDown = (event: RctKybrVnt<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSearch()
      return
    }
    if (!popoverOpen || hits.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((idx) => {
        const base = Math.min(idx, hits.length - 1)
        return (base + 1) % hits.length
      })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((idx) => {
        const base = Math.min(idx, hits.length - 1)
        return (base - 1 + hits.length) % hits.length
      })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[safeSelNdx]
      if (hit) selectHit(hit)
    }
  }

  return (
    <div ref={wrapRef} className="gd-chip-strip-wrap" data-search-open={searchOpen || undefined}>
      <motion.div className="gd-chip-strip" layout transition={CELL_TRNS}>
        <NmtPrsn mode="wait" initial={false}>
          {searchOpen ? (
            <motion.div
              key="search-mode" className="gd-chip-strip__search"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={CNTNFADEFAST}
            >
              <Search size="1rem" className="gd-search__icon" aria-hidden="true" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActiveIndex(0)
                }}
                onKeyDown={onKeyDown}
                placeholder="search the guides"
                autoComplete="off"
                spellCheck={false} className="gd-search__input"
                aria-controls="guide-search-popover"
                aria-expanded={popoverOpen}
                aria-autocomplete="list"
              />
              <button
                type="button" className="gd-chip-strip__esc"
                onClick={closeSearch}
                aria-label="close search"
              >
                esc
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="chip-mode" className="gd-chip-strip__chips"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={CNTNFADEFAST}
            >
              <motion.button
                type="button"
                layout className="gd-chip-back"
                onClick={closeChapter}
                transition={CELL_TRNS}
                aria-label="Back to all chapters"
              >
                <ChevronLeft size="0.875rem" aria-hidden="true" />
                <span>All chapters</span>
              </motion.button>
              <button
                type="button" className="gd-chip-search"
                data-has-query={trimmed.length > 0 || undefined}
                onClick={openSearch}
                aria-label={trimmed ? `open search, current query ${trimmed}` : 'open search'}
              >
                <Search size="0.875rem" aria-hidden="true" />
                {trimmed ? (
                  <span className="gd-chip-search__query">{trimmed}</span>
                ) : (
                  <span className="gd-chip-search__placeholder">search</span>
                )}
              </button>
              {gdCtgr.map((category, index) =>
                category.id === activeCategory.id ? null : (
                  <ChptChipCell
                    key={category.id}
                    category={category}
                    chapterIndex={index}
                    onOpen={openChapter}
                  />
                ),
              )}
            </motion.div>
          )}
        </NmtPrsn>
      </motion.div>
      <AnchoredAppPopup
        visible={popoverOpen}
        anchorRef={wrapRef}
        popupRef={popupRef}
        anchorWidth="exact"
        maxHeight={448}
        id="guide-search-popover" className="gd-search__popover"
        open={popoverOpen}
        role="listbox"
      >
          {hits.length === 0 ? (
            <div className="gd-search__empty">no matches for &quot;{trimmed}&quot;</div>
          ) : (
            hits.map((hit, i) => {
              const isActive = i === safeSelNdx
              const before = hit.display.slice(0, hit.matchStart)
              const match = hit.display.slice(hit.matchStart, hit.matchEnd)
              const after = hit.display.slice(hit.matchEnd)
              return (
                <button
                  key={`${hit.kind}-${hit.categoryId}-${hit.articleId ?? ''}-${hit.secNchr ?? ''}-${i}`}
                  type="button" className="gd-search__hit"
                  data-active={isActive || undefined}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectHit(hit)}
                >
                  <span className="gd-search__badge">{hit.kind}</span>
                  <span className="gd-search__title">
                    {before}
                    {match ? <mark className="gd-search__mark">{match}</mark> : null}
                    {after}
                  </span>
                  <span className="gd-search__crumb">{hit.breadcrumb}</span>
                </button>
              )
            })
          )}
      </AnchoredAppPopup>
    </div>
  )
}

function readTgtFromL(search: string, hash: string): ActiveTarget {
  const params = new URLSearchParams(search)
  const rqstCtgr = params.get('category') ?? hash?.replace('#', '')
  const rqstRtcl = params.get('article')
  const rqstSctn = params.get('section')
  const category = resGdCtgr(gdCtgr, rqstCtgr)
  if (!category) return null
  return {
    categoryId: category.id,
    articleId: rqstRtcl ?? null,
    secNchr: rqstSctn ?? null,
  }
}

export function GuidesPage() {
  const location = useLocation()
  const navigate = useNavX()
  const [active, setActive] = useState<ActiveTarget>(() =>
    typeof window === 'undefined'
      ? null
      : readTgtFromL(window.location.search, window.location.hash),
  )

  const [isSwtcChpt, setIsSwtcChp] = useState(false)
  const lastLctnKeyR = useRef<string | null>(null)
  const rstrScrlRef = useRef<number | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const chptNdxById = useMemo(
    () => Object.fromEntries(gdCtgr.map((category, index) => [category.id, index])),
    [],
  )

  const openChptAt = useCallback((target: {
    categoryId: string
    articleId?: string | null
    secNchr?: string | null
  }) => {
    const articleId = target.articleId ?? null
    const sctnNchr = target.secNchr ?? null
    if (
      active?.categoryId === target.categoryId
      && articleId === (active?.articleId ?? null)
      && sctnNchr === (active?.secNchr ?? null)
    ) {
      return
    }
    const page = rootRef.current?.querySelector<HTMLElement>('.page') ?? null
    rstrScrlRef.current = page?.scrollTop ?? null
    setIsSwtcChp(Boolean(active?.categoryId && active.categoryId !== target.categoryId))
    setActive({ categoryId: target.categoryId, articleId, secNchr: sctnNchr })
  }, [active])

  const openChapter = useCallback((categoryId: string, articleId?: string) => {
    openChptAt({ categoryId, articleId: articleId ?? null, secNchr: null })
  }, [openChptAt])

  const closeChapter = useCallback(() => {
    setIsSwtcChp(false)
    setActive(null)
    requestAnimationFrame(() => {
      const page = rootRef.current?.querySelector<HTMLElement>('.page') ?? null
      if (!page) return
      if (rstrScrlRef.current != null) {
        page.scrollTop = rstrScrlRef.current
      }
    })
  }, [])

  // initial url state is consumed lazily; this effect handles later deep-link changes.
  useEffect(() => {
    const key = `${location.search}::${location.hash}`
    const isFirstRun = lastLctnKeyR.current === null
    if (!isFirstRun && key === lastLctnKeyR.current) return
    lastLctnKeyR.current = key

    if (!isFirstRun) {
      const target = readTgtFromL(location.search, location.hash)
      if (target) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing react state with the url is a legitimate external-source sync; the alternative is a stale deep link.
        setActive(target)
      }
    }

    if (
      location.search.includes('category=')
      || location.search.includes('article=')
      || location.search.includes('section=')
    ) {
      const url = new URL(window.location.href)
      url.searchParams.delete('category')
      url.searchParams.delete('article')
      url.searchParams.delete('section')
      navigate(`${url.pathname}${url.search}${url.hash}`, { replace: true })
    }
  }, [location, navigate])

  const activeCategory = active
    ? gdCtgr.find((category) => category.id === active.categoryId) ?? null
    : null

  return (
    <ContextTrigger
      asChild
      ariaLabel="Guides actions"
      getItems={(event) => {
        const target = event.target
        if (target instanceof Element && target.closest('button, input, a, [role="button"]')) return []
        return activeCategory ? [
          { id: 'guides:all', label: 'All chapters', onSelect: closeChapter },
          { id: 'guides:articles', label: 'Open article...', submenu: activeCategory.articles.map((article) => ({
            id: `guides:article:${article.id}`, label: article.title,
            onSelect: () => openChapter(activeCategory.id, article.id),
          })) },
        ] : [{
          id: 'guides:chapters', label: 'Open chapter...', submenu: gdCtgr.map((category) => ({
            id: `guides:chapter:${category.id}`, label: category.title,
            onSelect: () => openChapter(category.id),
          })),
        }]
      }}
    >
    <div ref={rootRef} className="page guides-page" data-codex-state={active ? 'reader' : 'index'}>
      <CllpPageHeyf
        eyebrow="Documentation"
        title="Guides"
        subtitle="How to navigate the app and use each page."
        layoutKey="guides-hero"
        onFltnCtvt={closeChapter}
        floatingTop={active ? 'calc(env(safe-area-inset-top, 0px) + 3rem)' : undefined}
      />

      <div className="gd-codex">
        <NmtPrsn initial={false}>
          {!activeCategory ? (
            <motion.div
              key="guide-index-search"
              layout
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{
                opacity: 1,
                height: 'auto',
                marginBottom: 20,
                transition: {
                  opacity: CONTENT_FADE,
                  height: { duration: 0.5, ease: CONTENT_EASE },
                  marginBottom: { duration: 0.5, ease: CONTENT_EASE },
                },
              }}
              exit={{
                opacity: 0,
                height: 0,
                marginBottom: 0,
                transition: {
                  opacity: { duration: 0.22, ease: CONTENT_EASE },
                  height: { duration: 0.5, ease: CONTENT_EASE },
                  marginBottom: { duration: 0.5, ease: CONTENT_EASE },
                },
              }}
            >
              <GuideSearch
                onSelectHit={(hit) => {
                  openChptAt({
                    categoryId: hit.categoryId,
                    articleId: hit.articleId,
                    secNchr: hit.secNchr,
                  })
                }}
              />
            </motion.div>
          ) : null}
        </NmtPrsn>
        <LayoutGroup id="gd-codex">
          <NmtPrsn mode="wait" initial={false}>
            {activeCategory ? (
              <motion.div
                key="reader-mode" className="gd-codex-reader-mode"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  transition: { duration: 0.52, delay: 0.1, ease: CONTENT_EASE },
                }}
                exit={{ opacity: 0, transition: CNTNFADEOUT }}
              >
                <RdrChipStrp
                  activeCategory={activeCategory}
                  openChapter={openChapter}
                  closeChapter={closeChapter}
                  openChptAt={openChptAt}
                />

                <ChptRdr
                  key={`reader-${activeCategory.id}`}
                  category={activeCategory}
                  chapterIndex={chptNdxById[activeCategory.id] ?? 0}
                  ntlArtId={active?.articleId ?? null}
                  ntlSecNchr={active?.secNchr ?? null}
                  onClose={closeChapter}
                  isSwtcChpt={isSwtcChpt}
                />
              </motion.div>
            ) : (
              <motion.div
                key="grid-mode" className="gd-codex-index"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: CONTENT_FADE }}
                exit={{ opacity: 0, transition: CNTNFADEOUT }}
              >
                {gdCtgr.map((category, index) => (
                  <ChptCardCell
                    key={category.id}
                    category={category}
                    chapterIndex={index}
                    onOpen={openChapter}
                  />
                ))}
              </motion.div>
            )}
          </NmtPrsn>
        </LayoutGroup>
      </div>
    </div>
    </ContextTrigger>
  )
}
