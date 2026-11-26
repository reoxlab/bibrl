// Copyright (C) 2026 Francisco Peña Gallardo (Reox Lab)
//
// This file is part of bibRL.
//
// bibRL is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// bibRL is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with bibRL. If not, see <https://www.gnu.org/licenses/>.

// Interfaz del modo Importar: pegado de identificadores, progreso por línea, vista previa, copia y descarga .bib.

import { type BibEntry, formatEntry } from './bibtex.ts'
import { fetchMetadata } from './fetchers.ts'
import type { IdentifierKind, ParsedIdentifier } from './identifiers.ts'
import { type ImportReport, buildBibText, processIdentifiers } from './importFlow.ts'
import type { TrackFn } from './main.ts'

export const EXAMPLE_IDENTIFIERS: readonly string[] = [
  '10.1038/nature12373',
  '1706.03762',
  '9780262035613',
  '31283921',
]

const KIND_LABELS: Record<IdentifierKind, string> = {
  doi: 'DOI',
  arxiv: 'arXiv',
  isbn: 'ISBN',
  pmid: 'PMID',
  unknown: 'desconocido',
}

const COPY_FEEDBACK_MS = 2000

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Continuar al fallback clásico si el navegador deniega Clipboard API.
    }
  }

  const temp = document.createElement('textarea')
  temp.value = text
  temp.setAttribute('readonly', '')
  temp.style.position = 'fixed'
  temp.style.top = '-9999px'
  temp.style.left = '-9999px'
  document.body.appendChild(temp)
  temp.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    temp.remove()
  }
  return copied
}

function downloadBibFile(content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'bibrl.bib'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1000)
}

function formatSummaryText(report: ImportReport): string {
  const entriesLabel =
    report.entries.length === 1 ? '1 entrada generada' : `${report.entries.length} entradas generadas`
  const parts: string[] = [entriesLabel]

  if (report.failures.length > 0) {
    parts.push(report.failures.length === 1 ? '1 fallo' : `${report.failures.length} fallos`)
  }
  if (report.duplicates.length > 0) {
    parts.push(
      report.duplicates.length === 1
        ? '1 duplicado ignorado'
        : `${report.duplicates.length} duplicados ignorados`,
    )
  }

  return parts.join(' · ')
}

function createCopyFeedbackController(): (button: HTMLButtonElement, defaultLabel: string) => void {
  const timers = new WeakMap<HTMLButtonElement, number>()
  return (button: HTMLButtonElement, defaultLabel: string): void => {
    const prev = timers.get(button)
    if (prev !== undefined) {
      window.clearTimeout(prev)
    }
    button.textContent = 'Copiado'
    const timer = window.setTimeout(() => {
      button.textContent = defaultLabel
      timers.delete(button)
    }, COPY_FEEDBACK_MS)
    timers.set(button, timer)
  }
}

export function mountImportUI(panel: HTMLElement, track: TrackFn): void {
  panel.replaceChildren()

  const label = document.createElement('label')
  label.className = 'br-label'
  label.htmlFor = 'br-identifiers'
  label.textContent = 'Identificadores (uno por línea, hasta 50: DOI, arXiv, ISBN o PMID)'

  const textarea = document.createElement('textarea')
  textarea.id = 'br-identifiers'
  textarea.className = 'br-textarea'
  textarea.placeholder = EXAMPLE_IDENTIFIERS.join('\n')
  textarea.spellcheck = false

  const controlsRow = document.createElement('div')
  controlsRow.className = 'br-button-row'

  const searchBtn = document.createElement('button')
  searchBtn.type = 'button'
  searchBtn.className = 'br-button'
  searchBtn.textContent = 'Buscar metadatos'

  const exampleBtn = document.createElement('button')
  exampleBtn.type = 'button'
  exampleBtn.className = 'br-button br-button--secondary'
  exampleBtn.textContent = 'Pegar ejemplo'

  const copyAllBtn = document.createElement('button')
  copyAllBtn.type = 'button'
  copyAllBtn.className = 'br-button br-button--secondary'
  copyAllBtn.textContent = 'Copiar todo'
  copyAllBtn.disabled = true

  const downloadBtn = document.createElement('button')
  downloadBtn.type = 'button'
  downloadBtn.className = 'br-button br-button--secondary'
  downloadBtn.textContent = 'Descargar .bib'
  downloadBtn.disabled = true

  controlsRow.append(searchBtn, exampleBtn, copyAllBtn, downloadBtn)

  const noticeEl = document.createElement('p')
  noticeEl.className = 'br-note'
  noticeEl.hidden = true

  const summaryEl = document.createElement('div')
  summaryEl.className = 'br-summary'
  summaryEl.setAttribute('role', 'status')
  summaryEl.setAttribute('aria-live', 'polite')
  summaryEl.hidden = true

  const statusContainer = document.createElement('div')
  const failuresContainer = document.createElement('div')
  const entriesContainer = document.createElement('div')

  panel.append(
    label,
    textarea,
    controlsRow,
    noticeEl,
    summaryEl,
    statusContainer,
    failuresContainer,
    entriesContainer,
  )

  let isSearching = false
  let currentEntries: BibEntry[] = []
  const triggerCopiedFeedback = createCopyFeedbackController()

  function renderStatusRow(
    item: ParsedIdentifier,
    duplicateOfLine: number | undefined,
  ): { li: HTMLLIElement; statusSpan: HTMLSpanElement } {
    const li = document.createElement('li')
    li.className = 'br-status-item'

    const lineSpan = document.createElement('span')
    lineSpan.className = 'br-status-line'
    lineSpan.textContent = `Línea ${item.line}`

    const rawCode = document.createElement('code')
    rawCode.className = 'br-status-raw'
    rawCode.textContent = item.raw.trim()

    const kindSpan = document.createElement('span')
    kindSpan.className = 'br-status-kind'
    kindSpan.textContent = KIND_LABELS[item.kind]

    const statusSpan = document.createElement('span')
    if (duplicateOfLine !== undefined) {
      statusSpan.className = 'br-status br-status--dup'
      statusSpan.textContent = `duplicado (igual que la línea ${duplicateOfLine})`
    } else if (item.kind === 'unknown' || item.normalized === null) {
      statusSpan.className = 'br-status br-status--fail'
      statusSpan.textContent = `fallido — ${item.error ?? 'Formato no reconocido'}`
    } else {
      statusSpan.className = 'br-status br-status--pending'
      statusSpan.textContent = 'pendiente'
    }

    li.append(lineSpan, rawCode, kindSpan, statusSpan)
    return { li, statusSpan }
  }

  function renderFailures(report: ImportReport): void {
    failuresContainer.replaceChildren()
    if (report.failures.length === 0) return

    const box = document.createElement('section')
    box.className = 'br-fail-list'

    const heading = document.createElement('h3')
    heading.textContent =
      report.failures.length === 1
        ? '1 identificador no se pudo resolver'
        : `${report.failures.length} identificadores no se pudieron resolver`

    const list = document.createElement('ul')
    for (const failure of report.failures) {
      const li = document.createElement('li')
      li.textContent = `línea ${failure.line}: ${failure.raw.trim()} — ${failure.reason}`
      list.appendChild(li)
    }

    box.append(heading, list)
    failuresContainer.appendChild(box)
  }

  function renderEntries(entries: readonly BibEntry[]): void {
    entriesContainer.replaceChildren()
    if (entries.length === 0) return

    for (const entry of entries) {
      const bibCode = formatEntry(entry)

      const card = document.createElement('article')
      card.className = 'br-entry'

      const head = document.createElement('div')
      head.className = 'br-entry-head'

      const meta = document.createElement('div')
      meta.className = 'br-entry-meta'

      const keySpan = document.createElement('span')
      keySpan.className = 'br-entry-key'
      keySpan.textContent = entry.key

      const srcSpan = document.createElement('span')
      srcSpan.className = 'br-entry-src'
      srcSpan.textContent = `${KIND_LABELS[entry.sourceKind]}: ${entry.sourceId}`

      meta.append(keySpan, srcSpan)

      if (entry.reviewable) {
        const badge = document.createElement('span')
        badge.className = 'br-badge br-badge--review'
        badge.textContent = 'revisar'
        badge.title = 'El tipo de entrada se asignó por aproximación y conviene revisarlo'
        meta.appendChild(badge)
      }

      const copyBtn = document.createElement('button')
      copyBtn.type = 'button'
      copyBtn.className = 'br-button br-button--secondary br-button--compact'
      copyBtn.textContent = 'Copiar'
      copyBtn.addEventListener('click', () => {
        void copyToClipboard(bibCode).then((ok) => {
          if (ok) {
            triggerCopiedFeedback(copyBtn, 'Copiar')
            track('bibrl-copiar')
          } else {
            noticeEl.textContent = 'No se pudo copiar al portapapeles. Copia el texto manualmente.'
            noticeEl.hidden = false
          }
        })
      })

      head.append(meta, copyBtn)

      const pre = document.createElement('pre')
      pre.textContent = bibCode

      card.append(head, pre)
      entriesContainer.appendChild(card)
    }
  }

  exampleBtn.addEventListener('click', () => {
    if (isSearching) return
    textarea.value = EXAMPLE_IDENTIFIERS.join('\n')
    noticeEl.hidden = true
    textarea.focus()
  })

  copyAllBtn.addEventListener('click', () => {
    if (currentEntries.length === 0) return
    const allBib = buildBibText(currentEntries)
    void copyToClipboard(allBib).then((ok) => {
      if (ok) {
        triggerCopiedFeedback(copyAllBtn, 'Copiar todo')
        track('bibrl-copiar')
      } else {
        noticeEl.textContent = 'No se pudo copiar al portapapeles. Copia el texto manualmente.'
        noticeEl.hidden = false
      }
    })
  })

  downloadBtn.addEventListener('click', () => {
    if (currentEntries.length === 0) return
    downloadBibFile(buildBibText(currentEntries))
    track('bibrl-descargar')
  })

  searchBtn.addEventListener('click', () => {
    if (isSearching) return

    const inputText = textarea.value
    if (inputText.replace(/[\s\u200B\uFEFF]+/g, '') === '') {
      noticeEl.textContent = 'Pega al menos un identificador (DOI, arXiv, ISBN o PMID) para buscar.'
      noticeEl.hidden = false
      textarea.focus()
      return
    }

    // Decisión de UX: al iniciar una búsqueda nueva se conservan las líneas del textarea,
    // se limpian los resultados anteriores (y se deshabilitan Copiar todo / Descargar) para
    // evitar copiar resultados obsoletos mientras la nueva lista de estados progresa en vivo.
    isSearching = true
    currentEntries = []
    searchBtn.disabled = true
    searchBtn.textContent = 'Buscando…'
    exampleBtn.disabled = true
    copyAllBtn.disabled = true
    downloadBtn.disabled = true
    noticeEl.hidden = true
    summaryEl.hidden = true
    statusContainer.replaceChildren()
    failuresContainer.replaceChildren()
    entriesContainer.replaceChildren()

    const statusSpansByLine = new Map<number, HTMLSpanElement>()

    void processIdentifiers(inputText, (id) => fetchMetadata(id), {
      onParsed: ({ items, duplicates, ignoredExtra }) => {
        track('bibrl-importar', { total: String(items.length) })

        if (ignoredExtra > 0) {
          noticeEl.textContent =
            ignoredExtra === 1
              ? 'Se procesaron los primeros 50 identificadores (1 línea extra ignorada).'
              : `Se procesaron los primeros 50 identificadores (${ignoredExtra} líneas extra ignoradas).`
          noticeEl.hidden = false
        }

        if (items.length === 0) return

        const duplicateMap = new Map<number, number>()
        for (const dup of duplicates) {
          duplicateMap.set(dup.line, dup.firstLine)
        }

        const reportBox = document.createElement('section')
        reportBox.className = 'br-report'

        const heading = document.createElement('h3')
        heading.textContent = 'Estado por línea'

        const list = document.createElement('ul')
        list.className = 'br-status-list'

        for (const item of items) {
          const { li, statusSpan } = renderStatusRow(item, duplicateMap.get(item.line))
          statusSpansByLine.set(item.line, statusSpan)
          list.appendChild(li)
        }

        reportBox.append(heading, list)
        statusContainer.replaceChildren(reportBox)
      },
      onItemResult: (item, result) => {
        const statusSpan = statusSpansByLine.get(item.line)
        if (!statusSpan) return

        if (result.ok) {
          statusSpan.className = 'br-status br-status--ok'
          statusSpan.textContent = 'encontrado'
        } else {
          statusSpan.className = 'br-status br-status--fail'
          statusSpan.textContent = `fallido — ${result.error}`
        }
      },
    })
      .then((report) => {
        currentEntries = report.entries
        summaryEl.textContent = formatSummaryText(report)
        summaryEl.hidden = false

        renderFailures(report)
        renderEntries(report.entries)

        const hasEntries = report.entries.length > 0
        copyAllBtn.disabled = !hasEntries
        downloadBtn.disabled = !hasEntries
      })
      .catch(() => {
        noticeEl.textContent = 'Ocurrió un error inesperado al procesar los identificadores.'
        noticeEl.hidden = false
      })
      .finally(() => {
        isSearching = false
        searchBtn.disabled = false
        searchBtn.textContent = 'Buscar metadatos'
        exampleBtn.disabled = false
      })
  })
}
