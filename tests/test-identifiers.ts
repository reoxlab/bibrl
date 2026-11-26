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

// Pruebas de detección, normalización y deduplicación de identificadores.
import {
  MAX_IDENTIFIERS,
  dedupeIdentifiers,
  detectIdentifier,
  parseIdentifiers,
} from '../src/identifiers.ts'

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

// --- DOI ---
{
  const r = detectIdentifier('10.1038/nature12373')
  check(
    'DOI simple se detecta y normaliza',
    r.kind === 'doi' && r.normalized === '10.1038/nature12373' && r.error === null && r.line === 0,
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('10.1038/nature12373', 7)
  check(
    'detectIdentifier acepta número de línea explícito',
    r.kind === 'doi' && r.normalized === '10.1038/nature12373' && r.line === 7,
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('doi:10.1145/3292500.3330919')
  check(
    'DOI con prefijo doi: se normaliza sin prefijo',
    r.kind === 'doi' && r.normalized === '10.1145/3292500.3330919',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('DOI: 10.1109/CVPR.2016.90')
  check(
    'DOI con prefijo DOI: y espacio se pasa a minúsculas',
    r.kind === 'doi' && r.normalized === '10.1109/cvpr.2016.90',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('https://doi.org/10.1000/XYZ123')
  check(
    'DOI con URL https://doi.org/ en mayúsculas se normaliza en minúsculas',
    r.kind === 'doi' && r.normalized === '10.1000/xyz123',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('http://dx.doi.org/10.1038/nature12373.')
  check(
    'DOI con URL http://dx.doi.org/ y punto final quita el punto',
    r.kind === 'doi' && r.normalized === '10.1038/nature12373',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('doi.org/10.1038/nature12373')
  check(
    'DOI con URL doi.org/ sin esquema',
    r.kind === 'doi' && r.normalized === '10.1038/nature12373',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('www.doi.org/10.1038/nature12373')
  check(
    'DOI con URL www.doi.org/ sin esquema',
    r.kind === 'doi' && r.normalized === '10.1038/nature12373',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('https://doi.org/10.1038/nature12373?utm_source=test#fig1')
  check(
    'DOI URL elimina query y fragmento',
    r.kind === 'doi' && r.normalized === '10.1038/nature12373',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('10.1000/a%2Fb')
  check(
    'DOI decodifica %2F a /',
    r.kind === 'doi' && r.normalized === '10.1000/a/b',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('10.1000.10/abc')
  check(
    'DOI acepta prefijo con subdivisión (10.1000.10/abc)',
    r.kind === 'doi' && r.normalized === '10.1000.10/abc',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('10.1038/nature12373)')
  check(
    'DOI con paréntesis final no balanceado limpia el paréntesis',
    r.kind === 'doi' && r.normalized === '10.1038/nature12373',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('(doi:10.1038/nature12373)')
  check(
    'DOI envuelto en paréntesis (doi:...) se detecta y limpia',
    r.kind === 'doi' && r.normalized === '10.1038/nature12373',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('\uFEFF10.1038/nature12373\u200B')
  check(
    'DOI con caracteres de ancho cero (U+FEFF y U+200B) en extremos se limpia',
    r.kind === 'doi' && r.normalized === '10.1038/nature12373',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('10.1002/(SICI)1097-026X(199601)12:1<1::AID-CNM924>3.0.CO;2-6')
  check(
    'DOI SICI conserva sus paréntesis internos',
    r.kind === 'doi' &&
      r.normalized === '10.1002/(sici)1097-026x(199601)12:1<1::aid-cnm924>3.0.co;2-6',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('  10.1038/nature12373;  ')
  check(
    'DOI con espacios externos y punto y coma final conserva raw y limpia normalizado',
    r.kind === 'doi' &&
      r.normalized === '10.1038/nature12373' &&
      r.raw === '  10.1038/nature12373;  ',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('10.1038/con espacio')
  check(
    'DOI con espacio en el sufijo se rechaza como unknown',
    r.kind === 'unknown' && r.normalized === null && r.error === 'Formato no reconocido',
    JSON.stringify(r),
  )
}

// --- arXiv ---
{
  const r = detectIdentifier('2301.12345')
  check(
    'arXiv nuevo sin versión',
    r.kind === 'arxiv' && r.normalized === '2301.12345' && r.error === null,
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('2301.12345v2')
  check(
    'arXiv nuevo con versión v2 se normaliza sin versión',
    r.kind === 'arxiv' && r.normalized === '2301.12345',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('0704.0001v1,')
  check(
    'arXiv de 4 dígitos con versión y coma final (límite inferior 0704)',
    r.kind === 'arxiv' && r.normalized === '0704.0001',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('1412.9999')
  check(
    'arXiv de 4 dígitos en límite superior 1412',
    r.kind === 'arxiv' && r.normalized === '1412.9999',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('1501.00001')
  check(
    'arXiv de 5 dígitos en límite inferior 1501',
    r.kind === 'arxiv' && r.normalized === '1501.00001',
    JSON.stringify(r),
  )
}
for (const invalidArxiv of [
  '2313.12345',
  '9912.1234',
  '1412.12345',
  '1501.1234',
  '0703.1234',
  '2300.12345',
  '2301.123',
  '2301.123456',
  'arXiv:2301.12345v',
]) {
  const r = detectIdentifier(invalidArxiv)
  check(
    `arXiv inválido (${invalidArxiv}) devuelve unknown`,
    r.kind === 'unknown' && r.normalized === null,
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('hep-th/9901001')
  check(
    'arXiv antiguo sin versión',
    r.kind === 'arxiv' && r.normalized === 'hep-th/9901001',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('HEP-TH/9901001v3')
  check(
    'arXiv antiguo en mayúsculas con versión se normaliza en minúsculas y sin versión',
    r.kind === 'arxiv' && r.normalized === 'hep-th/9901001',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('math.GT/0309136v1')
  check(
    'arXiv antiguo con subcategoría quita la subclase al normalizar',
    r.kind === 'arxiv' && r.normalized === 'math/0309136',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('https://arxiv.org/abs/2301.12345v2.')
  check(
    'arXiv con URL https://arxiv.org/abs/ y punto final',
    r.kind === 'arxiv' && r.normalized === '2301.12345',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('arxiv.org/abs/2301.12345')
  check(
    'arXiv con URL arxiv.org/abs/ sin esquema',
    r.kind === 'arxiv' && r.normalized === '2301.12345',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('https://export.arxiv.org/abs/2301.12345v2')
  check(
    'arXiv con URL export.arxiv.org/abs/',
    r.kind === 'arxiv' && r.normalized === '2301.12345',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('https://arxiv.org/pdf/2301.12345v2')
  check(
    'arXiv con URL /pdf/ y versión sin extensión .pdf',
    r.kind === 'arxiv' && r.normalized === '2301.12345',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('arxiv.org/pdf/2301.12345.pdf')
  check(
    'arXiv con URL /pdf/ y sufijo .pdf sin esquema',
    r.kind === 'arxiv' && r.normalized === '2301.12345',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('https://arxiv.org/pdf/2301.12345v2.pdf')
  check(
    'arXiv con URL /pdf/, versión y sufijo .pdf',
    r.kind === 'arxiv' && r.normalized === '2301.12345',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('arXiv:hep-th/9901001v2')
  check(
    'arXiv con prefijo arXiv:',
    r.kind === 'arxiv' && r.normalized === 'hep-th/9901001',
    JSON.stringify(r),
  )
}

// --- ISBN ---
{
  const r = detectIdentifier('0-306-40615-2')
  check(
    'ISBN-10 válido con guiones se normaliza a ISBN-13 equivalente',
    r.kind === 'isbn' && r.normalized === '9780306406157' && r.error === null,
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('ISBN0306406152')
  check(
    'ISBN sin separador tras prefijo ISBN (ISBN0306406152)',
    r.kind === 'isbn' && r.normalized === '9780306406157' && r.error === null,
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('ISBN-10:0306406152')
  check(
    'ISBN-10: sin espacio tras los dos puntos',
    r.kind === 'isbn' && r.normalized === '9780306406157',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('ISBN-13:9780306406157')
  check(
    'ISBN-13: sin espacio tras los dos puntos',
    r.kind === 'isbn' && r.normalized === '9780306406157',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('ISBN-13: 978-0-13-110362-7')
  check(
    'ISBN-13 válido con prefijo ISBN-13: y guiones',
    r.kind === 'isbn' && r.normalized === '9780131103627' && r.error === null,
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('978–0–13–110362–7')
  check(
    'ISBN con raya tipográfica U+2013 (–) se normaliza y acepta',
    r.kind === 'isbn' && r.normalized === '9780131103627',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('ISBN\u201013: 978\u20110\u201213\u2013110362\u20147')
  check(
    'ISBN normaliza todos los guiones tipográficos U+2010..U+2014',
    r.kind === 'isbn' && r.normalized === '9780131103627',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('979-10-90636-07-1')
  check(
    'ISBN-13 válido con prefijo 979',
    r.kind === 'isbn' && r.normalized === '9791090636071',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('ISBN 978 3 16 148410 0')
  check(
    'ISBN-13 válido con prefijo ISBN y espacios',
    r.kind === 'isbn' && r.normalized === '9783161484100',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('ISBN-10: 0-8044-2957-x')
  check(
    'ISBN-10 válido con x minúscula se convierte a ISBN-13 equivalente',
    r.kind === 'isbn' && r.normalized === '9780804429573',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('0-306-40615-3')
  check(
    'ISBN-10 con checksum inválido da error específico',
    r.kind === 'unknown' &&
      r.normalized === null &&
      r.error === 'ISBN con dígito de control inválido',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('978-0-13-110362-8')
  check(
    'ISBN-13 con checksum inválido da error específico',
    r.kind === 'unknown' &&
      r.normalized === null &&
      r.error === 'ISBN con dígito de control inválido',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('1234567890128')
  check(
    'EAN-13 con checksum válido pero prefijo distinto de 978/979 da error específico',
    r.kind === 'unknown' &&
      r.normalized === null &&
      r.error === 'El ISBN-13 debe empezar por 978 o 979',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('978-0-13-110362')
  check(
    'ISBN-13 con 12 dígitos da Formato no reconocido',
    r.kind === 'unknown' && r.normalized === null && r.error === 'Formato no reconocido',
    JSON.stringify(r),
  )
}

// --- PMID ---
{
  const r = detectIdentifier('12345678')
  check(
    'PMID simple de 8 dígitos',
    r.kind === 'pmid' && r.normalized === '12345678' && r.error === null,
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('0000012345')
  check(
    'PMID suelto con ceros a la izquierda (10 caracteres, 5 significativos) se normaliza a 12345',
    r.kind === 'pmid' && r.normalized === '12345',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('030640615')
  check(
    'PMID de 9 dígitos con cero inicial (030640615)',
    r.kind === 'pmid' && r.normalized === '30640615',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('2020')
  check(
    'Número suelto de 4 dígitos (2020) es demasiado corto para PMID',
    r.kind === 'unknown' &&
      r.normalized === null &&
      r.error === 'Número demasiado corto para ser PMID',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('0004215')
  check(
    'Número suelto con menos de 5 dígitos significativos tras quitar ceros es demasiado corto para PMID',
    r.kind === 'unknown' &&
      r.normalized === null &&
      r.error === 'Número demasiado corto para ser PMID',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('PMID 12345678')
  check(
    'PMID con prefijo PMID y espacio',
    r.kind === 'pmid' && r.normalized === '12345678',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('pmid:12345678')
  check(
    'PMID con prefijo pmid: sin espacio',
    r.kind === 'pmid' && r.normalized === '12345678',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('PMID: 00042')
  check(
    'PMID con prefijo acepta menos de 5 dígitos significativos',
    r.kind === 'pmid' && r.normalized === '42',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('PMID: 1234567890')
  check(
    'PMID con prefijo y más de 9 dígitos devuelve unknown',
    r.kind === 'unknown' && r.normalized === null,
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('https://pubmed.ncbi.nlm.nih.gov/31452104/')
  check(
    'PMID con URL PubMed https con barra final',
    r.kind === 'pmid' && r.normalized === '31452104',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('http://pubmed.ncbi.nlm.nih.gov/31452104')
  check(
    'PMID con URL PubMed http sin barra final',
    r.kind === 'pmid' && r.normalized === '31452104',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('https://pubmed.ncbi.nlm.nih.gov/0031452104/.')
  check(
    'PMID con URL PubMed, ceros iniciales y punto final',
    r.kind === 'pmid' && r.normalized === '31452104',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('https://pubmed.ncbi.nlm.nih.gov/?term=crispr')
  check(
    'URL de búsqueda PubMed con ?term= devuelve unknown',
    r.kind === 'unknown' && r.normalized === null,
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('000')
  check(
    'PMID todo ceros se rechaza como unknown',
    r.kind === 'unknown' && r.normalized === null && r.error === 'Formato no reconocido',
    JSON.stringify(r),
  )
}
{
  const r = detectIdentifier('0000000000')
  check(
    'Número de 10 ceros se rechaza como unknown',
    r.kind === 'unknown' && r.normalized === null && r.error === 'Formato no reconocido',
    JSON.stringify(r),
  )
}

// --- Unknown ---
{
  const r = detectIdentifier('esto no es un identificador')
  check(
    'Línea desconocida devuelve unknown y Formato no reconocido',
    r.kind === 'unknown' && r.normalized === null && r.error === 'Formato no reconocido',
    JSON.stringify(r),
  )
}

// --- parseIdentifiers: líneas vacías, partición \r y límite de 50 ---
{
  const input = [
    '',
    '  10.1038/nature12373  ',
    '   ',
    '2301.12345v2',
    '',
    '12345678',
  ].join('\n')
  const res = parseIdentifiers(input)
  check(
    'Líneas vacías se ignoran y se conservan números de línea físicos 1-based',
    res.items.length === 3 &&
      res.ignoredExtra === 0 &&
      res.items[0]?.line === 2 &&
      res.items[0]?.raw === '  10.1038/nature12373  ' &&
      res.items[1]?.line === 4 &&
      res.items[2]?.line === 6,
    JSON.stringify(res),
  )
}
{
  const input = '10.1038/nature12373\r2301.12345\r\n12345678'
  const res = parseIdentifiers(input)
  check(
    'parseIdentifiers parte líneas con \\r suelto, \\r\\n y \\n',
    res.items.length === 3 &&
      res.items[0]?.line === 1 &&
      res.items[1]?.line === 2 &&
      res.items[2]?.line === 3,
    JSON.stringify(res),
  )
}
{
  const lines: string[] = []
  for (let i = 1; i <= 55; i++) {
    lines.push(String(10000 + i))
    if (i === 10 || i === 52) {
      lines.push('   ')
    }
  }
  const res = parseIdentifiers(lines.join('\r\n'))
  check(
    'Más de 50 identificadores respeta MAX_IDENTIFIERS y cuenta ignoredExtra sin contar vacías',
    res.items.length === MAX_IDENTIFIERS &&
      MAX_IDENTIFIERS === 50 &&
      res.ignoredExtra === 5 &&
      res.items[0]?.line === 1 &&
      res.items[49]?.line === 51,
    JSON.stringify({ len: res.items.length, ignoredExtra: res.ignoredExtra, last: res.items[49] }),
  )
}

// --- dedupeIdentifiers ---
{
  const input = [
    '10.1038/NATURE12373',
    'https://doi.org/10.1038/nature12373',
    '2301.12345v1',
    '2301.12345',
    '2301.12345v3',
    'no reconocido',
    'no reconocido',
    '0-306-40615-3',
    '0-306-40615-3',
  ].join('\n')
  const { items } = parseIdentifiers(input)
  const { unique, duplicates } = dedupeIdentifiers(items)

  check(
    'Dedup de DOI con distinta capitalización/URL conserva primera aparición',
    unique[0]?.line === 1 &&
      unique[0]?.normalized === '10.1038/nature12373' &&
      duplicates.some((d) => d.line === 2 && d.firstLine === 1),
    JSON.stringify({ unique, duplicates }),
  )
  check(
    'Dedup de arXiv con y sin versión registra todas las repeticiones apuntando a firstLine',
    unique[1]?.line === 3 &&
      unique[1]?.normalized === '2301.12345' &&
      duplicates.some((d) => d.line === 4 && d.firstLine === 3) &&
      duplicates.some((d) => d.line === 5 && d.firstLine === 3),
    JSON.stringify({ unique, duplicates }),
  )
  check(
    'Los unknown nunca se consideran duplicados (ni con texto idéntico ni con ISBN malo)',
    unique.length === 6 &&
      duplicates.length === 3 &&
      unique.filter((u) => u.kind === 'unknown').length === 4,
    JSON.stringify({ uniqueCount: unique.length, dupCount: duplicates.length }),
  )
}
{
  const { items } = parseIdentifiers(['math.GT/0309136', 'math/0309136'].join('\n'))
  const { unique, duplicates } = dedupeIdentifiers(items)
  check(
    'math.GT/0309136 y math/0309136 deduplican a la misma clave math/0309136',
    unique.length === 1 &&
      unique[0]?.normalized === 'math/0309136' &&
      duplicates.length === 1 &&
      duplicates[0]?.line === 2 &&
      duplicates[0]?.firstLine === 1,
    JSON.stringify({ unique, duplicates }),
  )
}
{
  const { items } = parseIdentifiers(['0306406152', '9780306406157'].join('\n'))
  const { unique, duplicates } = dedupeIdentifiers(items)
  check(
    'ISBN-10 0306406152 e ISBN-13 9780306406157 deduplican entre sí',
    unique.length === 1 &&
      unique[0]?.normalized === '9780306406157' &&
      duplicates.length === 1 &&
      duplicates[0]?.line === 2 &&
      duplicates[0]?.firstLine === 1,
    JSON.stringify({ unique, duplicates }),
  )
}
{
  const { items } = parseIdentifiers(
    ['10.48550/arXiv.2301.12345', '2301.12345v2', 'arXiv:2301.12345'].join('\n'),
  )
  const { unique, duplicates } = dedupeIdentifiers(items)
  check(
    'DOI de arXiv 10.48550/arXiv.<id> deduplica con ID arXiv y conserva kind doi',
    unique.length === 1 &&
      unique[0]?.kind === 'doi' &&
      unique[0]?.normalized === '10.48550/arxiv.2301.12345' &&
      duplicates.length === 2 &&
      duplicates[0]?.line === 2 &&
      duplicates[0]?.firstLine === 1 &&
      duplicates[1]?.line === 3 &&
      duplicates[1]?.firstLine === 1,
    JSON.stringify({ unique, duplicates }),
  )
}
{
  const { items } = parseIdentifiers(
    ['math/0309136', 'https://doi.org/10.48550/arXiv.math.GT/0309136v1'].join('\n'),
  )
  const { unique, duplicates } = dedupeIdentifiers(items)
  check(
    'ID arXiv antiguo y su DOI 10.48550/arXiv con subclase/versión deduplican entre sí',
    unique.length === 1 &&
      unique[0]?.kind === 'arxiv' &&
      duplicates.length === 1 &&
      duplicates[0]?.line === 2 &&
      duplicates[0]?.firstLine === 1,
    JSON.stringify({ unique, duplicates }),
  )
}

if (failed > 0) process.exit(1)
console.log(`\nidentifiers: ${passed} comprobaciones pasaron.`)
