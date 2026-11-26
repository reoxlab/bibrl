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

// Pruebas unitarias del flujo de importación (src/importFlow.ts).

import { type BibEntry, formatEntry } from '../src/bibtex.ts'
import type { FetchResult } from '../src/fetchers.ts'
import { type ParsedIdentifier, detectIdentifier } from '../src/identifiers.ts'
import { buildBibText, processIdentifiers } from '../src/importFlow.ts'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    passed++
    console.log(`ok ${passed + failed} - ${name}`)
  } else {
    failed++
    console.log(`FAIL ${passed + failed} - ${name} ${extra}`)
  }
}

function makeEntry(
  key: string,
  sourceKind: BibEntry['sourceKind'],
  sourceId: string,
  title = 'Sample Title',
): BibEntry {
  return {
    type: 'article',
    key,
    fields: {
      author: 'Doe, Jane',
      title,
      year: '2024',
    },
    sourceKind,
    sourceId,
    reviewable: false,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runTests(): Promise<void> {
  // 1. Todo éxito: 2 identificadores, claves únicas, orden preservado
  {
    const called: string[] = []
    const text = '10.1038/nature12373\n1706.03762'
    const report = await processIdentifiers(text, async (id: ParsedIdentifier): Promise<FetchResult> => {
      called.push(`${id.kind}:${id.normalized}`)
      if (id.kind === 'doi') {
        return { ok: true, entry: makeEntry('nature2013paper', 'doi', id.normalized ?? '') }
      }
      return { ok: true, entry: makeEntry('vaswani2017attention', 'arxiv', id.normalized ?? '') }
    })

    check('todo éxito: devuelve 2 entradas', report.entries.length === 2)
    check(
      'todo éxito: orden preservado y claves correctas',
      report.entries[0]?.key === 'nature2013paper' &&
        report.entries[1]?.key === 'vaswani2017attention',
      `claves: ${report.entries.map((e) => e.key).join(', ')}`,
    )
    check('todo éxito: 0 fallos', report.failures.length === 0)
    check('todo éxito: 0 duplicados', report.duplicates.length === 0)
    check('todo éxito: ignoredExtra es 0', report.ignoredExtra === 0)
    check('todo éxito: totalLines es 2', report.totalLines === 2)
    check(
      'todo éxito: llamó a fetchOne para ambos identificadores en orden',
      called[0] === 'doi:10.1038/nature12373' && called[1] === 'arxiv:1706.03762',
    )
  }

  // 2. Un fallo de fetch + un unknown (failures con línea y motivo correctos; fetch NUNCA llamado para unknown)
  {
    const calledKinds: string[] = []
    const text = [
      'no-es-un-identificador',
      '10.1000/noexiste',
      '1706.03762',
      '9780262035614', // ISBN con dígito de control inválido -> unknown
    ].join('\n')

    const report = await processIdentifiers(text, async (id): Promise<FetchResult> => {
      calledKinds.push(id.kind)
      if (id.kind === 'doi') {
        return { ok: false, kind: 'not-found', error: 'No encontrado en la fuente' }
      }
      return { ok: true, entry: makeEntry('vaswani2017attention', 'arxiv', id.normalized ?? '') }
    })

    check(
      'fallo + unknown: fetchOne NUNCA se llama para líneas unknown',
      !calledKinds.includes('unknown') && calledKinds.length === 2,
      `llamadas: ${calledKinds.join(', ')}`,
    )
    check('fallo + unknown: genera 1 entrada válida', report.entries.length === 1)
    check('fallo + unknown: registra 3 fallos en orden de línea', report.failures.length === 3)
    check(
      'fallo + unknown: línea 1 (unknown) con kind y motivo correctos',
      report.failures[0]?.line === 1 &&
        report.failures[0]?.raw === 'no-es-un-identificador' &&
        report.failures[0]?.kind === 'unknown' &&
        report.failures[0]?.reason === 'Formato no reconocido',
      JSON.stringify(report.failures[0]),
    )
    check(
      'fallo + unknown: línea 2 (fetch fallido) con kind y motivo correctos',
      report.failures[1]?.line === 2 &&
        report.failures[1]?.raw === '10.1000/noexiste' &&
        report.failures[1]?.kind === 'doi' &&
        report.failures[1]?.reason === 'No encontrado en la fuente',
      JSON.stringify(report.failures[1]),
    )
    check(
      'fallo + unknown: línea 4 (ISBN inválido -> unknown) con su error específico',
      report.failures[2]?.line === 4 &&
        report.failures[2]?.kind === 'unknown' &&
        report.failures[2]?.reason === 'ISBN con dígito de control inválido',
      JSON.stringify(report.failures[2]),
    )
    check('fallo + unknown: totalLines es 4', report.totalLines === 4)
  }

  // 3. Duplicado: segunda línea en duplicates, una sola entrada y una sola llamada a fetch
  {
    let fetchCount = 0
    const text = '10.1038/nature12373\nhttps://doi.org/10.1038/NATURE12373'
    const report = await processIdentifiers(text, async (id): Promise<FetchResult> => {
      fetchCount++
      return { ok: true, entry: makeEntry('nature2013paper', 'doi', id.normalized ?? '') }
    })

    check('duplicado: fetchOne solo se llama una vez', fetchCount === 1, `llamadas: ${fetchCount}`)
    check('duplicado: solo genera una entrada', report.entries.length === 1)
    check('duplicado: 0 fallos', report.failures.length === 0)
    check(
      'duplicado: segunda línea registrada en duplicates apuntando a línea 1',
      report.duplicates.length === 1 &&
        report.duplicates[0]?.line === 2 &&
        report.duplicates[0]?.firstLine === 1 &&
        report.duplicates[0]?.raw === 'https://doi.org/10.1038/NATURE12373',
      JSON.stringify(report.duplicates),
    )
    check('duplicado: totalLines incluye ambas líneas no vacías (2)', report.totalLines === 2)
  }

  // 4. Claves que colisionan entre dos (y tres) entradas distintas -> sufijos a, b
  {
    const text = ['10.1000/uno', '10.1000/dos', '10.1000/tres'].join('\n')
    const report = await processIdentifiers(text, async (id): Promise<FetchResult> => {
      return { ok: true, entry: makeEntry('smith2020deep', 'doi', id.normalized ?? '') }
    })

    check('colisión de claves: 3 entradas generadas', report.entries.length === 3)
    check(
      'colisión de claves: primera sin sufijo, segunda con a, tercera con b',
      report.entries[0]?.key === 'smith2020deep' &&
        report.entries[1]?.key === 'smith2020deepa' &&
        report.entries[2]?.key === 'smith2020deepb',
      `claves: ${report.entries.map((e) => e.key).join(', ')}`,
    )
  }

  // 5. Más de 50 líneas: procesa 50 e informa ignoredExtra
  {
    const lines: string[] = []
    for (let i = 1; i <= 55; i++) {
      lines.push(`10.1000/item${i}`)
    }
    let fetchCount = 0
    const report = await processIdentifiers(lines.join('\n'), async (id): Promise<FetchResult> => {
      fetchCount++
      return { ok: true, entry: makeEntry(`key${fetchCount}`, 'doi', id.normalized ?? '') }
    })

    check('límite 50: totalLines es 50', report.totalLines === 50, `totalLines: ${report.totalLines}`)
    check('límite 50: ignoredExtra es 5', report.ignoredExtra === 5, `ignoredExtra: ${report.ignoredExtra}`)
    check('límite 50: solo se llama a fetchOne 50 veces', fetchCount === 50, `fetchCount: ${fetchCount}`)
    check('límite 50: devuelve 50 entradas', report.entries.length === 50)
  }

  // 6. buildBibText con 0, 1 y 2 entradas (separador \n\n exacto)
  {
    const e1 = makeEntry('uno2020first', 'doi', '10.1000/1', 'First Title')
    const e2 = makeEntry('dos2021second', 'arxiv', '2101.00001', 'Second Title')

    check('buildBibText(0 entradas) devuelve cadena vacía', buildBibText([]) === '')
    check(
      'buildBibText(1 entrada) coincide con formatEntry',
      buildBibText([e1]) === formatEntry(e1),
    )
    check(
      'buildBibText(2 entradas) une con exactamente \\n\\n',
      buildBibText([e1, e2]) === `${formatEntry(e1)}\n\n${formatEntry(e2)}`,
    )
  }

  // 7. La concurrencia acotada (máx 4, lotes en orden) no altera el orden ni las claves
  {
    const lines = [
      '10.1000/a0',
      '10.1000/a1',
      '10.1000/a2',
      '10.1000/a3',
      '10.1000/a4',
      '10.1000/a5',
    ]
    // Retardos inversos dentro de cada lote para forzar resolución desordenada.
    const delaysById: Record<string, number> = {
      '10.1000/a0': 45,
      '10.1000/a1': 30,
      '10.1000/a2': 15,
      '10.1000/a3': 5,
      '10.1000/a4': 30,
      '10.1000/a5': 5,
    }

    let inFlight = 0
    let maxInFlight = 0
    const startOrder: string[] = []
    let batch1CompletedBeforeBatch2 = true
    let batch1Resolved = 0

    const report = await processIdentifiers(lines.join('\n'), async (id): Promise<FetchResult> => {
      const norm = id.normalized ?? ''
      if (norm === '10.1000/a4' || norm === '10.1000/a5') {
        if (batch1Resolved < 4) batch1CompletedBeforeBatch2 = false
      }
      startOrder.push(norm)
      inFlight++
      if (inFlight > maxInFlight) maxInFlight = inFlight
      await delay(delaysById[norm] ?? 0)
      inFlight--
      if (
        norm === '10.1000/a0' ||
        norm === '10.1000/a1' ||
        norm === '10.1000/a2' ||
        norm === '10.1000/a3'
      ) {
        batch1Resolved++
      }
      return {
        ok: true,
        entry: makeEntry(`k${norm.slice(-1)}`, 'doi', norm),
      }
    })

    check(
      'concurrencia: máximo en vuelo es exactamente 4',
      maxInFlight === 4,
      `maxInFlight: ${maxInFlight}`,
    )
    check(
      'concurrencia: el segundo lote espera a que termine el primero',
      batch1CompletedBeforeBatch2,
    )
    check(
      'concurrencia: el orden de entradas se mantiene igual al pegado pese a retardos inversos',
      report.entries.map((e) => e.key).join(',') === 'k0,k1,k2,k3,k4,k5',
      `orden: ${report.entries.map((e) => e.key).join(',')}`,
    )
    check(
      'concurrencia: los inicios respetan el orden de lotes',
      startOrder.join(',') === lines.join(','),
      `inicios: ${startOrder.join(',')}`,
    )
  }

  // 8. Entrada vacía y solo líneas en blanco
  {
    let called = 0
    const report = await processIdentifiers('   \n\n  \t \n', async () => {
      called++
      return { ok: false, kind: 'not-found', error: 'No' }
    })

    check('entrada vacía: totalLines 0, entries 0, failures 0, sin llamadas a fetch',
      report.totalLines === 0 &&
        report.entries.length === 0 &&
        report.failures.length === 0 &&
        report.duplicates.length === 0 &&
        called === 0,
    )
  }

  // 9. Callbacks de progreso onParsed y onItemResult
  {
    let parsedCount = 0
    const resolvedLines: number[] = []
    await processIdentifiers(
      '10.1038/nature12373\n1706.03762',
      async (id): Promise<FetchResult> => {
        if (id.kind === 'doi') await delay(20)
        return { ok: true, entry: makeEntry(`k${id.line}`, id.kind === 'doi' ? 'doi' : 'arxiv', id.normalized ?? '') }
      },
      {
        onParsed: ({ items }) => {
          parsedCount = items.length
        },
        onItemResult: (item) => {
          resolvedLines.push(item.line)
        },
      },
    )

    check('callbacks: onParsed recibe las 2 líneas', parsedCount === 2)
    check(
      'callbacks: onItemResult se invoca conforme se resuelve cada elemento (línea 2 antes que 1)',
      resolvedLines.length === 2 && resolvedLines[0] === 2 && resolvedLines[1] === 1,
      `resolvedLines: ${resolvedLines.join(',')}`,
    )
  }

  // 10. Verificación de formato de los 4 identificadores del botón «Pegar ejemplo»
  {
    const doi = detectIdentifier('10.1038/nature12373', 1)
    const arxiv = detectIdentifier('1706.03762', 2)
    const isbn = detectIdentifier('9780262035613', 3)
    const pmid = detectIdentifier('31283921', 4)

    check(
      'identificadores de ejemplo válidos: DOI, arXiv, ISBN y PMID',
      doi.kind === 'doi' &&
        arxiv.kind === 'arxiv' &&
        isbn.kind === 'isbn' &&
        pmid.kind === 'pmid',
      `${doi.kind}, ${arxiv.kind}, ${isbn.kind}, ${pmid.kind}`,
    )
  }

  // 11. Colisión con clave ya sufijada en ambas direcciones
  {
    const cases: Array<[string, string, string]> = [
      ['smith2020deepa', 'smith2020deep', 'smith2020deep'],
      ['smith2020deep', 'smith2020deep', 'smith2020deepa'],
    ]

    for (const keys of cases) {
      const [first = '', second = '', third = ''] = keys
      const keysByNorm: Record<string, string> = {
        '10.1000/uno': first,
        '10.1000/dos': second,
        '10.1000/tres': third,
      }
      const text = ['10.1000/uno', '10.1000/dos', '10.1000/tres'].join('\n')
      const report = await processIdentifiers(text, async (id): Promise<FetchResult> => {
        return {
          ok: true,
          entry: makeEntry(keysByNorm[id.normalized ?? ''] ?? '', 'doi', id.normalized ?? ''),
        }
      })

      const resultKeys = report.entries.map((e) => e.key)
      const bibKeys = Array.from(buildBibText(report.entries).matchAll(/^@\w+\{([^,]+),/gm), (m) =>
        m[1] ?? '',
      )
      check(
        `colisión con clave sufijada [${keys.join(', ')}]: las 3 claves son únicas`,
        report.entries.length === 3 && new Set(resultKeys).size === 3,
        `claves: ${resultKeys.join(', ')}`,
      )
      check(
        `colisión con clave sufijada [${keys.join(', ')}]: sin colisión en el .bib generado`,
        bibKeys.length === 3 && new Set(bibKeys).size === 3,
        `claves .bib: ${bibKeys.join(', ')}`,
      )
    }
  }

  // 12. Colisión de claves con retardos inversos: la base queda en la primera línea
  {
    const resolvedOrder: string[] = []
    const text = ['10.1000/uno', '10.1000/dos'].join('\n')
    const report = await processIdentifiers(text, async (id): Promise<FetchResult> => {
      const norm = id.normalized ?? ''
      await delay(norm === '10.1000/uno' ? 40 : 5)
      resolvedOrder.push(norm)
      return { ok: true, entry: makeEntry('smith2020deep', 'doi', norm) }
    })

    check(
      'colisión con retardos inversos: la línea 2 se resuelve antes que la 1',
      resolvedOrder.join(',') === '10.1000/dos,10.1000/uno',
      `orden: ${resolvedOrder.join(',')}`,
    )
    check(
      'colisión con retardos inversos: línea 1 conserva la base y línea 2 recibe el sufijo a',
      report.entries[0]?.key === 'smith2020deep' && report.entries[1]?.key === 'smith2020deepa',
      `claves: ${report.entries.map((e) => e.key).join(', ')}`,
    )
  }

  // 13. fetchOne que rechaza (Error con mensaje, Error vacío y valor no-Error) no aborta el lote
  {
    const text = [
      '10.1000/ok1',
      '10.1000/fallo1',
      '10.1000/fallo2',
      '10.1000/fallo3',
      '10.1000/ok2',
    ].join('\n')
    const report = await processIdentifiers(text, async (id): Promise<FetchResult> => {
      const norm = id.normalized ?? ''
      if (norm === '10.1000/fallo1') throw new Error('Fallo abrupto')
      if (norm === '10.1000/fallo2') throw new Error('')
      if (norm === '10.1000/fallo3') throw 'valor no-Error'
      return { ok: true, entry: makeEntry(`k${norm.slice(-1)}`, 'doi', norm) }
    })

    check(
      'rechazos: el lote continúa y genera las entradas válidas',
      report.entries.length === 2 && report.entries[0]?.key === 'k1' && report.entries[1]?.key === 'k2',
      `claves: ${report.entries.map((e) => e.key).join(', ')}`,
    )
    check(
      'rechazos: registra los 3 fallos en las líneas 2, 3 y 4',
      report.failures.length === 3 &&
        report.failures[0]?.line === 2 &&
        report.failures[1]?.line === 3 &&
        report.failures[2]?.line === 4,
      JSON.stringify(report.failures),
    )
    check(
      'rechazos: motivos correctos, con fallback para Error vacío y valor no-Error',
      report.failures[0]?.reason === 'Fallo abrupto' &&
        report.failures[1]?.reason === 'Error inesperado al consultar la fuente' &&
        report.failures[2]?.reason === 'Error inesperado al consultar la fuente',
      JSON.stringify(report.failures),
    )
  }

  // 14. Fallos asíncronos desordenados + unknown intercalados -> failures en orden de línea
  {
    const text = [
      '10.1000/fallo1',
      'no-es-un-identificador',
      '10.1000/fallo3',
    ].join('\n')
    const report = await processIdentifiers(text, async (id): Promise<FetchResult> => {
      if (id.normalized === '10.1000/fallo1') {
        await delay(40)
        throw new Error('Fallo 1')
      }
      if (id.normalized === '10.1000/fallo3') {
        await delay(5)
        throw new Error('Fallo 3')
      }
      return { ok: true, entry: makeEntry('x', 'doi', id.normalized ?? '') }
    })

    check(
      'fallos desordenados: report.failures queda en orden de línea [1, 2, 3]',
      report.failures.map((f) => f.line).join(',') === '1,2,3',
      `líneas: ${report.failures.map((f) => f.line).join(',')}`,
    )
  }

  // 15. 55 identificadores con líneas en blanco intercaladas: límite y números de línea reales
  {
    const inputLines: string[] = []
    for (let i = 1; i <= 55; i++) {
      let raw: string
      if (i === 5) {
        raw = 'no-es-un-identificador'
      } else if (i === 10) {
        raw = '10.1000/item9' // duplicado de la línea original 17
      } else if (i === 20) {
        raw = '10.1000/fallo20'
      } else {
        raw = `10.1000/item${i}`
      }
      inputLines.push(raw)
      inputLines.push('') // línea en blanco intercalada
    }

    const parsedLines: number[] = []
    const resolvedLines: number[] = []
    const report = await processIdentifiers(
      inputLines.join('\n'),
      async (id): Promise<FetchResult> => {
        if (id.normalized === '10.1000/fallo20') throw new Error('Fuente caída')
        resolvedLines.push(id.line)
        return { ok: true, entry: makeEntry(`keyLine${id.line}`, 'doi', id.normalized ?? '') }
      },
      {
        onParsed: ({ items }) => {
          for (const item of items) parsedLines.push(item.line)
        },
      },
    )

    check('55 con blancos: totalLines es 50', report.totalLines === 50, `totalLines: ${report.totalLines}`)
    check('55 con blancos: ignoredExtra es 5', report.ignoredExtra === 5, `ignoredExtra: ${report.ignoredExtra}`)
    check(
      '55 con blancos: los items conservan las líneas reales 1, 3, 5, …, 99',
      parsedLines.length === 50 && parsedLines.every((line, idx) => line === idx * 2 + 1),
      `líneas: ${parsedLines.slice(0, 5).join(',')}…`,
    )
    check(
      '55 con blancos: failure unknown en la línea real 9',
      report.failures[0]?.line === 9 && report.failures[0]?.kind === 'unknown',
      JSON.stringify(report.failures[0]),
    )
    check(
      '55 con blancos: failure de fetch en la línea real 39',
      report.failures[1]?.line === 39 && report.failures[1]?.reason === 'Fuente caída',
      JSON.stringify(report.failures[1]),
    )
    check(
      '55 con blancos: duplicate en la línea real 19 apuntando a la 17',
      report.duplicates.length === 1 &&
        report.duplicates[0]?.line === 19 &&
        report.duplicates[0]?.firstLine === 17,
      JSON.stringify(report.duplicates),
    )

    const expectedEntryLines: number[] = []
    for (let i = 1; i <= 50; i++) {
      if (i === 5 || i === 10 || i === 20) continue
      expectedEntryLines.push(i * 2 - 1)
    }
    check(
      '55 con blancos: las entries corresponden a las líneas reales resueltas',
      report.entries.map((e) => e.key).join(',') ===
        expectedEntryLines.map((line) => `keyLine${line}`).join(','),
      `claves: ${report.entries.map((e) => e.key).join(',')}`,
    )
    check(
      '55 con blancos: fetchOne solo recibe líneas reales dentro de las primeras 50',
      resolvedLines.join(',') === expectedEntryLines.join(','),
      `líneas resueltas: ${resolvedLines.join(',')}`,
    )
  }

  // 16. DOI de arXiv y su ID arXiv: una sola consulta y un duplicado
  {
    let fetchCount = 0
    const text = ['1706.03762', '10.48550/arXiv.1706.03762'].join('\n')
    const report = await processIdentifiers(text, async (id): Promise<FetchResult> => {
      fetchCount++
      return { ok: true, entry: makeEntry('vaswani2017attention', 'arxiv', id.normalized ?? '') }
    })

    check('arXiv + DOI de arXiv: fetchOne se llama una sola vez', fetchCount === 1, `llamadas: ${fetchCount}`)
    check(
      'arXiv + DOI de arXiv: 1 entrada y 1 duplicado',
      report.entries.length === 1 && report.duplicates.length === 1,
      `entradas: ${report.entries.length}, duplicados: ${report.duplicates.length}`,
    )
  }

  if (failed > 0) process.exit(1)
  console.log(`\nimportFlow: ${passed} comprobaciones pasaron.`)
}

runTests().catch((err) => {
  console.error(err)
  process.exit(1)
})
