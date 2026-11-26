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

// Detección, normalización y deduplicación de identificadores (DOI, arXiv, ISBN, PMID).

export type IdentifierKind = 'doi' | 'arxiv' | 'isbn' | 'pmid' | 'unknown'

export interface ParsedIdentifier {
  line: number
  raw: string
  kind: IdentifierKind
  normalized: string | null
  error: string | null
}

export const MAX_IDENTIFIERS = 50

export interface ParseResult {
  items: ParsedIdentifier[]
  ignoredExtra: number
}

export interface DuplicateInfo {
  line: number
  raw: string
  firstLine: number
}

export interface DedupeResult {
  unique: ParsedIdentifier[]
  duplicates: DuplicateInfo[]
}

const EDGE_NOISE_RE = /^[\s\u200B\uFEFF]+|[\s\u200B\uFEFF]+$/g
const TYPOGRAPHIC_DASH_RE = /[\u2010-\u2014]/g

const DOI_URL_RE = /^(?:https?:\/\/)?(?:(?:www|dx)\.)?doi\.org\//i
const DOI_PREFIX_RE = /^doi:\s*/i
const DOI_BODY_RE = /^10\.\d{4,9}(?:\.\d+)*\/\S+$/

const ARXIV_URL_RE = /^(?:https?:\/\/)?(?:(?:www|export)\.)?arxiv\.org\/(abs|pdf)\//i
const ARXIV_PREFIX_RE = /^arxiv:\s*/i
const ARXIV_NEW_RE = /^(\d{2})(\d{2})\.(\d{4,5})(?:v\d+)?$/i
const ARXIV_OLD_RE = /^([a-z]+(?:-[a-z]+)*)(?:\.[a-z]+(?:-[a-z]+)*)?\/(\d{7})(?:v\d+)?$/i
const ARXIV_DOI_PREFIX = '10.48550/arxiv.'

const ISBN_PREFIX_RE = /^isbn(?:-(?:10|13)(?:\s*:\s*|\s+)|(?:\s*:\s*|\s*))/i
const ISBN_CHARS_RE = /^[0-9][0-9\s-]*[0-9Xx]$/

const PMID_BARE_RE = /^\d+$/
const PMID_PREFIX_RE = /^pmid(?:\s*:\s*|\s*)(\d+)$/i
const PMID_URL_RE = /^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/?$/i

function isWrappedInParens(s: string): boolean {
  if (!s.startsWith('(') || !s.endsWith(')')) return false
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') {
      depth++
    } else if (s[i] === ')') {
      depth--
      if (depth === 0 && i < s.length - 1) return false
    }
  }
  return depth === 0
}

function hasUnbalancedClosingParen(s: string): boolean {
  let opens = 0
  let closes = 0
  for (const ch of s) {
    if (ch === '(') opens++
    else if (ch === ')') closes++
  }
  return closes > opens
}

function cleanInput(raw: string): string {
  let s = raw.replace(EDGE_NOISE_RE, '')
  let prev = ''
  while (s !== prev) {
    prev = s
    s = s.replace(/[.,;]$/, '').replace(EDGE_NOISE_RE, '')
    if (isWrappedInParens(s)) {
      s = s.slice(1, -1).replace(EDGE_NOISE_RE, '')
    } else if (s.endsWith(')') && hasUnbalancedClosingParen(s)) {
      s = s.slice(0, -1).replace(EDGE_NOISE_RE, '')
    }
  }
  return s
}

function isValidIsbn10(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < 10; i++) {
    const ch = digits[i]
    const value = ch === 'X' ? 10 : Number(ch)
    sum += (10 - i) * value
  }
  return sum % 11 === 0
}

function isValidIsbn13(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < 13; i++) {
    const value = Number(digits[i])
    sum += (i % 2 === 0 ? 1 : 3) * value
  }
  return sum % 10 === 0
}

function isbn10ToIsbn13(digits10: string): string {
  const base = '978' + digits10.slice(0, 9)
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += (i % 2 === 0 ? 1 : 3) * Number(base[i])
  }
  const check = (10 - (sum % 10)) % 10
  return base + String(check)
}

function tryDetectDoi(cleaned: string): string | null {
  let candidate = cleaned
  if (DOI_URL_RE.test(candidate)) {
    candidate = candidate.replace(DOI_URL_RE, '').replace(/[?#].*$/, '')
  } else if (DOI_PREFIX_RE.test(candidate)) {
    candidate = candidate.replace(DOI_PREFIX_RE, '')
  }
  candidate = candidate.replace(/%2f/gi, '/')
  if (DOI_BODY_RE.test(candidate)) {
    return candidate.toLowerCase()
  }
  return null
}

function normalizeArxivBody(candidate: string): string | null {
  const newMatch = candidate.match(ARXIV_NEW_RE)
  if (newMatch) {
    const yyStr = newMatch[1]
    const mmStr = newMatch[2]
    const seq = newMatch[3]
    if (yyStr === undefined || mmStr === undefined || seq === undefined) return null
    const yy = Number(yyStr)
    const mm = Number(mmStr)
    if (mm < 1 || mm > 12) return null
    const yymm = yy * 100 + mm
    if (seq.length === 4 && (yymm < 704 || yymm > 1412)) return null
    if (seq.length === 5 && yymm < 1501) return null
    return `${yyStr}${mmStr}.${seq}`
  }
  const oldMatch = candidate.match(ARXIV_OLD_RE)
  if (oldMatch) {
    const archive = oldMatch[1]
    const num = oldMatch[2]
    if (archive === undefined || num === undefined) return null
    return `${archive.toLowerCase()}/${num}`
  }
  return null
}

function tryDetectArxiv(cleaned: string): string | null {
  let candidate = cleaned
  const urlMatch = candidate.match(ARXIV_URL_RE)
  if (urlMatch) {
    candidate = candidate.slice(urlMatch[0].length).replace(/\/$/, '')
    if (urlMatch[1]?.toLowerCase() === 'pdf') {
      candidate = candidate.replace(/\.pdf$/i, '')
    }
  } else if (ARXIV_PREFIX_RE.test(candidate)) {
    candidate = candidate.replace(ARXIV_PREFIX_RE, '')
  }
  return normalizeArxivBody(candidate)
}

type IsbnCheck =
  | { status: 'valid'; normalized: string }
  | { status: 'invalid-checksum' }
  | { status: 'invalid-prefix' }
  | { status: 'not-isbn' }

function tryDetectIsbn(cleaned: string): IsbnCheck {
  const withHyphens = cleaned.replace(TYPOGRAPHIC_DASH_RE, '-')
  const hadPrefix = ISBN_PREFIX_RE.test(withHyphens)
  const body = hadPrefix ? withHyphens.replace(ISBN_PREFIX_RE, '') : withHyphens
  if (!ISBN_CHARS_RE.test(body)) {
    return { status: 'not-isbn' }
  }
  const digits = body.replace(/[\s-]+/g, '').toUpperCase()
  if (/^0+$/.test(digits)) {
    return { status: 'not-isbn' }
  }
  if (/^\d{9}[\dX]$/.test(digits)) {
    if (isValidIsbn10(digits)) {
      return { status: 'valid', normalized: isbn10ToIsbn13(digits) }
    }
    if (!hadPrefix && !/[\s-]/.test(body) && /^0\d{9}$/.test(digits)) {
      return { status: 'not-isbn' }
    }
    return { status: 'invalid-checksum' }
  }
  if (/^\d{13}$/.test(digits)) {
    const hasIsbn13Prefix = digits.startsWith('978') || digits.startsWith('979')
    if (isValidIsbn13(digits)) {
      return hasIsbn13Prefix
        ? { status: 'valid', normalized: digits }
        : { status: 'invalid-prefix' }
    }
    if (hasIsbn13Prefix) {
      return { status: 'invalid-checksum' }
    }
    if (hadPrefix || /[\s-]/.test(body)) {
      return { status: 'invalid-prefix' }
    }
    return { status: 'not-isbn' }
  }
  return { status: 'not-isbn' }
}

type PmidCheck =
  | { status: 'valid'; normalized: string }
  | { status: 'too-short' }
  | { status: 'not-pmid' }

function tryDetectPmid(cleaned: string): PmidCheck {
  const explicitMatch = cleaned.match(PMID_URL_RE) ?? cleaned.match(PMID_PREFIX_RE)
  if (explicitMatch && explicitMatch[1] !== undefined) {
    const normalized = explicitMatch[1].replace(/^0+/, '')
    return normalized.length >= 1 && normalized.length <= 9
      ? { status: 'valid', normalized }
      : { status: 'not-pmid' }
  }
  if (PMID_BARE_RE.test(cleaned)) {
    const normalized = cleaned.replace(/^0+/, '')
    if (normalized.length === 0) return { status: 'not-pmid' }
    if (normalized.length < 5) return { status: 'too-short' }
    if (normalized.length <= 9) return { status: 'valid', normalized }
  }
  return { status: 'not-pmid' }
}

export function detectIdentifier(raw: string, line = 0): ParsedIdentifier {
  const cleaned = cleanInput(raw)

  if (cleaned === '') {
    return {
      line,
      raw,
      kind: 'unknown',
      normalized: null,
      error: 'Formato no reconocido',
    }
  }

  const doi = tryDetectDoi(cleaned)
  if (doi !== null) {
    return { line, raw, kind: 'doi', normalized: doi, error: null }
  }

  const arxiv = tryDetectArxiv(cleaned)
  if (arxiv !== null) {
    return { line, raw, kind: 'arxiv', normalized: arxiv, error: null }
  }

  const isbn = tryDetectIsbn(cleaned)
  if (isbn.status === 'valid') {
    return { line, raw, kind: 'isbn', normalized: isbn.normalized, error: null }
  }
  if (isbn.status === 'invalid-checksum') {
    return {
      line,
      raw,
      kind: 'unknown',
      normalized: null,
      error: 'ISBN con dígito de control inválido',
    }
  }
  if (isbn.status === 'invalid-prefix') {
    return {
      line,
      raw,
      kind: 'unknown',
      normalized: null,
      error: 'El ISBN-13 debe empezar por 978 o 979',
    }
  }

  const pmid = tryDetectPmid(cleaned)
  if (pmid.status === 'valid') {
    return { line, raw, kind: 'pmid', normalized: pmid.normalized, error: null }
  }
  if (pmid.status === 'too-short') {
    return {
      line,
      raw,
      kind: 'unknown',
      normalized: null,
      error: 'Número demasiado corto para ser PMID',
    }
  }

  return {
    line,
    raw,
    kind: 'unknown',
    normalized: null,
    error: 'Formato no reconocido',
  }
}

export function parseIdentifiers(text: string): ParseResult {
  const lines = text.split(/\r\n?|\n/)
  const items: ParsedIdentifier[] = []
  let ignoredExtra = 0

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (raw === undefined || raw.replace(EDGE_NOISE_RE, '') === '') continue

    if (items.length >= MAX_IDENTIFIERS) {
      ignoredExtra++
      continue
    }

    items.push(detectIdentifier(raw, i + 1))
  }

  return { items, ignoredExtra }
}

function dedupeKey(item: ParsedIdentifier): string {
  if (
    item.kind === 'doi' &&
    item.normalized !== null &&
    item.normalized.startsWith(ARXIV_DOI_PREFIX)
  ) {
    const arxivId = normalizeArxivBody(item.normalized.slice(ARXIV_DOI_PREFIX.length))
    if (arxivId !== null) {
      return `arxiv:${arxivId}`
    }
  }
  return `${item.kind}:${item.normalized}`
}

export function dedupeIdentifiers(items: ParsedIdentifier[]): DedupeResult {
  const seen = new Map<string, number>()
  const unique: ParsedIdentifier[] = []
  const duplicates: DuplicateInfo[] = []

  for (const item of items) {
    if (item.kind === 'unknown' || item.normalized === null) {
      unique.push(item)
      continue
    }

    const key = dedupeKey(item)
    const firstLine = seen.get(key)
    if (firstLine !== undefined) {
      duplicates.push({ line: item.line, raw: item.raw, firstLine })
    } else {
      seen.set(key, item.line)
      unique.push(item)
    }
  }

  return { unique, duplicates }
}
