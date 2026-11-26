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

import './style.css'
import { createThemeController } from 'rl-ui'
import { mountImportUI } from './uiImport.ts'
import { mountValidateUI } from './uiValidate.ts'

interface BibrlWindow extends Window {
  BIBRL_CONFIG?: { brandLink?: number }
  umami?: { track: (name: string, data?: Record<string, string>) => void }
}

export function track(eventName: string, data?: Record<string, string>): void {
  const w = window as BibrlWindow
  try {
    w.umami?.track(eventName, data)
  } catch {
    // Umami no disponible en local o bloqueado: ignorar sin afectar la app.
  }
}

export type TrackFn = (name: string, data?: Record<string, string>) => void

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Falta #app en index.html')

app.innerHTML = `
  <header class="br-header">
    <div class="br-header-inner">
      <div class="br-header-text">
        <a id="brand-link" class="br-brand" href="https://reoxlab.com" hidden>← Reox Lab</a>
        <h1>bibRL</h1>
        <p class="br-tagline">DOI, arXiv, ISBN y PMID a BibTeX — y validación de archivos .bib</p>
      </div>
      <div class="br-header-controls">
        <label class="br-theme-control" for="theme-select">
          <span>Tema</span>
          <select class="br-select br-select--compact" id="theme-select" aria-label="Tema de la interfaz">
            <option value="system" selected>Sistema</option>
            <option value="light">Claro</option>
            <option value="dark">Oscuro</option>
          </select>
        </label>
      </div>
    </div>
  </header>
  <main class="br-main">
    <nav class="br-tabs" role="tablist" aria-label="Modos de bibRL">
      <button id="tab-import" class="br-tab br-tab--active" role="tab" aria-selected="true" aria-controls="panel-import">Importar identificadores</button>
      <button id="tab-validate" class="br-tab" role="tab" aria-selected="false" aria-controls="panel-validate">Validar .bib</button>
    </nav>
    <section id="panel-import" class="br-panel" role="tabpanel" aria-labelledby="tab-import"></section>
    <section id="panel-validate" class="br-panel" role="tabpanel" aria-labelledby="tab-validate" hidden></section>
  </main>
  <footer class="br-footer">
    <p>bibRL es software libre (GPL v3). Las consultas a Crossref, arXiv, OpenLibrary y Europe PMC salen de tu navegador; ningún dato pasa por nuestros servidores.</p>
  </footer>
`

const themeSelect = document.querySelector<HTMLSelectElement>('#theme-select')
createThemeController({ storageKey: 'bibrl-theme-v1', select: themeSelect })

const brandLink = document.querySelector<HTMLAnchorElement>('#brand-link')
const w = window as BibrlWindow
if (brandLink && w.BIBRL_CONFIG?.brandLink === 1) {
  brandLink.hidden = false
}

function query<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`Falta ${selector} en index.html`)
  return el
}

const tabImport = query<HTMLButtonElement>('#tab-import')
const tabValidate = query<HTMLButtonElement>('#tab-validate')
const panelImport = query<HTMLElement>('#panel-import')
const panelValidate = query<HTMLElement>('#panel-validate')

function showTab(which: 'import' | 'validate'): void {
  const isImport = which === 'import'
  tabImport.classList.toggle('br-tab--active', isImport)
  tabImport.setAttribute('aria-selected', String(isImport))
  tabValidate.classList.toggle('br-tab--active', !isImport)
  tabValidate.setAttribute('aria-selected', String(!isImport))
  panelImport.hidden = !isImport
  panelValidate.hidden = isImport
}

tabImport.addEventListener('click', () => showTab('import'))
tabValidate.addEventListener('click', () => showTab('validate'))

mountImportUI(panelImport, track)
mountValidateUI(panelValidate, track)
