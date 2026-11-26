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

// Flujo de importación: parseo, deduplicación, consulta en lotes con concurrencia acotada y claves únicas.

import { type BibEntry, formatEntry, makeUniqueKey } from './bibtex.ts'
import type { FetchResult } from './fetchers.ts'
import {
  type DuplicateInfo,
  type ParsedIdentifier,
  dedupeIdentifiers,
  parseIdentifiers,
} from './identifiers.ts'

export interface ImportFailure {
  line: number
  raw: string
  kind: string
  reason: string
}

export interface ImportReport {
  entries: BibEntry[] // en el orden pegado, claves ya únicas
  failures: ImportFailure[] // líneas que no generaron entrada, en orden
  duplicates: DuplicateInfo[] // de dedupeIdentifiers
  ignoredExtra: number
  totalLines: number // líneas no vacías procesadas (sin contar el extra ignorado)
}

export interface ProcessOptions {
  onParsed?: (parsed: {
    items: ParsedIdentifier[]
    duplicates: DuplicateInfo[]
    ignoredExtra: number
  }) => void
  onItemResult?: (item: ParsedIdentifier, result: FetchResult) => void
}

const MAX_CONCURRENCY = 4
const FALLBACK_UNKNOWN_ERROR = 'Formato no reconocido'
const FALLBACK_FETCH_ERROR = 'Error inesperado al consultar la fuente'

async function safeFetchOne(
  item: ParsedIdentifier,
  fetchOne: (id: ParsedIdentifier) => Promise<FetchResult>,
): Promise<FetchResult> {
  try {
    return await fetchOne(item)
  } catch (err) {
    const message = err instanceof Error && err.message.trim() !== '' ? err.message : FALLBACK_FETCH_ERROR
    return { ok: false, kind: 'network', error: message }
  }
}

export async function processIdentifiers(
  text: string,
  fetchOne: (id: ParsedIdentifier) => Promise<FetchResult>,
  options?: ProcessOptions,
): Promise<ImportReport> {
  const { items, ignoredExtra } = parseIdentifiers(text)
  const { unique, duplicates } = dedupeIdentifiers(items)

  options?.onParsed?.({ items, duplicates, ignoredExtra })

  const fetchable: Array<{ uniqueIdx: number; item: ParsedIdentifier }> = []
  for (let i = 0; i < unique.length; i++) {
    const item = unique[i]
    if (item !== undefined && item.kind !== 'unknown' && item.normalized !== null) {
      fetchable.push({ uniqueIdx: i, item })
    }
  }

  const resultsByUniqueIdx = new Map<number, FetchResult>()

  // Lotes de hasta MAX_CONCURRENCY peticiones en paralelo, ejecutados en orden.
  for (let start = 0; start < fetchable.length; start += MAX_CONCURRENCY) {
    const batch = fetchable.slice(start, start + MAX_CONCURRENCY)
    await Promise.all(
      batch.map(async ({ uniqueIdx, item }) => {
        const result = await safeFetchOne(item, fetchOne)
        resultsByUniqueIdx.set(uniqueIdx, result)
        options?.onItemResult?.(item, result)
      }),
    )
  }

  const entries: BibEntry[] = []
  const failures: ImportFailure[] = []

  // Reservar primero todas las claves base presentes en las entradas resueltas del lote
  // para que ningún sufijo de colisión desplace la primera aparición (ni una base única)
  // de otra entrada posterior (p. ej. [smith2020deep, smith2020deep, smith2020deepa]).
  const usedKeys = new Set<string>()
  for (let i = 0; i < unique.length; i++) {
    const result = resultsByUniqueIdx.get(i)
    if (result?.ok) {
      usedKeys.add(result.entry.key)
    }
  }
  const emittedBases = new Set<string>()

  // Ensamblar entradas y fallos en el orden original pegado para garantizar
  // determinismo tanto en el orden de salida como en los sufijos de claves únicas.
  for (let i = 0; i < unique.length; i++) {
    const item = unique[i]
    if (item === undefined) continue

    if (item.kind === 'unknown' || item.normalized === null) {
      failures.push({
        line: item.line,
        raw: item.raw,
        kind: 'unknown',
        reason: item.error ?? FALLBACK_UNKNOWN_ERROR,
      })
      continue
    }

    const result = resultsByUniqueIdx.get(i)
    if (result === undefined) {
      failures.push({
        line: item.line,
        raw: item.raw,
        kind: item.kind,
        reason: FALLBACK_FETCH_ERROR,
      })
      continue
    }

    if (result.ok) {
      const baseKey = result.entry.key
      let uniqueKey: string
      if (!emittedBases.has(baseKey)) {
        emittedBases.add(baseKey)
        uniqueKey = baseKey
      } else {
        uniqueKey = makeUniqueKey(baseKey, usedKeys)
        usedKeys.add(uniqueKey)
      }
      entries.push({ ...result.entry, key: uniqueKey })
    } else {
      failures.push({
        line: item.line,
        raw: item.raw,
        kind: item.kind,
        reason: result.error,
      })
    }
  }

  return {
    entries,
    failures,
    duplicates,
    ignoredExtra,
    totalLines: items.length,
  }
}

export function buildBibText(entries: readonly BibEntry[]): string {
  if (entries.length === 0) return ''
  return entries.map((entry) => formatEntry(entry)).join('\n\n')
}
