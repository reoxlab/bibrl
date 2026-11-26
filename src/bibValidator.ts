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

// Parser, validador y renumerador de claves duplicadas para archivos .bib.

import { stripAccents } from './bibtex.ts'

export interface BibIssue {
  line: number // línea aproximada (1-based) donde está el problema
  kind: 'error' | 'warning'
  message: string // en español
  key?: string // clave de la entrada afectada, si la hay
}

export interface ParsedBibEntry {
  type: string // en minúsculas, tal como viene (puede ser desconocido)
  key: string
  startLine: number
  endLine: number
  keyOffset: number // índice en el texto donde empieza la clave (para renumerar)
  keyLength: number
  fields: Record<string, { value: string; line: number }> // nombres de campo en minúsculas
}

export interface ValidationReport {
  totalEntries: number
  errors: BibIssue[]
  warnings: BibIssue[]
  entries: ParsedBibEntry[]
  unclosedBraces: boolean
  duplicateKeys: boolean
}

export interface MalformedBibEntry {
  line: number
  message: string
}

export interface ParseBibResult {
  entries: ParsedBibEntry[]
  unclosedBraces: boolean
  unclosedLines: number[]
  malformed: MalformedBibEntry[]
}

const IGNORED_DIRECTIVES: ReadonlySet<string> = new Set(['comment', 'preamble', 'string'])

// Campos obligatorios por tipo de entrada estándar de BibTeX.
// Para `book`, además se requiere `author` o `editor` (basta uno).
// `conference` es sinónimo estricto de `inproceedings`; `thesis` y `report`
// se aceptan como alias modernos de `phdthesis`/`mastersthesis` y `techreport`.
const REQUIRED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  article: ['author', 'title', 'journal', 'year'],
  book: ['title', 'publisher', 'year'],
  inproceedings: ['author', 'title', 'booktitle', 'year'],
  conference: ['author', 'title', 'booktitle', 'year'],
  incollection: ['author', 'title', 'booktitle', 'publisher', 'year'],
  phdthesis: ['author', 'title', 'school', 'year'],
  mastersthesis: ['author', 'title', 'school', 'year'],
  thesis: ['author', 'title', 'school', 'year'],
  techreport: ['author', 'title', 'institution', 'year'],
  report: ['author', 'title', 'institution', 'year'],
  proceedings: ['title', 'year'],
  unpublished: ['author', 'title', 'note'],
  booklet: ['title'],
  manual: ['title'],
  // inbook se completa con reglas especiales: author|editor y chapter|pages.
  inbook: ['title', 'publisher', 'year'],
  // Para referencias web, software y conjuntos de datos se exigen solo los
  // datos mínimos que suelen estar disponibles. Autor y fecha quedan
  // opcionales para no rechazar recursos sin autoría clara o sin año.
  online: ['title', 'url'],
  software: ['title', 'year'],
  dataset: ['title', 'year'],
}

// Otros tipos BibTeX conocidos donde solo se avisa si falta `title`.
const SOFT_TITLE_TYPES: ReadonlySet<string> = new Set(['misc'])

// Macros de mes predefinidas por BibTeX clásico. Se usan al expandir valores
// desnudos como `month = jan # "~15"` aunque no haya un `@string` explícito.
const BUILTIN_MACROS: Readonly<Record<string, string>> = {
  jan: 'January',
  feb: 'February',
  mar: 'March',
  apr: 'April',
  may: 'May',
  jun: 'June',
  jul: 'July',
  aug: 'August',
  sep: 'September',
  oct: 'October',
  nov: 'November',
  dec: 'December',
}

const DOI_PREFIX_STRIP_RE = /^(?:(?:https?:\/\/)?(?:(?:www|dx)\.)?doi\.org\/|doi:\s*)/i
const ASCII_LETTER_RE = /[A-Za-z]/
const FIELD_NAME_CHAR_RE = /[A-Za-z0-9_:-]/
const KEY_STOP_RE = /[\s,{}=#"%()]/
const MACRO_NAME_RE = /^[A-Za-z][A-Za-z0-9_:.\-]*$/
const NUMERIC_BARE_RE = /^\d+$/

function buildLineIndex(text: string): (offset: number) => number {
  const starts: number[] = [0]
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n') {
      starts.push(i + 1)
    } else if (ch === '\r' && text[i + 1] !== '\n') {
      starts.push(i + 1)
    }
  }

  return (offset: number): number => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if ((starts[mid] ?? 0) <= offset) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }
    return lo + 1
  }
}

function isWhitespace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f'
}

function isHorizontalSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t'
}

function skipWhitespace(text: string, pos: number): number {
  let i = pos
  while (i < text.length && isWhitespace(text[i])) {
    i++
  }
  return i
}

function skipToLineEnd(text: string, pos: number): number {
  let i = pos
  while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
    i++
  }
  return i
}

/**
 * Indica si la `{` recién abierta tiene su `}` correspondiente antes de la
 * próxima comilla sin escapar. Sirve para distinguir llaves equilibradas dentro
 * de un literal `"..."` (que deben contarse) de una llave suelta (que debe
 * ignorarse para no romper el equilibrio externo).
 */
function hasMatchingBraceBeforeQuote(text: string, pos: number): boolean {
  let depth = 1
  let i = pos
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\' && i + 1 < text.length) {
      i += 2
      continue
    }
    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return true
    } else if (ch === '"') {
      return false
    }
    i++
  }
  return false
}

interface EntryStart {
  type: string
  afterOpen: number
  openChar: '{' | '('
  closeChar: '}' | ')'
}

/**
 * Comprueba si en `pos` comienza un bloque `@tipo{` o `@tipo(` (admitiendo
 * espacios entre `@`, tipo y delimitador). Devuelve el tipo en minúsculas, la
 * posición inmediatamente posterior al delimitador y qué delimitador se abrió.
 */
function matchEntryStart(text: string, pos: number): EntryStart | null {
  if (text[pos] !== '@') return null
  let i = pos + 1
  while (i < text.length && isHorizontalSpace(text[i])) {
    i++
  }

  const typeStart = i
  while (i < text.length && ASCII_LETTER_RE.test(text[i] ?? '')) {
    i++
  }
  if (i === typeStart) return null
  const type = text.slice(typeStart, i).toLowerCase()

  while (i < text.length && isWhitespace(text[i])) {
    i++
  }
  const openChar = text[i]
  if (openChar !== '{' && openChar !== '(') return null

  return {
    type,
    afterOpen: i + 1,
    openChar,
    closeChar: openChar === '{' ? '}' : ')',
  }
}

/**
 * Salta un bloque delimitado por `{...}` o `(...)` (partiendo con profundidad 1
 * justo tras el delimitador de apertura).
 *
 * Cuando `respectQuotes` es true y estamos dentro de `"..."`, las llaves se
 * cuentan en un contador local: una `}` suelta dentro de las comillas no reduce
 * la profundidad global y las comillas solo se cierran cuando ese contador es 0.
 * Devuelve la posición tras el cierre, si quedó sin cerrar y dónde termina el
 * contenido (índice del delimitador de cierre, o EOF si no se cerró).
 */
function skipBalancedBlock(
  text: string,
  pos: number,
  respectQuotes: boolean,
  openChar: '{' | '(' = '{',
): { nextPos: number; unclosed: boolean; contentEnd: number } {
  let i = pos
  let depth = 1
  let braceDepth = 0
  let inQuotes = false
  let quoteBraceDepth = 0

  while (i < text.length && depth > 0) {
    const ch = text[i]
    if (respectQuotes && inQuotes) {
      if (ch === '\\' && i + 1 < text.length) {
        i += 2
        continue
      }
      if (ch === '"') {
        if (quoteBraceDepth === 0) {
          inQuotes = false
        }
        i++
        continue
      }
      if (ch === '{') {
        if (hasMatchingBraceBeforeQuote(text, i + 1)) {
          quoteBraceDepth++
        }
      } else if (ch === '}' && quoteBraceDepth > 0) {
        quoteBraceDepth--
      }
      // Cualquier otra llave dentro de comillas (incluidas las sueltas) se
      // ignora para no alterar el equilibrio externo.
      i++
      continue
    }

    if (respectQuotes && ch === '"' && depth === 1 && braceDepth === 0) {
      inQuotes = true
      quoteBraceDepth = 0
      i++
      continue
    }

    if (openChar === '{') {
      if (ch === '{') {
        depth++
      } else if (ch === '}') {
        depth--
      }
    } else {
      // En bloques con paréntesis, los paréntesis dentro de `{...}` no cuentan.
      if (ch === '{') {
        braceDepth++
      } else if (ch === '}' && braceDepth > 0) {
        braceDepth--
      } else if (braceDepth === 0) {
        if (ch === '(') {
          depth++
        } else if (ch === ')') {
          depth--
        }
      }
    }
    i++
  }

  const closed = depth === 0
  return {
    nextPos: i,
    unclosed: !closed,
    contentEnd: closed ? i - 1 : text.length,
  }
}

interface ParsedFieldValue {
  value: string
  nextPos: number
  unclosed: boolean
  bareTokens: string[]
}

/**
 * Lee un valor de campo: secuencia de literales `{...}`, `"..."` y tokens
 * desnudos unidos opcionalmente con `#`. Los tokens desnudos se expanden con la
 * tabla de macros `@string` (y las macros de mes predefinidas); los literales
 * entre llaves o comillas se conservan tal cual, como en BibTeX.
 */
function parseFieldValue(
  text: string,
  pos: number,
  macros: ReadonlyMap<string, string>,
): ParsedFieldValue {
  let i = skipWhitespace(text, pos)
  const parts: string[] = []
  const bareTokens: string[] = []
  let unclosed = false

  while (i < text.length) {
    const ch = text[i]

    if (ch === '{') {
      i++ // consumir '{'
      const start = i
      let depth = 1
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') depth--
        i++
      }
      if (depth === 0) {
        parts.push(text.slice(start, i - 1))
      } else {
        parts.push(text.slice(start))
        unclosed = true
        break
      }
    } else if (ch === '"') {
      i++ // consumir '"'
      const start = i
      let braceDepth = 0
      let closed = false
      while (i < text.length) {
        const cur = text[i]
        if (cur === '\\' && i + 1 < text.length) {
          i += 2
          continue
        }
        if (cur === '{') {
          if (hasMatchingBraceBeforeQuote(text, i + 1)) {
            braceDepth++
          }
        } else if (cur === '}' && braceDepth > 0) {
          braceDepth--
        } else if (cur === '"' && braceDepth === 0) {
          closed = true
          i++
          break
        }
        i++
      }
      if (closed) {
        parts.push(text.slice(start, i - 1))
      } else {
        parts.push(text.slice(start))
        unclosed = true
        break
      }
    } else {
      // Valor sin delimitadores (p. ej. year = 2020 o month = jan): hasta ',',
      // '}', ')', '#', '%' o fin de línea.
      const start = i
      while (
        i < text.length &&
        text[i] !== ',' &&
        text[i] !== '}' &&
        text[i] !== ')' &&
        text[i] !== '#' &&
        text[i] !== '%' &&
        text[i] !== '\n' &&
        text[i] !== '\r'
      ) {
        i++
      }
      const token = text.slice(start, i).trim()
      if (token !== '') {
        bareTokens.push(token)
        const macroValue = macros.get(token.toLowerCase())
        parts.push(macroValue ?? token)
      }
    }

    const afterPart = skipWhitespace(text, i)
    if (text[afterPart] === '#') {
      i = skipWhitespace(text, afterPart + 1)
      continue
    }
    i = afterPart
    break
  }

  return { value: parts.join(''), nextPos: i, unclosed, bareTokens }
}

/**
 * Procesa una directiva `@string{...}` o `@string(...)`: guarda las definiciones
 * de macros (nombre en minúsculas) y devuelve la posición tras el bloque.
 */
function parseStringDirective(
  text: string,
  afterOpen: number,
  openChar: '{' | '(',
  macros: Map<string, string>,
): { nextPos: number; unclosed: boolean } {
  const closeChar = openChar === '{' ? '}' : ')'
  const skipped = skipBalancedBlock(text, afterOpen, true, openChar)
  const contentEnd = skipped.contentEnd
  let i = afterOpen

  while (i < contentEnd) {
    while (i < contentEnd && isWhitespace(text[i])) {
      i++
    }
    if (i < contentEnd && text[i] === '%') {
      i = skipToLineEnd(text, i)
      continue
    }
    if (i >= contentEnd) break

    const nameStart = i
    while (i < contentEnd && !/[\s=,(){}]/.test(text[i] ?? '')) {
      i++
    }
    const macroName = text.slice(nameStart, i).trim()
    i = skipWhitespace(text, i)

    if (macroName === '' || text[i] !== '=') {
      while (i < contentEnd && text[i] !== ',' && text[i] !== closeChar) {
        i++
      }
      if (text[i] === ',') {
        i++
        continue
      }
      break
    }

    i++ // consumir '='
    const parsed = parseFieldValue(text, i, macros)
    if (macroName !== '') {
      macros.set(macroName.toLowerCase(), parsed.value)
    }
    i = parsed.nextPos

    while (i < contentEnd && (isWhitespace(text[i]) || text[i] === '%')) {
      if (text[i] === '%') {
        i = skipToLineEnd(text, i)
      } else {
        i++
      }
    }

    if (text[i] === ',') {
      i++
      continue
    }
    if (i >= contentEnd || text[i] === closeChar) break
  }

  return { nextPos: skipped.nextPos, unclosed: skipped.unclosed }
}

interface OrphanUnclosed {
  line: number
  message: string
}

interface InternalParseResult extends ParseBibResult {
  unclosedEntryIndices: Set<number>
  orphanUnclosed: OrphanUnclosed[]
}

function parseBibInternal(text: string): InternalParseResult {
  const entries: ParsedBibEntry[] = []
  const unclosedLines: number[] = []
  const unclosedEntryIndices = new Set<number>()
  const orphanUnclosed: OrphanUnclosed[] = []
  const malformed: MalformedBibEntry[] = []
  const macros = new Map<string, string>(Object.entries(BUILTIN_MACROS))
  const lineAt = buildLineIndex(text)

  let i = 0
  let atLineStart = true

  while (i < text.length) {
    const ch = text[i]

    if (ch === '\n' || ch === '\r') {
      atLineStart = true
      i++
      continue
    }

    if (isHorizontalSpace(ch)) {
      i++
      continue
    }

    // Comentarios '%' fuera de una entrada: cualquier '%' oculta hasta fin de línea.
    if (ch === '%') {
      i = skipToLineEnd(text, i)
      continue
    }

    const wasLineStart = atLineStart
    atLineStart = false

    if (ch !== '@') {
      i++
      continue
    }

    const startOffset = i
    const startLine = lineAt(startOffset)
    const header = matchEntryStart(text, i)
    if (!header) {
      if (wasLineStart) {
        malformed.push({
          line: startLine,
          message:
            'Entrada BibTeX mal formada: falta una cabecera válida «@tipo{...}» o «@tipo(...)»',
        })
      }
      i++
      continue
    }

    const { type, afterOpen, openChar, closeChar } = header

    // Directivas @comment, @preamble y @string: no cuentan como entradas.
    if (IGNORED_DIRECTIVES.has(type)) {
      let skipped: { nextPos: number; unclosed: boolean }
      if (type === 'string') {
        skipped = parseStringDirective(text, afterOpen, openChar, macros)
      } else {
        skipped = skipBalancedBlock(text, afterOpen, type !== 'comment', openChar)
      }
      if (skipped.unclosed) {
        unclosedLines.push(startLine)
        orphanUnclosed.push({
          line: startLine,
          message: `La directiva «@${type}» de la línea ${startLine} tiene llaves sin cerrar`,
        })
      }
      i = skipped.nextPos
      atLineStart = false
      continue
    }

    // Leer la clave de la entrada.
    let cursor = skipWhitespace(text, afterOpen)
    const keyOffset = cursor
    while (cursor < text.length && !KEY_STOP_RE.test(text[cursor] ?? '')) {
      cursor++
    }
    const keyLength = cursor - keyOffset
    const key = text.slice(keyOffset, cursor)

    const afterKey = skipWhitespace(text, cursor)
    const sep = text[afterKey]

    if (keyLength === 0) {
      malformed.push({
        line: startLine,
        message: `Entrada «@${type}» mal formada: falta la clave de cita`,
      })
      const skipped = skipBalancedBlock(text, afterOpen, true, openChar)
      if (skipped.unclosed) {
        unclosedLines.push(startLine)
        orphanUnclosed.push({
          line: startLine,
          message: `Llaves sin cerrar en la entrada de la línea ${startLine}`,
        })
      }
      i = skipped.nextPos
      continue
    }

    if (sep !== ',') {
      const detail =
        sep === '='
          ? `Entrada «@${type}» mal formada: falta la clave de cita`
          : `Entrada «@${type}» mal formada: falta la coma tras la clave «${key}»`
      malformed.push({ line: startLine, message: detail })
      const skipped = skipBalancedBlock(text, afterOpen, true, openChar)
      if (skipped.unclosed) {
        unclosedLines.push(startLine)
        orphanUnclosed.push({
          line: startLine,
          message: `Llaves sin cerrar en la entrada de la línea ${startLine}`,
        })
      }
      i = skipped.nextPos
      continue
    }

    // Consumir la coma tras la clave y leer campos hasta el cierre o EOF.
    cursor = afterKey + 1
    const fields: Record<string, { value: string; line: number }> = {}
    let closed = false
    let endOffset = text.length

    while (cursor < text.length) {
      cursor = skipWhitespace(text, cursor)
      if (cursor >= text.length) {
        break
      }

      // Comentarios '%' entre campos o tras una coma.
      if (text[cursor] === '%') {
        cursor = skipWhitespace(text, skipToLineEnd(text, cursor))
        continue
      }

      if (text[cursor] === ',') {
        cursor++
        continue
      }

      if (text[cursor] === closeChar) {
        closed = true
        endOffset = cursor
        cursor++
        break
      }

      // Si aparece una nueva entrada '@tipo{' al nivel de campos, la entrada actual quedó sin cerrar.
      if (text[cursor] === '@' && matchEntryStart(text, cursor) !== null) {
        endOffset = cursor > 0 ? cursor - 1 : cursor
        break
      }

      const fieldLine = lineAt(cursor)
      const nameStart = cursor
      while (cursor < text.length && FIELD_NAME_CHAR_RE.test(text[cursor] ?? '')) {
        cursor++
      }
      const fieldName = text.slice(nameStart, cursor).toLowerCase()

      if (fieldName === '') {
        // Carácter inesperado entre campos: avanzar hasta coma o cierre sin entrar en bucle.
        while (
          cursor < text.length &&
          text[cursor] !== ',' &&
          text[cursor] !== closeChar
        ) {
          cursor++
        }
        if (text[cursor] === ',') cursor++
        continue
      }

      cursor = skipWhitespace(text, cursor)
      if (text[cursor] !== '=') {
        // Falta '=' tras el nombre del campo: emitir error y recuperar el bloque
        // `{...}` completo si lo hay, sin cerrar la entrada en falso.
        malformed.push({
          line: fieldLine,
          message: `Falta «=» tras el campo «${fieldName}»`,
        })
        if (text[cursor] === '{') {
          const skipped = skipBalancedBlock(text, cursor + 1, true)
          cursor = skipped.nextPos
        } else {
          while (
            cursor < text.length &&
            text[cursor] !== ',' &&
            text[cursor] !== closeChar &&
            text[cursor] !== '\n' &&
            text[cursor] !== '\r'
          ) {
            cursor++
          }
        }
        cursor = skipWhitespace(text, cursor)
        if (text[cursor] === ',') cursor++
        continue
      }

      cursor++ // consumir '='
      const parsedVal = parseFieldValue(text, cursor, macros)
      fields[fieldName] = { value: parsedVal.value, line: fieldLine }
      cursor = parsedVal.nextPos

      // Los valores desnudos solo pueden ser números o nombres de macro válidos.
      // Un identificador de macro no definido se acepta sintácticamente (puede
      // venir de otro archivo o definirse después); lo que no encaja con ninguno
      // de los dos formatos es un error de sintaxis BibTeX.
      for (const token of parsedVal.bareTokens) {
        if (!NUMERIC_BARE_RE.test(token) && !MACRO_NAME_RE.test(token)) {
          malformed.push({
            line: fieldLine,
            message: `Valor sin llaves ni comillas no válido en el campo «${fieldName}»: «${token}»`,
          })
        }
      }

      if (parsedVal.unclosed) {
        endOffset = text.length
        break
      }

      let afterValue = skipWhitespace(text, cursor)
      if (text[afterValue] === '%') {
        afterValue = skipWhitespace(text, skipToLineEnd(text, afterValue))
      }

      if (text[afterValue] === ',') {
        cursor = afterValue + 1
      } else if (
        afterValue >= text.length ||
        text[afterValue] === closeChar ||
        (text[afterValue] === '@' && matchEntryStart(text, afterValue) !== null)
      ) {
        cursor = afterValue
      } else {
        malformed.push({
          line: fieldLine,
          message: `Falta la coma tras el campo «${fieldName}»`,
        })
        cursor = afterValue
      }
    }

    if (!closed) {
      unclosedLines.push(startLine)
      unclosedEntryIndices.add(entries.length)
    }

    const endLine = lineAt(Math.max(startOffset, Math.min(endOffset, Math.max(0, text.length - 1))))
    entries.push({
      type,
      key,
      startLine,
      endLine,
      keyOffset,
      keyLength,
      fields,
    })

    i = cursor
  }

  return {
    entries,
    unclosedBraces: unclosedLines.length > 0,
    unclosedLines,
    malformed,
    unclosedEntryIndices,
    orphanUnclosed,
  }
}

export function parseBib(text: string): ParseBibResult {
  const { entries, unclosedBraces, unclosedLines, malformed } = parseBibInternal(text)
  return { entries, unclosedBraces, unclosedLines, malformed }
}

function normalizeDoiValue(raw: string): string {
  const cleaned = raw
    .replace(/[{}]/g, '')
    .replace(/\\_/g, '_')
    .replace(/%2f/gi, '/')
    .trim()
  if (cleaned === '') return ''
  return cleaned.replace(DOI_PREFIX_STRIP_RE, '').trim().toLowerCase()
}

function stripLatexFormatting(raw: string): string {
  return (
    raw
      // Comandos de acento de una letra con argumento: \'e, \"o, \~n, \c{c}, \c c, etc.
      .replace(/\\['"`^~=.](?:\s*\{\\i\}|\s*\\i\b|\s*\{?([A-Za-z])\}?)/g, (_m, letter?: string) =>
        letter ? letter : 'i',
      )
      .replace(/\\[cvHurk](?:\s+\{?([A-Za-z])\}?|\{([A-Za-z])\})/g, (_m, a?: string, b?: string) =>
        a ?? b ?? '',
      )
      .replace(/\\(o|O|l|L|ss|ae|AE|oe|OE|aa|AA|i|j)\b/g, '$1')
      .replace(/[{}]/g, '')
  )
}

function normalizeComparisonText(raw: string): string {
  return stripAccents(stripLatexFormatting(raw))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Devuelve el primer autor de una lista BibTeX. Solo se corta por `and` cuando
 * está a profundidad de llaves 0, para no partir autores institucionales como
 * `{{Barnes and Noble}}`.
 */
function firstAuthorSegment(raw: string): string {
  let depth = 0
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '{') {
      depth++
      continue
    }
    if (ch === '}') {
      if (depth > 0) depth--
      continue
    }
    if (depth === 0 && (ch === 'a' || ch === 'A')) {
      const prev = raw[i - 1]
      const next = raw[i + 3]
      const isBoundaryBefore = prev === undefined || /\s/.test(prev)
      const isBoundaryAfter = next === undefined || /\s/.test(next)
      if (
        isBoundaryBefore &&
        isBoundaryAfter &&
        raw.slice(i, i + 3).toLowerCase() === 'and'
      ) {
        return raw.slice(0, i).trim()
      }
    }
  }
  return raw.trim()
}

function normalizeFirstAuthor(raw: string): string {
  const firstSegment = firstAuthorSegment(raw)
  const plain = stripLatexFormatting(firstSegment).trim()
  const commaParts = plain.split(',')
  let reordered = plain

  if (commaParts.length === 2) {
    // Formato «Apellido, Nombre».
    reordered = `${commaParts[1]?.trim() ?? ''} ${commaParts[0]?.trim() ?? ''}`
  } else if (commaParts.length >= 3) {
    // Formato «Apellido, Jr., Nombre»: el apellido es lo anterior a la primera
    // coma; se combina con el nombre de pila (último segmento), no con el sufijo.
    reordered = `${commaParts[commaParts.length - 1]?.trim() ?? ''} ${
      commaParts[0]?.trim() ?? ''
    }`
  }

  return normalizeComparisonText(reordered)
}

export function validateBib(text: string): ValidationReport {
  const parsed = parseBibInternal(text)
  const errors: BibIssue[] = []
  const warnings: BibIssue[] = []
  let duplicateKeys = false

  // 1. Entradas mal formadas.
  for (const item of parsed.malformed) {
    errors.push({
      line: item.line,
      kind: 'error',
      message: item.message,
    })
  }

  // 2. Llaves sin cerrar.
  for (const idx of parsed.unclosedEntryIndices) {
    const entry = parsed.entries[idx]
    if (entry) {
      errors.push({
        line: entry.startLine,
        kind: 'error',
        message: `La entrada «${entry.key}» tiene llaves sin cerrar`,
        key: entry.key,
      })
    }
  }
  for (const item of parsed.orphanUnclosed) {
    errors.push({
      line: item.line,
      kind: 'error',
      message: item.message,
    })
  }

  // 3. Revisión por entrada: claves repetidas, duplicados por DOI y título+autor, campos y tipos.
  const seenKeys = new Map<string, number>()
  const seenDois = new Map<string, ParsedBibEntry>()
  const seenTitleAuthors = new Map<string, ParsedBibEntry>()

  for (const entry of parsed.entries) {
    // 3a. Claves repetidas (BibTeX las compara sin distinguir mayúsculas).
    const keyId = entry.key.toLowerCase()
    const firstKeyLine = seenKeys.get(keyId)
    if (firstKeyLine !== undefined) {
      duplicateKeys = true
      errors.push({
        line: entry.startLine,
        kind: 'error',
        message: `La clave «${entry.key}» está repetida (primera aparición en la línea ${firstKeyLine})`,
        key: entry.key,
      })
    } else {
      seenKeys.set(keyId, entry.startLine)
    }

    // 3b. Entradas duplicadas por DOI.
    let matchedDoiFirstKey: string | null = null
    const doiField = entry.fields['doi']
    if (doiField !== undefined) {
      const normDoi = normalizeDoiValue(doiField.value)
      if (normDoi !== '') {
        const firstDoiEntry = seenDois.get(normDoi)
        if (firstDoiEntry !== undefined) {
          matchedDoiFirstKey = firstDoiEntry.key
          errors.push({
            line: entry.startLine,
            kind: 'error',
            message: `Dos entradas comparten el DOI «${normDoi}» (primera aparición en «${firstDoiEntry.key}», línea ${firstDoiEntry.startLine})`,
            key: entry.key,
          })
        } else {
          seenDois.set(normDoi, entry)
        }
      }
    }

    // 3c. Posibles duplicados por mismo título + primer autor (solo si tiene ambos datos).
    const titleField = entry.fields['title']
    const authorField = entry.fields['author']
    if (titleField !== undefined && authorField !== undefined) {
      const normTitle = normalizeComparisonText(titleField.value)
      const normAuthor = normalizeFirstAuthor(authorField.value)
      if (normTitle !== '' && normAuthor !== '') {
        const sig = `${normTitle}\0${normAuthor}`
        const firstMatch = seenTitleAuthors.get(sig)
        if (firstMatch !== undefined) {
          // Evitar aviso redundante si el mismo par ya se marcó como duplicado exacto por DOI.
          if (matchedDoiFirstKey !== firstMatch.key) {
            warnings.push({
              line: entry.startLine,
              kind: 'warning',
              message: `Posible duplicado de «${firstMatch.key}» (mismo título y autor)`,
              key: entry.key,
            })
          }
        } else {
          seenTitleAuthors.set(sig, entry)
        }
      }
    }

    // 3d. Campos vacíos (warning).
    for (const [fieldName, fieldInfo] of Object.entries(entry.fields)) {
      if (fieldInfo.value.trim() === '') {
        warnings.push({
          line: fieldInfo.line,
          kind: 'warning',
          message: `El campo «${fieldName}» de «${entry.key}» está vacío`,
          key: entry.key,
        })
      }
    }

    // 3e. Campos obligatorios según el tipo de entrada.
    const required = REQUIRED_FIELDS[entry.type]
    if (required !== undefined) {
      for (const reqField of required) {
        if (!(reqField in entry.fields)) {
          errors.push({
            line: entry.startLine,
            kind: 'error',
            message: `Falta el campo obligatorio «${reqField}» en «${entry.key}»`,
            key: entry.key,
          })
        }
      }
      if (entry.type === 'book' && !('author' in entry.fields) && !('editor' in entry.fields)) {
        errors.push({
          line: entry.startLine,
          kind: 'error',
          message: `Falta el campo obligatorio «author» o «editor» en «${entry.key}»`,
          key: entry.key,
        })
      }
      if (entry.type === 'inbook') {
        if (!('author' in entry.fields) && !('editor' in entry.fields)) {
          errors.push({
            line: entry.startLine,
            kind: 'error',
            message: `Falta el campo obligatorio «author» o «editor» en «${entry.key}»`,
            key: entry.key,
          })
        }
        if (!('chapter' in entry.fields) && !('pages' in entry.fields)) {
          errors.push({
            line: entry.startLine,
            kind: 'error',
            message: `Falta el campo obligatorio «chapter» o «pages» en «${entry.key}»`,
            key: entry.key,
          })
        }
      }
    } else if (SOFT_TITLE_TYPES.has(entry.type)) {
      if (!('title' in entry.fields)) {
        warnings.push({
          line: entry.startLine,
          kind: 'warning',
          message: `Falta el campo «title» en «${entry.key}»`,
          key: entry.key,
        })
      }
    } else {
      warnings.push({
        line: entry.startLine,
        kind: 'warning',
        message: `Tipo de entrada «${entry.type}» no reconocido; se revisan solo los campos comunes`,
        key: entry.key,
      })
      if (!('title' in entry.fields)) {
        warnings.push({
          line: entry.startLine,
          kind: 'warning',
          message: `Falta el campo «title» en «${entry.key}»`,
          key: entry.key,
        })
      }
    }
  }

  errors.sort((a, b) => a.line - b.line)
  warnings.sort((a, b) => a.line - b.line)

  return {
    totalEntries: parsed.entries.length,
    errors,
    warnings,
    entries: parsed.entries,
    unclosedBraces: parsed.unclosedBraces,
    duplicateKeys,
  }
}

function indexToAlphaSuffix(index: number): string {
  let n = index
  let suffix = ''
  do {
    suffix = String.fromCharCode(97 + (n % 26)) + suffix
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return suffix
}

/**
 * Variante de `assignUniqueKeys` que agrupa las claves sin distinguir
 * mayúsculas/minúsculas (como hace BibTeX al detectar entradas repetidas),
 * conservando la grafía original de cada clave al añadir el sufijo.
 */
function assignUniqueKeysCaseInsensitive(keys: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const key of keys) {
    const id = key.toLowerCase()
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  const used = new Set<string>()
  for (const key of keys) {
    const id = key.toLowerCase()
    if ((counts.get(id) ?? 0) === 1) {
      used.add(id)
    }
  }

  const nextIndex = new Map<string, number>()
  const result: string[] = []

  for (const key of keys) {
    const id = key.toLowerCase()
    if ((counts.get(id) ?? 0) === 1) {
      result.push(key)
      continue
    }

    let idx = nextIndex.get(id) ?? 0
    while (true) {
      const candidate = `${key}${indexToAlphaSuffix(idx)}`
      idx++
      const candidateId = candidate.toLowerCase()
      if (!used.has(candidateId)) {
        used.add(candidateId)
        nextIndex.set(id, idx)
        result.push(candidate)
        break
      }
    }
  }

  return result
}

export function renumberDuplicateKeys(text: string): {
  text: string
  renamed: { oldKey: string; newKey: string; line: number }[]
} {
  const { entries } = parseBib(text)
  if (entries.length === 0) {
    return { text, renamed: [] }
  }

  const originalKeys = entries.map((e) => e.key)
  const uniqueKeys = assignUniqueKeysCaseInsensitive(originalKeys)

  const changes: Array<{
    entry: ParsedBibEntry
    oldKey: string
    newKey: string
  }> = []

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const newKey = uniqueKeys[i]
    if (entry !== undefined && newKey !== undefined && newKey !== entry.key) {
      changes.push({ entry, oldKey: entry.key, newKey })
    }
  }

  if (changes.length === 0) {
    return { text, renamed: [] }
  }

  // Sustituir de atrás hacia adelante para mantener intactos los offsets anteriores.
  let updated = text
  for (let i = changes.length - 1; i >= 0; i--) {
    const change = changes[i]
    if (!change) continue
    const { entry, newKey } = change
    updated =
      updated.slice(0, entry.keyOffset) +
      newKey +
      updated.slice(entry.keyOffset + entry.keyLength)
  }

  return {
    text: updated,
    renamed: changes.map((c) => ({
      oldKey: c.oldKey,
      newKey: c.newKey,
      line: c.entry.startLine,
    })),
  }
}
