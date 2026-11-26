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

// Interfaz del modo Validar .bib: pegado o carga de archivo, resumen, informe de problemas y descarga corregida.

import {
  type BibIssue,
  type ValidationReport,
  renumberDuplicateKeys,
  validateBib,
} from './bibValidator.ts'
import type { TrackFn } from './main.ts'

const EXAMPLE_BIB_PLACEHOLDER = `@article{lecun2015deep,
  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  title = {Deep learning},
  year = {2015},
}

@article{lecun2015deep,
  author = {LeCun, Yann},
  title = {Another paper},
  journal = {Nature},
  year = {2015},
}`

function downloadCorrectedBib(content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'bibrl-corregido.bib'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1000)
}

function readUploadedFile(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text()
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo'))
    reader.readAsText(file, 'utf-8')
  })
}

function renderSummary(container: HTMLElement, report: ValidationReport): void {
  container.replaceChildren()

  const entriesCount = report.totalEntries
  const errorsCount = report.errors.length
  const warningsCount = report.warnings.length

  const entriesItem = document.createElement('span')
  const entriesStrong = document.createElement('strong')
  entriesStrong.textContent = String(entriesCount)
  entriesItem.append(entriesStrong, entriesCount === 1 ? ' entrada' : ' entradas')

  const sep1 = document.createElement('span')
  sep1.setAttribute('aria-hidden', 'true')
  sep1.textContent = '·'

  const errorsItem = document.createElement('span')
  if (errorsCount > 0) errorsItem.className = 'br-status br-status--fail'
  const errorsStrong = document.createElement('strong')
  errorsStrong.textContent = String(errorsCount)
  errorsItem.append(errorsStrong, errorsCount === 1 ? ' error' : ' errores')

  const sep2 = document.createElement('span')
  sep2.setAttribute('aria-hidden', 'true')
  sep2.textContent = '·'

  const warningsItem = document.createElement('span')
  if (warningsCount > 0) warningsItem.className = 'br-status br-status--pending'
  const warningsStrong = document.createElement('strong')
  warningsStrong.textContent = String(warningsCount)
  warningsItem.append(warningsStrong, warningsCount === 1 ? ' aviso' : ' avisos')

  container.append(entriesItem, sep1, errorsItem, sep2, warningsItem)
  container.hidden = false
}

function renderReport(container: HTMLElement, report: ValidationReport): void {
  container.replaceChildren()

  const issues: BibIssue[] = [...report.errors, ...report.warnings].sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line
    if (a.kind === b.kind) return 0
    return a.kind === 'error' ? -1 : 1
  })

  const box = document.createElement('section')
  box.className = 'br-report'

  const heading = document.createElement('h3')
  heading.textContent = 'Resultado de la validación'
  box.appendChild(heading)

  if (issues.length === 0) {
    const msg = document.createElement('p')
    if (report.totalEntries === 0) {
      msg.className = 'br-note'
      msg.textContent = 'No se encontraron entradas BibTeX en el texto.'
    } else {
      msg.className = 'br-status br-status--ok'
      msg.textContent = 'Sin errores ni avisos. El archivo .bib es válido.'
    }
    box.appendChild(msg)
    container.appendChild(box)
    return
  }

  const list = document.createElement('ol')
  for (const issue of issues) {
    const li = document.createElement('li')
    li.className =
      issue.kind === 'error'
        ? 'br-issue-item br-status--fail'
        : 'br-issue-item br-status--pending'
    li.textContent = `línea ${issue.line} — ${issue.message}`
    list.appendChild(li)
  }

  box.appendChild(list)
  container.appendChild(box)
}

export function mountValidateUI(panel: HTMLElement, track: TrackFn): void {
  panel.replaceChildren()

  const label = document.createElement('label')
  label.className = 'br-label'
  label.htmlFor = 'br-bib-input'
  label.textContent = 'Contenido BibTeX (.bib) a validar'

  const textarea = document.createElement('textarea')
  textarea.id = 'br-bib-input'
  textarea.className = 'br-textarea'
  textarea.placeholder = EXAMPLE_BIB_PLACEHOLDER
  textarea.spellcheck = false

  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = '.bib,text/plain'
  fileInput.hidden = true

  const controlsRow = document.createElement('div')
  controlsRow.className = 'br-button-row'

  const validateBtn = document.createElement('button')
  validateBtn.type = 'button'
  validateBtn.className = 'br-button'
  validateBtn.textContent = 'Validar'

  const uploadBtn = document.createElement('button')
  uploadBtn.type = 'button'
  uploadBtn.className = 'br-button br-button--secondary'
  uploadBtn.textContent = 'Cargar archivo .bib'

  const downloadCorrectedBtn = document.createElement('button')
  downloadCorrectedBtn.type = 'button'
  downloadCorrectedBtn.className = 'br-button br-button--secondary'
  downloadCorrectedBtn.textContent = 'Descargar .bib corregido'
  downloadCorrectedBtn.hidden = true
  downloadCorrectedBtn.disabled = true

  controlsRow.append(validateBtn, uploadBtn, downloadCorrectedBtn)

  const noticeEl = document.createElement('p')
  noticeEl.className = 'br-note'
  noticeEl.hidden = true

  const summaryEl = document.createElement('div')
  summaryEl.className = 'br-summary br-summary--validate'
  summaryEl.setAttribute('role', 'status')
  summaryEl.setAttribute('aria-live', 'polite')
  summaryEl.hidden = true

  const reportContainer = document.createElement('div')

  panel.append(label, textarea, fileInput, controlsRow, noticeEl, summaryEl, reportContainer)

  let correctedBibText: string | null = null

  function clearCorrectedDownload(): void {
    correctedBibText = null
    downloadCorrectedBtn.hidden = true
    downloadCorrectedBtn.disabled = true
  }

  textarea.addEventListener('input', () => {
    noticeEl.hidden = true
    clearCorrectedDownload()
  })

  uploadBtn.addEventListener('click', () => {
    fileInput.click()
  })

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (!file) return
    void readUploadedFile(file)
      .then((content) => {
        textarea.value = content
        noticeEl.hidden = true
        summaryEl.hidden = true
        reportContainer.replaceChildren()
        clearCorrectedDownload()
        textarea.focus()
      })
      .catch(() => {
        noticeEl.textContent = 'No se pudo leer el archivo seleccionado.'
        noticeEl.hidden = false
      })
      .finally(() => {
        fileInput.value = ''
      })
  })

  validateBtn.addEventListener('click', () => {
    const inputText = textarea.value
    if (inputText.replace(/[\s\u200B\uFEFF]+/g, '') === '') {
      noticeEl.textContent = 'Pega el contenido de un archivo .bib o carga uno para validar.'
      noticeEl.hidden = false
      summaryEl.hidden = true
      reportContainer.replaceChildren()
      clearCorrectedDownload()
      textarea.focus()
      return
    }

    noticeEl.hidden = true
    const report = validateBib(inputText)
    track('bibrl-validar', { entries: String(report.totalEntries) })

    renderSummary(summaryEl, report)
    renderReport(reportContainer, report)

    if (report.duplicateKeys) {
      const renumbered = renumberDuplicateKeys(inputText)
      if (renumbered.renamed.length > 0) {
        correctedBibText = renumbered.text
        downloadCorrectedBtn.hidden = false
        downloadCorrectedBtn.disabled = false
      } else {
        clearCorrectedDownload()
      }
    } else {
      clearCorrectedDownload()
    }
  })

  downloadCorrectedBtn.addEventListener('click', () => {
    if (correctedBibText === null) return
    downloadCorrectedBib(correctedBibText)
    track('bibrl-descargar-validado')
  })
}
