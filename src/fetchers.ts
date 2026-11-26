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

// Búsqueda y mapeo de metadatos desde Crossref (DOI), arXiv, OpenLibrary (ISBN) y Europe PMC (PMID).

import {
  type AuthorKeyInput,
  type BibEntry,
  type BibEntryType,
  VERBATIM_FIELDS,
  buildKey,
  escapeFieldValue,
  escapeVerbatim,
  formatTitle,
} from './bibtex.ts'
import type { ParsedIdentifier } from './identifiers.ts'

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface FetchOptions {
  arxivBase?: string
}

export type FetchErrorKind = 'not-found' | 'network' | 'bad-response'

export interface FetchSuccess {
  ok: true
  entry: BibEntry
}

export interface FetchFailure {
  ok: false
  error: string
  kind: FetchErrorKind
}

export type FetchResult = FetchSuccess | FetchFailure

export interface ArxivAtomEntry {
  id: string | null
  title: string
  authors: string[]
  published: string | null
  primaryCategory: string | null
  doi: string | null
  comment: string | null
  journalRef: string | null
  isError: boolean
}

const FETCH_TIMEOUT_MS = 15_000
const CROSSREF_MAILTO = 'contacto@reoxlab.com'

const ERR_NOT_FOUND = 'No encontrado en la fuente'
const ERR_NETWORK = 'Error de red (¿sin conexión?)'
const ERR_BAD_RESPONSE = 'Respuesta inesperada de la fuente'
const ERR_UNKNOWN_FORMAT = 'Formato no reconocido'

const YEAR_RE = /(?<!\d)(\d{4})(?!\d)/
const DASH_RE = /[\u2010-\u2015\u2212]/g
const CDATA_RE = /<!\[CDATA\[([\s\S]*?)\]\]>/g
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g
const MATH_BLOCK_RE = /\$[^\s$](?:[^$\n]*[^\s$])?\$/g
// Exige sintaxis válida de etiqueta XML/HTML (sin atributos sueltos arbitrarios)
// para no confundir desigualdades científicas como `k<n and m>d` con etiquetas.
const HTML_TAG_RE =
  /<(?:\/[a-zA-Z][\w:.-]*\s*|[a-zA-Z][\w:.-]*(?:\s+[a-zA-Z_:][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))*\s*\/?)>/g
const PUBMED_AUTHOR_RE = /^(.*\S)\s+([\p{Lu}]{1,4})$/u

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '\u2013',
  mdash: '\u2014',
  minus: '\u2212',
  rsquo: '\u2019',
  lsquo: '\u2018',
  ldquo: '\u201C',
  rdquo: '\u201D',
  hellip: '\u2026',
  times: '\u00D7',
  plusmn: '\u00B1',
  deg: '\u00B0',
  micro: '\u00B5',
  thinsp: '\u2009',
  alpha: '\u03B1',
  beta: '\u03B2',
  gamma: '\u03B3',
  delta: '\u03B4',
  epsilon: '\u03B5',
  zeta: '\u03B6',
  eta: '\u03B7',
  theta: '\u03B8',
  iota: '\u03B9',
  kappa: '\u03BA',
  lambda: '\u03BB',
  mu: '\u03BC',
  nu: '\u03BD',
  xi: '\u03BE',
  pi: '\u03C0',
  rho: '\u03C1',
  sigma: '\u03C3',
  tau: '\u03C4',
  phi: '\u03C6',
  chi: '\u03C7',
  psi: '\u03C8',
  omega: '\u03C9',
  Alpha: '\u0391',
  Beta: '\u0392',
  Gamma: '\u0393',
  Delta: '\u0394',
  Omega: '\u03A9',
  eacute: '\u00E9',
  egrave: '\u00E8',
  agrave: '\u00E0',
  aacute: '\u00E1',
  oacute: '\u00F3',
  uacute: '\u00FA',
  iacute: '\u00ED',
  ntilde: '\u00F1',
  ccedil: '\u00E7',
  szlig: '\u00DF',
  ouml: '\u00F6',
  uuml: '\u00FC',
  auml: '\u00E4',
  euml: '\u00EB',
  iuml: '\u00EF',
  Eacute: '\u00C9',
  Egrave: '\u00C8',
  Agrave: '\u00C0',
  Aacute: '\u00C1',
  Oacute: '\u00D3',
  Uacute: '\u00DA',
  Iacute: '\u00CD',
  Ntilde: '\u00D1',
  Ccedil: '\u00C7',
  Ouml: '\u00D6',
  Uuml: '\u00DC',
  Auml: '\u00C4',
  Euml: '\u00CB',
  Iuml: '\u00CF',
  copy: '\u00A9',
  reg: '\u00AE',
  sect: '\u00A7',
  para: '\u00B6',
  middot: '\u00B7',
  bull: '\u2022',
  dagger: '\u2020',
  Dagger: '\u2021',
  permil: '\u2030',
  prime: '\u2032',
  Prime: '\u2033',
  larr: '\u2190',
  rarr: '\u2192',
  le: '\u2264',
  ge: '\u2265',
  ne: '\u2260',
  infin: '\u221E',
  asymp: '\u2248',
}

function fail(kind: FetchErrorKind, error: string): FetchFailure {
  return { ok: false, error, kind }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function isValidCodePoint(code: number): boolean {
  return (
    Number.isFinite(code) &&
    code >= 1 &&
    code <= 0x10ffff &&
    (code < 0xd800 || code > 0xdfff)
  )
}

function decodeEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));/g, (match, hex, dec, named) => {
    if (typeof hex === 'string') {
      const code = Number.parseInt(hex, 16)
      return isValidCodePoint(code) ? String.fromCodePoint(code) : match
    }
    if (typeof dec === 'string') {
      const code = Number.parseInt(dec, 10)
      return isValidCodePoint(code) ? String.fromCodePoint(code) : match
    }
    if (typeof named === 'string') {
      const replacement = NAMED_ENTITIES[named]
      if (replacement !== undefined) return replacement
    }
    return match
  })
}

function stripHtml(raw: string): string {
  const unwrapped = raw.replace(CDATA_RE, '$1').replace(HTML_COMMENT_RE, '')
  let out = ''
  let lastIndex = 0
  for (const match of unwrapped.matchAll(MATH_BLOCK_RE)) {
    const idx = match.index ?? 0
    if (idx > lastIndex) {
      out += decodeEntities(unwrapped.slice(lastIndex, idx).replace(HTML_TAG_RE, ''))
    }
    out += match[0]
    lastIndex = idx + match[0].length
  }
  if (lastIndex < unwrapped.length) {
    out += decodeEntities(unwrapped.slice(lastIndex).replace(HTML_TAG_RE, ''))
  }
  return collapseWhitespace(out)
}

function cleanText(value: unknown): string | null {
  const raw = asNonEmptyString(value)
  if (raw === null) return null
  const cleaned = stripHtml(raw)
  return cleaned === '' ? null : cleaned
}

function unwrapXmlText(raw: string): string {
  let out = ''
  let lastIndex = 0
  for (const match of raw.matchAll(CDATA_RE)) {
    const idx = match.index ?? 0
    if (idx > lastIndex) {
      out += decodeEntities(raw.slice(lastIndex, idx))
    }
    out += match[1] ?? ''
    lastIndex = idx + match[0].length
  }
  if (lastIndex < raw.length) {
    out += decodeEntities(raw.slice(lastIndex))
  }
  return collapseWhitespace(out)
}

function extractYearFromValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1000 && value <= 9999) {
    return String(value)
  }
  if (typeof value === 'string') {
    const match = value.match(YEAR_RE)
    return match?.[1] ?? null
  }
  return null
}

function normalizePages(raw: string): string {
  return collapseWhitespace(raw).replace(DASH_RE, '-')
}

function setField(fields: Record<string, string>, name: string, rawValue: string | null): void {
  if (rawValue === null) return
  const cleaned = rawValue.trim()
  if (cleaned === '') return
  fields[name] = VERBATIM_FIELDS.has(name.toLowerCase())
    ? escapeVerbatim(cleaned)
    : escapeFieldValue(name, cleaned)
}

interface ParsedAuthor {
  formatted: string
  keyInput: AuthorKeyInput
}

function buildAuthorField(authors: readonly ParsedAuthor[]): {
  authorField: string | null
  firstAuthorKey: AuthorKeyInput
} {
  if (authors.length === 0) {
    return { authorField: null, firstAuthorKey: {} }
  }
  const first = authors[0]
  return {
    authorField: authors.map((a) => a.formatted).join(' and '),
    firstAuthorKey: first?.keyInput ?? {},
  }
}

interface ResponseLike {
  status: number
  ok: boolean
  text?: unknown
}

interface ReadableResponseLike extends ResponseLike {
  text(): Promise<unknown>
}

function isResponseLike(value: unknown): value is ResponseLike {
  return (
    isRecord(value) &&
    typeof value.status === 'number' &&
    Number.isFinite(value.status) &&
    typeof value.ok === 'boolean'
  )
}

function hasTextMethod(value: ResponseLike): value is ReadableResponseLike {
  return typeof value.text === 'function'
}

async function performFetch(
  url: string,
  headers: Record<string, string>,
  fetchFn: FetchFn,
  readMode: 'json' | 'text',
): Promise<{ ok: true; data: unknown } | FetchFailure> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, FETCH_TIMEOUT_MS)

  try {
    let rawResponse: unknown
    try {
      rawResponse = await fetchFn(url, { headers, signal: controller.signal })
    } catch {
      return fail('network', ERR_NETWORK)
    }

    if (!isResponseLike(rawResponse)) {
      return fail('bad-response', ERR_BAD_RESPONSE)
    }
    if (rawResponse.status === 404) {
      return fail('not-found', ERR_NOT_FOUND)
    }
    if (!rawResponse.ok) {
      return fail('bad-response', `La fuente devolvió un error (HTTP ${rawResponse.status})`)
    }
    if (!hasTextMethod(rawResponse)) {
      return fail('bad-response', ERR_BAD_RESPONSE)
    }

    let text: unknown
    try {
      text = await rawResponse.text()
    } catch {
      return fail('network', ERR_NETWORK)
    }

    if (typeof text !== 'string') {
      return fail('bad-response', ERR_BAD_RESPONSE)
    }

    if (readMode === 'json') {
      try {
        const data: unknown = JSON.parse(text)
        return { ok: true, data }
      } catch {
        return fail('bad-response', ERR_BAD_RESPONSE)
      }
    }

    return { ok: true, data: text }
  } finally {
    clearTimeout(timer)
  }
}

// --- Crossref (DOI) ---

function mapCrossrefType(rawType: unknown): { type: BibEntryType; reviewable: boolean } {
  switch (rawType) {
    case 'journal-article':
      return { type: 'article', reviewable: false }
    case 'proceedings-article':
      return { type: 'inproceedings', reviewable: false }
    case 'book':
    case 'monograph':
    case 'edited-book':
    case 'reference-book':
      return { type: 'book', reviewable: false }
    case 'book-chapter':
    case 'book-part':
    case 'book-section':
    case 'reference-entry':
      return { type: 'incollection', reviewable: false }
    case 'proceedings':
      return { type: 'proceedings', reviewable: false }
    case 'posted-content':
      return { type: 'misc', reviewable: true }
    case 'dissertation':
      return { type: 'phdthesis', reviewable: true }
    case 'report':
    case 'report-component':
      return { type: 'techreport', reviewable: false }
    case 'dataset':
      return { type: 'misc', reviewable: true }
    default:
      return { type: 'misc', reviewable: true }
  }
}

function extractCrossrefDateYear(dateObj: unknown): string | null {
  if (!isRecord(dateObj)) return null
  const dateParts = dateObj['date-parts']
  if (Array.isArray(dateParts) && Array.isArray(dateParts[0])) {
    const firstPart = dateParts[0][0]
    const fromParts = extractYearFromValue(firstPart)
    if (fromParts !== null) return fromParts
  }
  return extractYearFromValue(dateObj['date-time'])
}

function extractCrossrefInstitution(rawInstitution: unknown): string | null {
  if (Array.isArray(rawInstitution) && isRecord(rawInstitution[0])) {
    return cleanText(rawInstitution[0].name)
  }
  if (isRecord(rawInstitution)) {
    return cleanText(rawInstitution.name)
  }
  return null
}

function parseCrossrefAuthors(rawAuthors: unknown): ParsedAuthor[] {
  if (!Array.isArray(rawAuthors)) return []
  const result: ParsedAuthor[] = []

  for (const item of rawAuthors) {
    if (!isRecord(item)) continue
    const family = cleanText(item.family)
    const given = cleanText(item.given)
    if (family !== null) {
      result.push({
        formatted: given !== null ? `${family}, ${given}` : family,
        keyInput: { family },
      })
      continue
    }
    const institutional =
      cleanText(item.name) ?? cleanText(item.literal) ?? given
    if (institutional !== null) {
      result.push({
        formatted: institutional,
        keyInput: { full: institutional },
      })
    }
  }

  return result
}

function mapCrossrefResponse(data: unknown, normalizedDoi: string): FetchResult {
  if (!isRecord(data) || !isRecord(data.message)) {
    return fail('bad-response', ERR_BAD_RESPONSE)
  }
  const message = data.message

  const rawTitleList = message.title
  const firstRawTitle =
    Array.isArray(rawTitleList) && typeof rawTitleList[0] === 'string'
      ? stripHtml(rawTitleList[0])
      : ''
  if (firstRawTitle === '') {
    return fail('bad-response', ERR_BAD_RESPONSE)
  }

  const mapped = mapCrossrefType(message.type)
  const type = mapped.type
  let reviewable = mapped.reviewable

  const authors = parseCrossrefAuthors(message.author)
  const { authorField, firstAuthorKey } = buildAuthorField(authors)

  const editors = parseCrossrefAuthors(message.editor)
  const { authorField: editorField, firstAuthorKey: firstEditorKey } = buildAuthorField(editors)

  const containerList = message['container-title']
  const containerTitle =
    Array.isArray(containerList) && typeof containerList[0] === 'string'
      ? cleanText(containerList[0])
      : null

  const year =
    extractCrossrefDateYear(message['published-print']) ??
    extractCrossrefDateYear(message['published-online']) ??
    extractCrossrefDateYear(message.published) ??
    extractCrossrefDateYear(message.issued) ??
    extractCrossrefDateYear(message.posted) ??
    extractCrossrefDateYear(message.created)

  const publisher = cleanText(message.publisher)
  const institutionName = extractCrossrefInstitution(message.institution)

  const fields: Record<string, string> = {}
  setField(fields, 'author', authorField)
  fields.title = formatTitle(firstRawTitle)

  if (type === 'article') {
    setField(fields, 'journal', containerTitle)
  } else if (type === 'inproceedings' || type === 'incollection') {
    setField(fields, 'booktitle', containerTitle)
  }

  setField(fields, 'editor', editorField)
  setField(fields, 'volume', cleanText(message.volume))
  setField(fields, 'number', cleanText(message.issue))

  const rawPages = cleanText(message.page) ?? cleanText(message['article-number'])
  if (rawPages !== null) {
    setField(fields, 'pages', normalizePages(rawPages))
  }

  setField(fields, 'publisher', publisher)

  if (message.type === 'dissertation') {
    setField(fields, 'school', institutionName ?? publisher)
  } else if (message.type === 'report' || message.type === 'report-component') {
    const resolvedInstitution = institutionName ?? publisher
    if (resolvedInstitution !== null) {
      setField(fields, 'institution', resolvedInstitution)
    } else {
      reviewable = true
    }
  }

  setField(fields, 'year', year)
  setField(fields, 'doi', asNonEmptyString(message.DOI) ?? normalizedDoi)
  setField(fields, 'url', asNonEmptyString(message.URL))

  const keyAuthor = authors.length > 0 ? firstAuthorKey : firstEditorKey

  const entry: BibEntry = {
    type,
    key: buildKey(keyAuthor, year, firstRawTitle),
    fields,
    sourceKind: 'doi',
    sourceId: normalizedDoi,
    reviewable,
  }
  return { ok: true, entry }
}

// --- arXiv (Atom XML) ---

function makeOpenTagRe(localName: string, flags: string): RegExp {
  return new RegExp(
    `<((?:[\\w.-]+:)?${localName})(?:\\s+(?:[^>"']|"[^"]*"|'[^']*')*)?(?<!\\/)>([\\s\\S]*?)<\\/\\1\\s*>`,
    flags,
  )
}

function extractFirstTagText(block: string, localName: string): string | null {
  const re = makeOpenTagRe(localName, 'i')
  const match = block.match(re)
  if (match?.[2] === undefined) return null
  const text = unwrapXmlText(match[2])
  return text === '' ? null : text
}

/**
 * Parsea un feed Atom XML de la API de arXiv sin depender de DOMParser (compatible con Node).
 * Extrae por cada `<entry>`: id, título, autores, fecha de publicación, categoría principal,
 * DOI, comentario y `journal_ref`, limpiando bloques CDATA y entidades XML.
 */
export function parseArxivAtom(xml: string): ArxivAtomEntry[] {
  const entries: ArxivAtomEntry[] = []
  const entryRe = makeOpenTagRe('entry', 'gi')
  const authorRe = makeOpenTagRe('author', 'gi')
  const primaryCatRe =
    /<(?:[\w.-]+:)?primary_category\b[^>]*\bterm\s*=\s*(?:"([^"]*)"|'([^']*)')/i

  for (const entryMatch of xml.matchAll(entryRe)) {
    const block = entryMatch[2]
    if (block === undefined) continue

    const id = extractFirstTagText(block, 'id')
    const isError = id !== null && id.includes('arxiv.org/api/errors')

    const title = extractFirstTagText(block, 'title') ?? ''

    const authors: string[] = []
    for (const authorMatch of block.matchAll(authorRe)) {
      const authorBlock = authorMatch[2]
      if (authorBlock === undefined) continue
      const name = extractFirstTagText(authorBlock, 'name')
      if (name !== null) {
        authors.push(name)
      }
    }

    const published = extractFirstTagText(block, 'published')

    const catMatch = block.match(primaryCatRe)
    const rawCat = catMatch?.[1] ?? catMatch?.[2]
    const primaryCategory = rawCat !== undefined ? collapseWhitespace(decodeEntities(rawCat)) : null

    const doi = extractFirstTagText(block, 'doi')
    const comment = extractFirstTagText(block, 'comment')
    const journalRef = extractFirstTagText(block, 'journal_ref')

    entries.push({
      id,
      title,
      authors,
      published,
      primaryCategory: primaryCategory === '' ? null : primaryCategory,
      doi,
      comment,
      journalRef,
      isError,
    })
  }

  return entries
}

function mapArxivResponse(xml: unknown, normalizedId: string): FetchResult {
  if (
    typeof xml !== 'string' ||
    !/<(?:[\w.-]+:)?feed\b/i.test(xml) ||
    !/<\/(?:[\w.-]+:)?feed\s*>/i.test(xml)
  ) {
    return fail('bad-response', ERR_BAD_RESPONSE)
  }

  const entries = parseArxivAtom(xml)
  const first = entries[0]
  if (first === undefined || first.isError) {
    return fail('not-found', ERR_NOT_FOUND)
  }

  const isEmptyEntry =
    first.id === null &&
    first.title === '' &&
    first.authors.length === 0 &&
    first.published === null
  if (isEmptyEntry) {
    return fail('not-found', ERR_NOT_FOUND)
  }

  if (first.title === '') {
    return fail('bad-response', ERR_BAD_RESPONSE)
  }

  const authors: ParsedAuthor[] = first.authors.map((name) => ({
    formatted: name,
    keyInput: { full: name },
  }))
  const { authorField, firstAuthorKey } = buildAuthorField(authors)

  const year = extractYearFromValue(first.published)
  const fields: Record<string, string> = {}

  setField(fields, 'author', authorField)
  fields.title = formatTitle(first.title)

  let type: BibEntryType = 'misc'
  let reviewable = false

  if (first.journalRef !== null) {
    // Mapeo aproximado: en arXiv `journal_ref` viene como texto libre (p. ej. "Phys. Rev. D 107, 034021 (2023)").
    // Se toma el texto hasta la primera coma como nombre aproximado de revista y se marca `reviewable: true`.
    const commaIdx = first.journalRef.indexOf(',')
    const approxJournal =
      commaIdx !== -1 ? first.journalRef.slice(0, commaIdx).trim() : first.journalRef.trim()
    if (approxJournal !== '') {
      type = 'article'
      reviewable = true
      setField(fields, 'journal', approxJournal)
    }
  }

  setField(fields, 'year', year)
  setField(fields, 'note', first.comment)
  setField(fields, 'doi', first.doi)
  setField(fields, 'eprint', normalizedId)
  setField(fields, 'archivePrefix', 'arXiv')
  setField(fields, 'primaryClass', first.primaryCategory)

  const entry: BibEntry = {
    type,
    key: buildKey(firstAuthorKey, year, first.title),
    fields,
    sourceKind: 'arxiv',
    sourceId: normalizedId,
    reviewable,
  }
  return { ok: true, entry }
}

// --- OpenLibrary (ISBN) ---

function mapOpenLibraryResponse(data: unknown, normalizedIsbn13: string): FetchResult {
  if (!isRecord(data)) {
    return fail('bad-response', ERR_BAD_RESPONSE)
  }

  const key = `ISBN:${normalizedIsbn13}`
  const book = data[key]
  if (book === undefined || book === null) {
    return fail('not-found', ERR_NOT_FOUND)
  }
  if (!isRecord(book)) {
    return fail('bad-response', ERR_BAD_RESPONSE)
  }
  if (Object.keys(book).length === 0) {
    return fail('not-found', ERR_NOT_FOUND)
  }

  const baseTitle = cleanText(book.title)
  if (baseTitle === null) {
    return fail('bad-response', ERR_BAD_RESPONSE)
  }
  const subtitle = cleanText(book.subtitle)
  const rawTitle = subtitle !== null ? `${baseTitle}: ${subtitle}` : baseTitle

  const authors: ParsedAuthor[] = []
  if (Array.isArray(book.authors)) {
    for (const item of book.authors) {
      if (!isRecord(item)) continue
      const name = cleanText(item.name)
      if (name !== null) {
        authors.push({ formatted: name, keyInput: { full: name } })
      }
    }
  }
  const { authorField, firstAuthorKey } = buildAuthorField(authors)

  let publisher: string | null = null
  if (Array.isArray(book.publishers) && isRecord(book.publishers[0])) {
    publisher = cleanText(book.publishers[0].name)
  }

  const year = extractYearFromValue(book.publish_date)
  const fields: Record<string, string> = {}

  setField(fields, 'author', authorField)
  fields.title = formatTitle(rawTitle)
  setField(fields, 'publisher', publisher)
  setField(fields, 'year', year)
  setField(fields, 'isbn', normalizedIsbn13)

  const entry: BibEntry = {
    type: 'book',
    key: buildKey(firstAuthorKey, year, rawTitle),
    fields,
    sourceKind: 'isbn',
    sourceId: normalizedIsbn13,
    reviewable: false,
  }
  return { ok: true, entry }
}

// --- Europe PMC (PMID) ---

function parsePubMedAuthorFragment(raw: string): ParsedAuthor | null {
  const cleaned = stripHtml(raw).replace(/\.$/, '').trim()
  if (cleaned === '') return null

  const match = cleaned.match(PUBMED_AUTHOR_RE)
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const family = match[1].trim()
    const initials = match[2]
    if (family !== '') {
      return {
        formatted: `${family}, ${initials}`,
        keyInput: { family },
      }
    }
  }

  return {
    formatted: cleaned,
    keyInput: { full: cleaned },
  }
}

function parseEuropePmcAuthors(record: Record<string, unknown>): ParsedAuthor[] {
  const result: ParsedAuthor[] = []
  const authorList = record.authorList
  if (isRecord(authorList) && Array.isArray(authorList.author)) {
    for (const item of authorList.author) {
      if (!isRecord(item)) continue
      const lastName = cleanText(item.lastName)
      const given = cleanText(item.firstName) ?? cleanText(item.initials)
      if (lastName !== null) {
        result.push({
          formatted: given !== null ? `${lastName}, ${given}` : lastName,
          keyInput: { family: lastName },
        })
        continue
      }
      const collectiveName = cleanText(item.collectiveName)
      if (collectiveName !== null) {
        const cleanedCollective = collectiveName.replace(/\.$/, '').trim()
        if (cleanedCollective !== '') {
          result.push({
            formatted: cleanedCollective,
            keyInput: { full: cleanedCollective },
          })
        }
        continue
      }
      const fullName = cleanText(item.fullName)
      if (fullName !== null) {
        const parsed = parsePubMedAuthorFragment(fullName)
        if (parsed !== null) {
          result.push(parsed)
        }
      }
    }
    if (result.length > 0) {
      return result
    }
  }

  // Respaldo cuando Europe PMC responde en formato lite (`authorString` separado por comas)
  // o cuando `authorList.author` llega vacío.
  const authorString = cleanText(record.authorString)
  if (authorString !== null) {
    for (const part of authorString.split(',')) {
      const parsed = parsePubMedAuthorFragment(part)
      if (parsed !== null) {
        result.push(parsed)
      }
    }
  }
  return result
}

function mapEuropePmcResponse(data: unknown, normalizedPmid: string): FetchResult {
  if (!isRecord(data) || !isRecord(data.resultList) || !Array.isArray(data.resultList.result)) {
    return fail('bad-response', ERR_BAD_RESPONSE)
  }

  const results = data.resultList.result
  if (results.length === 0) {
    return fail('not-found', ERR_NOT_FOUND)
  }

  const first = results[0]
  if (!isRecord(first)) {
    return fail('bad-response', ERR_BAD_RESPONSE)
  }

  const rawTitleStr = asNonEmptyString(first.title)
  const rawTitle = rawTitleStr !== null ? stripHtml(rawTitleStr) : ''
  if (rawTitle === '') {
    return fail('bad-response', ERR_BAD_RESPONSE)
  }

  const authors = parseEuropePmcAuthors(first)
  const { authorField, firstAuthorKey } = buildAuthorField(authors)

  const journalInfo = isRecord(first.journalInfo) ? first.journalInfo : null
  const journalObj = journalInfo !== null && isRecord(journalInfo.journal) ? journalInfo.journal : null

  const journalTitle =
    cleanText(journalObj?.title) ?? cleanText(first.journalTitle)
  const volume =
    cleanText(journalInfo?.volume) ?? cleanText(first.journalVolume)
  const issue =
    cleanText(journalInfo?.issue) ?? cleanText(first.issue)
  const rawPages = cleanText(first.pageInfo)

  const year =
    extractYearFromValue(first.pubYear) ??
    extractYearFromValue(journalInfo?.yearOfPublication)
  const fields: Record<string, string> = {}

  setField(fields, 'author', authorField)
  fields.title = formatTitle(rawTitle)
  setField(fields, 'journal', journalTitle)
  setField(fields, 'volume', volume)
  setField(fields, 'number', issue)
  if (rawPages !== null) {
    setField(fields, 'pages', normalizePages(rawPages))
  }
  setField(fields, 'year', year)
  setField(fields, 'doi', asNonEmptyString(first.doi))
  setField(fields, 'pmid', normalizedPmid)

  const entry: BibEntry = {
    type: 'article',
    key: buildKey(firstAuthorKey, year, rawTitle),
    fields,
    sourceKind: 'pmid',
    sourceId: normalizedPmid,
    reviewable: false,
  }
  return { ok: true, entry }
}

// --- API pública ---

// export.arxiv.org no envía cabeceras CORS (Access-Control-Allow-Origin), por lo que
// en el navegador las peticiones pasan por el proxy same-origin de nginx (y server.proxy
// en Vite durante el desarrollo). En Node se consulta la API pública directamente.
function resolveArxivBase(options?: FetchOptions): string {
  const explicit = options?.arxivBase?.trim()
  if (explicit !== undefined && explicit !== '') {
    return explicit.replace(/\/+$/, '')
  }
  const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined'
  return isBrowser ? 'api/arxiv' : 'https://export.arxiv.org/api'
}

export async function fetchMetadata(
  id: ParsedIdentifier,
  fetchFn: FetchFn = (input, init) => globalThis.fetch(input, init),
  options?: FetchOptions,
): Promise<FetchResult> {
  try {
    if (id.kind === 'unknown' || id.normalized === null || id.normalized.trim() === '') {
      return fail('bad-response', asNonEmptyString(id.error) ?? ERR_UNKNOWN_FORMAT)
    }

    const normalized = id.normalized

    switch (id.kind) {
      case 'doi': {
        const url = `https://api.crossref.org/works/${encodeURIComponent(normalized)}?mailto=${CROSSREF_MAILTO}`
        const res = await performFetch(url, { Accept: 'application/json' }, fetchFn, 'json')
        if (!res.ok) return res
        return mapCrossrefResponse(res.data, normalized)
      }
      case 'arxiv': {
        const encodedId = encodeURIComponent(normalized).replace(/%2F/gi, '/')
        const arxivBase = resolveArxivBase(options)
        const url = `${arxivBase}/query?id_list=${encodedId}`
        const res = await performFetch(url, { Accept: 'application/atom+xml' }, fetchFn, 'text')
        if (!res.ok) return res
        return mapArxivResponse(res.data, normalized)
      }
      case 'isbn': {
        const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(normalized)}&format=json&jscmd=data`
        const res = await performFetch(url, { Accept: 'application/json' }, fetchFn, 'json')
        if (!res.ok) return res
        return mapOpenLibraryResponse(res.data, normalized)
      }
      case 'pmid': {
        const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=SRC:MED%20AND%20EXT_ID:${encodeURIComponent(normalized)}&resultType=core&pageSize=1&format=json`
        const res = await performFetch(url, { Accept: 'application/json' }, fetchFn, 'json')
        if (!res.ok) return res
        return mapEuropePmcResponse(res.data, normalized)
      }
      default: {
        return fail('bad-response', ERR_UNKNOWN_FORMAT)
      }
    }
  } catch {
    return fail('network', ERR_NETWORK)
  }
}
