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

// Núcleo BibTeX: escape LaTeX, protección de siglas, generación de claves y formato de entradas.

export type BibEntryType =
  | 'article'
  | 'book'
  | 'inproceedings'
  | 'misc'
  | 'phdthesis'
  | 'mastersthesis'
  | 'techreport'
  | 'incollection'
  | 'unpublished'
  | 'inbook'
  | 'proceedings'

export interface BibEntry {
  type: BibEntryType
  key: string
  fields: Record<string, string> // valores YA escapados para BibTeX
  sourceKind: 'doi' | 'arxiv' | 'isbn' | 'pmid'
  sourceId: string // identificador normalizado de origen
  reviewable: boolean // true si el tipo se asignó por defecto y conviene revisarlo
}

export interface AuthorKeyInput {
  family?: string
  full?: string
}

// Campos literales que biblatex/hyperref leen tal cual (escapar _, %, #, ~ rompería enlaces o IDs).
export const VERBATIM_FIELDS: ReadonlySet<string> = new Set([
  'doi',
  'url',
  'eprint',
  'isbn',
  'pmid',
])

// Llaves siempre a {\textbraceleft} / {\textbraceright} para garantizar llaves equilibradas en .bib.
const LATEX_SPECIAL_MAP: Record<string, string> = {
  '\\': '{\\textbackslash}',
  '{': '{\\textbraceleft}',
  '}': '{\\textbraceright}',
  $: '\\$',
  '%': '\\%',
  '&': '\\&',
  '#': '\\#',
  _: '\\_',
  '^': '{\\textasciicircum}',
  '~': '{\\textasciitilde}',
}

const LATEX_PUNCT_MAP: Record<string, string> = {
  '\u2013': '--', // –
  '\u2014': '---', // —
  '\u201C': '``', // “
  '\u201D': "''", // ”
  '\u2018': '`', // ‘
  '\u2019': "'", // ’
}

const LATEX_STANDALONE_MAP: Record<string, string> = {
  ø: '{\\o}',
  Ø: '{\\O}',
  ł: '{\\l}',
  Ł: '{\\L}',
  ß: '{\\ss}',
  æ: '{\\ae}',
  Æ: '{\\AE}',
  œ: '{\\oe}',
  Œ: '{\\OE}',
  å: '{\\aa}',
  Å: '{\\AA}',
  ı: '{\\i}',
}

interface CombiningAccentSpec {
  cmd: string
  isLetterCmd: boolean
  dotlessI: boolean
}

const COMBINING_ACCENT_MAP: Record<string, CombiningAccentSpec> = {
  '\u0301': { cmd: "\\'", isLetterCmd: false, dotlessI: true },
  '\u0300': { cmd: '\\`', isLetterCmd: false, dotlessI: true },
  '\u0302': { cmd: '\\^', isLetterCmd: false, dotlessI: true },
  '\u0308': { cmd: '\\"', isLetterCmd: false, dotlessI: true },
  '\u0303': { cmd: '\\~', isLetterCmd: false, dotlessI: true },
  '\u0327': { cmd: '\\c', isLetterCmd: true, dotlessI: false },
  '\u030C': { cmd: '\\v', isLetterCmd: true, dotlessI: true },
  '\u030B': { cmd: '\\H', isLetterCmd: true, dotlessI: true },
  '\u0306': { cmd: '\\u', isLetterCmd: true, dotlessI: true },
  '\u0304': { cmd: '\\=', isLetterCmd: false, dotlessI: true },
  '\u0307': { cmd: '\\.', isLetterCmd: false, dotlessI: true },
  '\u030A': { cmd: '\\r', isLetterCmd: true, dotlessI: true },
  '\u0328': { cmd: '\\k', isLetterCmd: true, dotlessI: false },
}

const TRANSLITERATION_MAP: Record<string, string> = {
  ł: 'l',
  Ł: 'L',
  ø: 'o',
  Ø: 'O',
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  þ: 'th',
  Þ: 'TH',
  ı: 'i',
}

const STOPWORDS: ReadonlySet<string> = new Set([
  // Inglés
  'the',
  'a',
  'an',
  'of',
  'on',
  'in',
  'for',
  'and',
  'to',
  'is',
  'are',
  'with',
  'at',
  'by',
  'from',
  'as',
  'its',
  'into',
  'via',
  // Español
  'el',
  'la',
  'los',
  'las',
  'de',
  'del',
  'al',
  'lo',
  'en',
  'y',
  'o',
  'u',
  'un',
  'una',
  'unos',
  'unas',
  'con',
  'por',
  'para',
  'sobre',
  'entre',
  // Francés
  'le',
  'les',
  'des',
  'du',
  'une',
  // Portugués
  'os',
  'um',
  'uma',
  'do',
  'da',
  // Alemán
  'der',
  'die',
  'das',
  'ein',
])

// Partículas de apellido (comparación insensible a mayúsculas).
// Nota: aceptar el riesgo conocido de nombres de pila asiáticos homógrafos (p. ej. "De", "Da").
const SURNAME_PARTICLES: ReadonlySet<string> = new Set([
  'van',
  'von',
  'de',
  'del',
  'della',
  'des',
  'du',
  'da',
  'das',
  'do',
  'dos',
  'di',
  'la',
  'las',
  'le',
  'les',
  'los',
  'der',
  'den',
  'ter',
  'ten',
])

const CANONICAL_FIELD_ORDER: readonly string[] = [
  'author',
  'title',
  'journal',
  'booktitle',
  'editor',
  'edition',
  'series',
  'volume',
  'number',
  'chapter',
  'pages',
  'publisher',
  'school',
  'institution',
  'organization',
  'address',
  'month',
  'year',
  'note',
  'doi',
  'url',
  'eprint',
  'archivePrefix',
  'primaryClass',
  'isbn',
  'issn',
  'pmid',
]

const CANONICAL_FIELD_LOWER_SET: ReadonlySet<string> = new Set(
  CANONICAL_FIELD_ORDER.map((field) => field.toLowerCase()),
)

const INTERNAL_UPPER_RE = /^.+\p{Lu}/u
const INITIAL_TOKEN_RE = /^\p{L}\.?$/u
const YEAR_RE = /(?<!\d)(\d{4})(?!\d)/
const NAME_SUFFIX_RE = /^(?:[Jj][Rr]\.?|[Ss][Rr]\.?|II|III|IV)$/
const VALID_KEY_RE = /^[A-Za-z0-9_:\-.]+$/
const ASCII_LETTER_RE = /^[A-Za-z]$/

function isAcronymWord(word: string): boolean {
  // Toda palabra con al menos una mayúscula más allá del primer carácter
  // (p. ej. NASA, GPU, LaTeX, BibTeX, GPUs, 3D, pH). Palabras con solo
  // mayúscula inicial ("Deep", "A", "Einstein") devuelven false.
  return INTERNAL_UPPER_RE.test(word)
}

function transliterate(value: string): string {
  let out = ''
  for (const ch of value) {
    out += TRANSLITERATION_MAP[ch] ?? ch
  }
  return out
}

export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function escapeCluster(cluster: string): string {
  const direct =
    LATEX_SPECIAL_MAP[cluster] ?? LATEX_PUNCT_MAP[cluster] ?? LATEX_STANDALONE_MAP[cluster]
  if (direct !== undefined) {
    return direct
  }

  const nfd = cluster.normalize('NFD')
  const parts = Array.from(nfd)
  if (parts.length === 2) {
    const base = parts[0]
    const mark = parts[1]
    if (base !== undefined && mark !== undefined && ASCII_LETTER_RE.test(base)) {
      const spec = COMBINING_ACCENT_MAP[mark]
      if (spec !== undefined) {
        if (base === 'i' && spec.dotlessI) {
          return `{${spec.cmd}\\i}`
        }
        return spec.isLetterCmd ? `{${spec.cmd} ${base}}` : `{${spec.cmd}${base}}`
      }
    }
  }

  // Si un carácter especial (p. ej. '{') llegara seguido de una marca combinante suelta,
  // escapar igualmente el carácter base para no romper nunca el equilibrio de llaves.
  const firstChar = Array.from(cluster)[0]
  if (firstChar !== undefined && LATEX_SPECIAL_MAP[firstChar] !== undefined) {
    return LATEX_SPECIAL_MAP[firstChar] + cluster.slice(firstChar.length)
  }

  // Lo que no se pueda asociar a un comando LaTeX estándar (p. ej. múltiples marcas,
  // alfabetos no latinos o letras sin macro OT1) se conserva en UTF-8 (válido con biber).
  return cluster
}

/**
 * Escapa texto CRUDO para BibTeX: caracteres especiales (con llaves siempre equilibradas
 * vía {\textbraceleft}/{\textbraceright}), acentos NFD genéricos, letras sueltas y signos
 * tipográficos. NO es idempotente por diseño: recibe siempre texto crudo sin escapar.
 */
export function escapeBibtex(value: string): string {
  if (value === '') return ''
  const normalized = value.normalize('NFC')
  const clusterRe = /[\s\S]\p{M}*/gu
  let out = ''
  for (const match of normalized.matchAll(clusterRe)) {
    out += escapeCluster(match[0])
  }
  return out
}

/**
 * Conserva un valor literal (doi, url, eprint, isbn, pmid) tal cual si sus llaves están
 * equilibradas; si hay llaves sueltas, sustituye únicamente las desequilibradas por
 * {\textbraceleft} / {\textbraceright}.
 */
export function escapeVerbatim(value: string): string {
  const openStack: number[] = []
  const unmatched = new Set<number>()

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '{') {
      openStack.push(i)
    } else if (ch === '}') {
      if (openStack.length > 0) {
        openStack.pop()
      } else {
        unmatched.add(i)
      }
    }
  }
  for (const idx of openStack) {
    unmatched.add(idx)
  }

  if (unmatched.size === 0) {
    return value
  }

  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i] ?? ''
    if (unmatched.has(i)) {
      out += ch === '{' ? '{\\textbraceleft}' : '{\\textbraceright}'
    } else {
      out += ch
    }
  }
  return out
}

/**
 * Escapa el valor crudo de un campo según su nombre: literal para VERBATIM_FIELDS
 * (doi, url, eprint, isbn, pmid) y escapeBibtex para el resto.
 */
export function escapeFieldValue(fieldName: string, rawValue: string): string {
  if (VERBATIM_FIELDS.has(fieldName.toLowerCase())) {
    return escapeVerbatim(rawValue)
  }
  return escapeBibtex(rawValue)
}

/**
 * Protege siglas en un título crudo envolviéndolas en {...}.
 * Exportada solo para pruebas unitarias: NO debe usarse sobre texto ya escapado
 * (para títulos en producción usar siempre `formatTitle`).
 */
export function protectAcronyms(title: string): string {
  const normalized = title.normalize('NFC')
  const wordOrBracedRe = /\{([\p{L}\p{N}\p{M}]+)\}|([\p{L}\p{N}\p{M}]+)/gu
  return normalized.replace(
    wordOrBracedRe,
    (match, bracedWord: string | undefined, bareWord: string | undefined) => {
      if (bracedWord !== undefined) {
        return match
      }
      if (bareWord !== undefined && isAcronymWord(bareWord)) {
        return `{${bareWord}}`
      }
      return match
    },
  )
}

function isMostlyUppercaseTitle(textSegments: readonly string[]): boolean {
  // Límite de detección de títulos TODO EN MAYÚSCULAS (p. ej. PubMed o algunos Crossref):
  // si hay al menos 2 palabras de ≥2 letras y más del 60 % van íntegramente en mayúsculas,
  // no se protege ninguna sigla para no congelar el título entero.
  // Límites conocidos de la heurística de siglas en v1: 'Vitamin A', 'Type I', 'T cells',
  // 'Wi-Fi', 'R&D', 'C++', "O'Brien" y nombres propios simples ('Einstein') no se protegen.
  const wordRe = /[\p{L}\p{M}]+/gu
  let totalWords = 0
  let upperWords = 0

  for (const segment of textSegments) {
    const normalized = segment.normalize('NFC')
    for (const match of normalized.matchAll(wordRe)) {
      const word = match[0]
      let letterCount = 0
      let allUpper = true
      for (const ch of word) {
        if (/\p{L}/u.test(ch)) {
          letterCount++
          if (!/\p{Lu}/u.test(ch)) {
            allUpper = false
          }
        }
      }
      if (letterCount >= 2) {
        totalWords++
        if (allUpper) {
          upperWords++
        }
      }
    }
  }

  return totalWords >= 2 && upperWords / totalWords > 0.6
}

function formatTitleTextChunk(chunk: string, skipAcronyms: boolean): string {
  const normalized = chunk.normalize('NFC')
  if (skipAcronyms) {
    return escapeBibtex(normalized)
  }

  const tokenRe = /\{([\p{L}\p{N}\p{M}]+)\}|([\p{L}\p{N}\p{M}]+)/gu
  let out = ''
  let lastIndex = 0

  for (const match of normalized.matchAll(tokenRe)) {
    const idx = match.index ?? 0
    if (idx > lastIndex) {
      out += escapeBibtex(normalized.slice(lastIndex, idx))
    }

    const bracedWord = match[1]
    const bareWord = match[2]
    if (bracedWord !== undefined) {
      if (/\p{Lu}/u.test(bracedWord)) {
        out += `{${escapeBibtex(bracedWord)}}`
      } else {
        out += escapeBibtex(match[0])
      }
    } else if (bareWord !== undefined) {
      const escaped = escapeBibtex(bareWord)
      out += isAcronymWord(bareWord) ? `{${escaped}}` : escaped
    }

    lastIndex = idx + match[0].length
  }

  if (lastIndex < normalized.length) {
    out += escapeBibtex(normalized.slice(lastIndex))
  }
  return out
}

/**
 * Formatea un título CRUDO para BibTeX en una sola pasada sin strings intermedios ambiguos:
 * - Conserva verbatim los segmentos matemáticos LaTeX `$...$`.
 * - Escapa cada trozo no matemático con `escapeBibtex` (garantizando llaves equilibradas).
 * - Envuelve siglas en `{...}` y conserva protecciones `{Palabra}` con mayúsculas, salvo
 *   en títulos todo en mayúsculas (>60 % de palabras de ≥2 letras en mayúsculas).
 */
export function formatTitle(raw: string): string {
  if (raw === '') return ''

  const mathRe = /\$[^\s$](?:[^$\n]*[^\s$])?\$/g
  const segments: Array<{ isMath: boolean; text: string }> = []
  let lastIndex = 0

  for (const match of raw.matchAll(mathRe)) {
    const idx = match.index ?? 0
    if (idx > lastIndex) {
      segments.push({ isMath: false, text: raw.slice(lastIndex, idx) })
    }
    segments.push({ isMath: true, text: match[0] })
    lastIndex = idx + match[0].length
  }
  if (lastIndex < raw.length) {
    segments.push({ isMath: false, text: raw.slice(lastIndex) })
  }

  const textSegments = segments.filter((s) => !s.isMath).map((s) => s.text)
  const skipAcronyms = isMostlyUppercaseTitle(textSegments)

  let out = ''
  for (const segment of segments) {
    if (segment.isMath) {
      out += segment.text
    } else {
      out += formatTitleTextChunk(segment.text, skipAcronyms)
    }
  }
  return out
}

function normalizeKeyPart(value: string): string {
  return stripAccents(transliterate(value))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function stripTrailingNameSuffixes(tokens: string[]): { tokens: string[]; hadSuffix: boolean } {
  const result = [...tokens]
  let hadSuffix = false
  while (result.length > 1) {
    const last = result[result.length - 1]
    if (last !== undefined && NAME_SUFFIX_RE.test(last)) {
      result.pop()
      hadSuffix = true
    } else {
      break
    }
  }
  return { tokens: result, hadSuffix }
}

function extractSurnameFromFull(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return 'sinautor'

  let candidate: string
  const commaIdx = trimmed.indexOf(',')
  if (commaIdx !== -1) {
    const beforeComma = trimmed.slice(0, commaIdx).trim()
    const beforeTokens = beforeComma.split(/\s+/).filter(Boolean)
    candidate = stripTrailingNameSuffixes(beforeTokens).tokens.join(' ')
  } else {
    const rawTokens = trimmed.split(/\s+/).filter(Boolean)
    const { tokens, hadSuffix } = stripTrailingNameSuffixes(rawTokens)
    if (tokens.length <= 1) {
      candidate = tokens[0] ?? ''
    } else {
      let start = 0
      for (let i = 0; i < tokens.length - 1; i++) {
        const tok = tokens[i]
        if (tok !== undefined && INITIAL_TOKEN_RE.test(tok)) {
          start = i + 1
        }
      }
      const rest = tokens.slice(start)

      if (rest.length <= 1) {
        candidate = rest[0] ?? ''
      } else {
        const particleIdx = rest.findIndex(
          (token, idx) => idx < rest.length - 1 && SURNAME_PARTICLES.has(token.toLowerCase()),
        )
        if (particleIdx !== -1) {
          candidate = rest.slice(particleIdx).join(' ')
        } else if (start > 0) {
          candidate = rest.join(' ')
        } else if (hadSuffix || rest.length === 2) {
          candidate = rest[rest.length - 1] ?? ''
        } else {
          // Heurística para apellidos compuestos hispanos en nombres completos sin coma.
          // Ambigüedad inherente del formato: "Juan Pablo Pérez" (nombre compuesto + un apellido)
          // no se distingue de "Juan González Cervera" y produce "pabloperez". Cuando la fuente
          // provee el apellido separado, pasar `{ family }` para evitar esta heurística.
          candidate = rest.slice(-2).join(' ')
        }
      }
    }
  }

  // Escrituras no latinas (p. ej. chino, cirílico) quedan vacías tras normalizar a [a-z0-9]:
  // el fallback documentado para la clave es 'sinautor'.
  const normalized = normalizeKeyPart(candidate)
  return normalized === '' ? 'sinautor' : normalized
}

function extractSurname(author: AuthorKeyInput): string {
  if (author.family !== undefined && author.family.trim() !== '') {
    // Si llega el apellido separado, se normaliza tal cual sin aplicar heurísticas.
    // Para escrituras no latinas que queden vacías tras normalizar, fallback 'sinautor'.
    const normalized = normalizeKeyPart(author.family)
    return normalized === '' ? 'sinautor' : normalized
  }
  if (author.full !== undefined && author.full.trim() !== '') {
    return extractSurnameFromFull(author.full)
  }
  return 'sinautor'
}

function extractYear(year: string | null): string {
  if (year === null) return 'sinano'
  const match = year.match(YEAR_RE)
  return match?.[1] ?? 'sinano'
}

function extractTitleWord(title: string): string {
  const normalized = stripAccents(transliterate(title))
    .toLowerCase()
    .replace(/[\u2019\u02BC]/g, "'")

  const tokens = normalized.split(/[^a-z0-9']+/).filter(Boolean)

  for (const rawToken of tokens) {
    const cleaned = rawToken.replace(/^'+|'+$/g, '')
    if (cleaned === '') continue

    let candidate: string
    const apostropheIdx = cleaned.lastIndexOf("'")
    if (apostropheIdx !== -1) {
      // Elisiones y contracciones (l', d', qu', don't): tomar la parte tras el apóstrofe
      // solo si contiene al menos 2 letras; en caso contrario saltar el token.
      const after = cleaned.slice(apostropheIdx + 1)
      const afterLetterCount = after.replace(/[^a-z]/g, '').length
      if (afterLetterCount < 2) continue
      candidate = after
    } else {
      candidate = cleaned
    }

    if (candidate.length < 2) continue
    if (!/[a-z]/.test(candidate)) continue
    if (STOPWORDS.has(candidate)) continue
    return candidate
  }

  // Para títulos vacíos, solo stopwords o escrituras no latinas que queden vacías tras
  // normalizar a [a-z0-9], el fallback documentado es 'sintitulo'.
  return 'sintitulo'
}

/**
 * Construye una clave BibTeX 100 % ASCII (`/^[a-z0-9]+$/`) con forma `apellidoAñoPalabra`.
 * - Si `author.family` viene no vacío, se usa tal cual normalizado (sin heurística).
 * - Si solo viene `author.full`, aplica la heurística de nombre completo.
 * - `title` debe ser el título CRUDO, no escapado con LaTeX.
 */
export function buildKey(author: AuthorKeyInput, year: string | null, title: string): string {
  const surnamePart = extractSurname(author)
  const yearPart = extractYear(year)
  const titlePart = extractTitleWord(title)
  return `${surnamePart}${yearPart}${titlePart}`
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
 * Convención incremental (flujo de importación): la primera aparición queda sin sufijo
 * (`autor2020`), y las colisiones sucesivas reciben sufijo `a`, `b`, `c`, ..., `aa`...
 */
export function makeUniqueKey(base: string, existing: ReadonlySet<string>): string {
  if (!existing.has(base)) return base
  let index = 0
  while (true) {
    const candidate = `${base}${indexToAlphaSuffix(index)}`
    if (!existing.has(candidate)) return candidate
    index++
  }
}

/**
 * Convención de dos pasadas (renumeración del validador, spec punto 10):
 * cuenta primero cuántas veces aparece cada base. Si una base aparece una sola vez
 * queda tal cual; si aparece 2 o más veces, TODAS sus apariciones reciben sufijo `a`, `b`, `c`...
 * evitando colisiones con otras claves (incluidas bases que ya terminan en letra).
 */
export function assignUniqueKeys(bases: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const base of bases) {
    counts.set(base, (counts.get(base) ?? 0) + 1)
  }

  // Reservar primero las bases únicas para que ningún sufijo generado choque con ellas.
  const used = new Set<string>()
  for (const [base, count] of counts) {
    if (count === 1) {
      used.add(base)
    }
  }

  const nextIndex = new Map<string, number>()
  const result: string[] = []

  for (const base of bases) {
    if ((counts.get(base) ?? 0) === 1) {
      result.push(base)
      continue
    }

    let idx = nextIndex.get(base) ?? 0
    while (true) {
      const candidate = `${base}${indexToAlphaSuffix(idx)}`
      idx++
      if (!used.has(candidate)) {
        used.add(candidate)
        nextIndex.set(base, idx)
        result.push(candidate)
        break
      }
    }
  }

  return result
}

export function formatEntry(entry: BibEntry): string {
  if (!VALID_KEY_RE.test(entry.key)) {
    throw new Error(`Clave BibTeX inválida: "${entry.key}"`)
  }

  const normalizedFields = new Map<string, string>()
  for (const [rawName, rawValue] of Object.entries(entry.fields)) {
    const trimmed = rawValue.trim()
    if (trimmed === '') continue
    const lowerName = rawName.toLowerCase()
    if (!normalizedFields.has(lowerName)) {
      normalizedFields.set(lowerName, trimmed)
    }
  }

  const lines: string[] = [`@${entry.type}{${entry.key},`]

  for (const field of CANONICAL_FIELD_ORDER) {
    const value = normalizedFields.get(field.toLowerCase())
    if (value !== undefined) {
      lines.push(`  ${field} = {${value}},`)
    }
  }

  const extraFields = Array.from(normalizedFields.keys())
    .filter((lowerName) => !CANONICAL_FIELD_LOWER_SET.has(lowerName))
    .sort()

  for (const lowerName of extraFields) {
    const value = normalizedFields.get(lowerName)
    if (value !== undefined) {
      lines.push(`  ${lowerName} = {${value}},`)
    }
  }

  lines.push('}')
  return lines.join('\n')
}
