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

// Pruebas de búsqueda y mapeo de metadatos (Crossref, arXiv, OpenLibrary, Europe PMC).
import { type FetchFn, type FetchOptions, fetchMetadata, parseArxivAtom } from '../src/fetchers.ts'
import type { ParsedIdentifier } from '../src/identifiers.ts'

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

function makeId(
  kind: ParsedIdentifier['kind'],
  normalized: string | null,
  raw = normalized ?? 'invalido',
): ParsedIdentifier {
  return {
    line: 1,
    raw,
    kind,
    normalized,
    error: kind === 'unknown' ? 'Formato no reconocido' : null,
  }
}

function jsonFetchMock(
  body: unknown,
  status = 200,
  onCall?: (url: string, init?: RequestInit) => void,
): FetchFn {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    onCall?.(String(input), init)
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

function textFetchMock(
  body: string,
  status = 200,
  onCall?: (url: string, init?: RequestInit) => void,
): FetchFn {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    onCall?.(String(input), init)
    return new Response(body, { status })
  }
}

async function runTests(): Promise<void> {
  // =========================================================================
  // Crossref (DOI)
  // =========================================================================

  // 1. Mapeo completo de un journal-article realista + clave concreta lecun2015deep
  {
    let capturedUrl = ''
    let capturedAccept = ''
    const mock = jsonFetchMock(
      {
        status: 'ok',
        message: {
          type: 'journal-article',
          DOI: '10.1038/nature14539',
          URL: 'https://doi.org/10.1038/nature14539',
          title: ['Deep learning'],
          'container-title': ['Nature'],
          author: [
            { family: 'LeCun', given: 'Yann' },
            { family: 'Bengio', given: 'Yoshua' },
            { family: 'Hinton', given: 'Geoffrey' },
          ],
          volume: '521',
          issue: '7553',
          page: '436–444',
          publisher: 'Springer Science & Business Media',
          'published-print': { 'date-parts': [[2015, 5, 28]] },
        },
      },
      200,
      (url, init) => {
        capturedUrl = url
        capturedAccept = new Headers(init?.headers).get('Accept') ?? ''
      },
    )

    const res = await fetchMetadata(makeId('doi', '10.1038/nature14539'), mock)
    check(
      'Crossref usa URL codificada con mailto y cabecera Accept: application/json',
      capturedUrl ===
        'https://api.crossref.org/works/10.1038%2Fnature14539?mailto=contacto@reoxlab.com' &&
        capturedAccept === 'application/json',
      `url=${capturedUrl} accept=${capturedAccept}`,
    )
    check('Crossref journal-article devuelve ok=true', res.ok)
    if (res.ok) {
      const { entry } = res
      check(
        'Crossref journal-article asigna tipo article y reviewable=false',
        entry.type === 'article' && entry.reviewable === false,
      )
      check('Crossref genera clave concreta lecun2015deep', entry.key === 'lecun2015deep', `got: ${entry.key}`)
      check(
        'Crossref formatea autores como Apellido, Nombre unidos con and',
        entry.fields.author === 'LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey',
        `got: ${entry.fields.author}`,
      )
      check(
        'Crossref mapea journal, volume, number, pages (raya normalizada), publisher, year, doi y url',
        entry.fields.journal === 'Nature' &&
          entry.fields.volume === '521' &&
          entry.fields.number === '7553' &&
          entry.fields.pages === '436-444' &&
          entry.fields.publisher === 'Springer Science \\& Business Media' &&
          entry.fields.year === '2015' &&
          entry.fields.doi === '10.1038/nature14539' &&
          entry.fields.url === 'https://doi.org/10.1038/nature14539',
        JSON.stringify(entry.fields),
      )
      check(
        'Crossref incluye sourceKind=doi y sourceId normalizado',
        entry.sourceKind === 'doi' && entry.sourceId === '10.1038/nature14539',
      )
    }
  }

  // 2. Crossref proceedings-article → inproceedings con booktitle
  {
    const mock = jsonFetchMock({
      message: {
        type: 'proceedings-article',
        DOI: '10.1145/1234567.1234568',
        title: ['Scaling GPU Training'],
        'container-title': ['Proceedings of the ACM Symposium'],
        author: [{ family: 'García Peña', given: 'Ana' }],
        page: '12-20',
        'published-online': { 'date-parts': [[2022, 7, 1]] },
      },
    })
    const res = await fetchMetadata(makeId('doi', '10.1145/1234567.1234568'), mock)
    check(
      'Crossref proceedings-article mapea a inproceedings con booktitle (sin journal) y reviewable=false',
      res.ok &&
        res.entry.type === 'inproceedings' &&
        res.entry.reviewable === false &&
        res.entry.fields.booktitle === 'Proceedings of the ACM Symposium' &&
        res.entry.fields.journal === undefined &&
        res.entry.fields.year === '2022' &&
        res.entry.fields.title === 'Scaling {GPU} Training' &&
        res.entry.key === 'garciapena2022scaling',
      res.ok ? JSON.stringify(res.entry) : res.error,
    )
  }

  // 3. Crossref posted-content → misc reviewable + autor institucional (name) + fecha en created
  {
    const mock = jsonFetchMock({
      message: {
        type: 'posted-content',
        DOI: '10.1101/2023.01.01.522400',
        title: ['Preprint on mRNA Stability'],
        author: [{ name: 'Open Bio Consortium' }],
        created: { 'date-parts': [[2023, 1, 2]] },
      },
    })
    const res = await fetchMetadata(makeId('doi', '10.1101/2023.01.01.522400'), mock)
    check(
      'Crossref posted-content mapea a misc con reviewable=true y usa author.name como full',
      res.ok &&
        res.entry.type === 'misc' &&
        res.entry.reviewable === true &&
        res.entry.fields.author === 'Open Bio Consortium' &&
        res.entry.fields.year === '2023' &&
        res.entry.key === 'bioconsortium2023preprint',
      res.ok ? JSON.stringify(res.entry) : res.error,
    )
  }

  // 4. Crossref otros tipos (book, book-chapter, book-part, book-section, reference-entry,
  //    monograph, edited-book, reference-book, proceedings, dissertation, report, report-component,
  //    dataset, desconocido)
  {
    const typeCases: Array<[string, string, boolean]> = [
      ['book', 'book', false],
      ['monograph', 'book', false],
      ['edited-book', 'book', false],
      ['reference-book', 'book', false],
      ['book-chapter', 'incollection', false],
      ['book-part', 'incollection', false],
      ['book-section', 'incollection', false],
      ['reference-entry', 'incollection', false],
      ['proceedings', 'proceedings', false],
      ['dissertation', 'phdthesis', true],
      ['report', 'techreport', true], // sin institution ni publisher → reviewable=true
      ['report-component', 'techreport', true], // sin institution ni publisher → reviewable=true
      ['dataset', 'misc', true],
      ['peer-review', 'misc', true],
    ]
    for (const [crossrefType, expectedBibType, expectedReviewable] of typeCases) {
      const mock = jsonFetchMock({
        message: {
          type: crossrefType,
          DOI: '10.1000/test',
          title: ['Sample Work'],
          'container-title': ['Handbook of Tests'],
        },
      })
      const res = await fetchMetadata(makeId('doi', '10.1000/test'), mock)
      const booktitleOk =
        expectedBibType === 'incollection'
          ? res.ok && res.entry.fields.booktitle === 'Handbook of Tests'
          : res.ok && res.entry.fields.booktitle === undefined
      check(
        `Crossref ${crossrefType} → ${expectedBibType} (reviewable=${expectedReviewable})`,
        res.ok &&
          res.entry.type === expectedBibType &&
          res.entry.reviewable === expectedReviewable &&
          booktitleOk,
        res.ok ? JSON.stringify(res.entry) : res.error,
      )
    }
  }

  // 5. Crossref título con <i>, <scp>, <sub>, <mml:math> y entidades HTML
  {
    const mock = jsonFetchMock({
      message: {
        type: 'journal-article',
        DOI: '10.1000/html',
        title: [
          'Effects of <i>Drosophila</i> CO<sub>2</sub> &amp; <scp>NASA</scp> <mml:math><mml:mi>x</mml:mi></mml:math> when pH < 7.2 and T > 30',
        ],
        author: [{ literal: 'Ada Lovelace' }],
      },
    })
    const res = await fetchMetadata(makeId('doi', '10.1000/html'), mock)
    check(
      'Crossref limpia <i>, <sub>, <scp> y <mml:math> conservando texto, desigualdades y entidades',
      res.ok &&
        res.entry.fields.title ===
          'Effects of Drosophila {CO2} \\& {NASA} x when {pH} < 7.2 and T > 30' &&
        res.entry.fields.year === undefined &&
        res.entry.key === 'lovelacesinanoeffects',
      res.ok ? `${res.entry.fields.title} | key=${res.entry.key}` : res.error,
    )
  }

  // 6. Crossref 404 → not-found
  {
    const mock = textFetchMock('Resource not found.', 404)
    const res = await fetchMetadata(makeId('doi', '10.1000/inexistente'), mock)
    check(
      'Crossref HTTP 404 devuelve kind=not-found y mensaje esperado',
      !res.ok && res.kind === 'not-found' && res.error === 'No encontrado en la fuente',
      JSON.stringify(res),
    )
  }

  // 7. Crossref HTTP 503 → bad-response
  {
    const mock = textFetchMock('Service Unavailable', 503)
    const res = await fetchMetadata(makeId('doi', '10.1000/caido'), mock)
    check(
      'Crossref HTTP 503 devuelve kind=bad-response con código HTTP',
      !res.ok &&
        res.kind === 'bad-response' &&
        res.error === 'La fuente devolvió un error (HTTP 503)',
      JSON.stringify(res),
    )
  }

  // 8. Crossref JSON sin message.title → bad-response
  {
    const mock = jsonFetchMock({ message: { type: 'journal-article', DOI: '10.1000/notitle' } })
    const res = await fetchMetadata(makeId('doi', '10.1000/notitle'), mock)
    check(
      'Crossref JSON sin message.title devuelve kind=bad-response',
      !res.ok && res.kind === 'bad-response' && res.error === 'Respuesta inesperada de la fuente',
      JSON.stringify(res),
    )
  }

  // 9. Crossref JSON inválido → bad-response
  {
    const mock = textFetchMock('{json roto', 200)
    const res = await fetchMetadata(makeId('doi', '10.1000/maljson'), mock)
    check(
      'Crossref con JSON malformado devuelve kind=bad-response',
      !res.ok && res.kind === 'bad-response' && res.error === 'Respuesta inesperada de la fuente',
      JSON.stringify(res),
    )
  }

  // T6. stripHtml: desigualdades científicas sin espacio, bloques $...$, CDATA, comentarios y entidades inválidas
  {
    const mockInequality = jsonFetchMock({
      message: {
        type: 'journal-article',
        DOI: '10.1000/ineq',
        title: ['Regime k<n and m>d when $x<y + z>0$'],
      },
    })
    const resIneq = await fetchMetadata(makeId('doi', '10.1000/ineq'), mockInequality)
    check(
      'T6: stripHtml conserva intacto título con desigualdades y bloque matemático $...$',
      resIneq.ok && resIneq.entry.fields.title === 'Regime k<n and m>d when $x<y + z>0$',
      resIneq.ok ? resIneq.entry.fields.title : resIneq.error,
    )

    const mockCdata = jsonFetchMock({
      message: {
        type: 'journal-article',
        DOI: '10.1000/cdata',
        title: ['<![CDATA[Fast GPU Kernel]]> <!-- comentario -->'],
      },
    })
    const resCdata = await fetchMetadata(makeId('doi', '10.1000/cdata'), mockCdata)
    check(
      'T6: stripHtml desenvuelve CDATA y quita comentarios antes de formatTitle',
      resCdata.ok && resCdata.entry.fields.title === 'Fast {GPU} Kernel',
      resCdata.ok ? resCdata.entry.fields.title : resCdata.error,
    )

    const mockInvalidNum = jsonFetchMock({
      message: {
        type: 'journal-article',
        DOI: '10.1000/num',
        title: ['Check &#0; and &#xD800; and &#x03B1;'],
      },
    })
    const resNum = await fetchMetadata(makeId('doi', '10.1000/num'), mockInvalidNum)
    const numTitle = resNum.ok ? (resNum.entry.fields.title ?? '') : ''
    check(
      'T6: decodeEntities rechaza &#0; y sustitutos UTF-16 (0xD800) y decodifica válidos',
      resNum.ok &&
        !/[\u0000\uD800-\uDFFF]/.test(numTitle) &&
        numTitle.includes('\\&\\#0;') &&
        numTitle.includes('\\&\\#{xD800};') &&
        numTitle.includes('α'),
      resNum.ok ? numTitle : resNum.error,
    )
  }

  // T7. Crossref con entidades HTML con nombre en título y publisher (respetando mayúsculas)
  {
    const mock = jsonFetchMock({
      message: {
        type: 'journal-article',
        DOI: '10.1000/entities',
        title: ['Alzheimer&rsquo;s disease: 2010&ndash;2020'],
        publisher: 'John Wiley &amp; Sons',
      },
    })
    const res = await fetchMetadata(makeId('doi', '10.1000/entities'), mock)
    check(
      'T7: Crossref decodifica &rsquo;, &ndash; en título y &amp; en publisher',
      res.ok &&
        res.entry.fields.title === "Alzheimer's disease: 2010--2020" &&
        res.entry.fields.publisher === 'John Wiley \\& Sons',
      res.ok ? JSON.stringify(res.entry.fields) : res.error,
    )

    const mockCase = jsonFetchMock({
      message: {
        type: 'journal-article',
        DOI: '10.1000/case-entities',
        title: ['&Alpha; vs &alpha;, &Prime; vs &prime;, &Dagger; vs &dagger;'],
      },
    })
    const resCase = await fetchMetadata(makeId('doi', '10.1000/case-entities'), mockCase)
    check(
      'T7: decodeEntities distingue mayúsculas en entidades (&Alpha;/&alpha;, &Prime;/&prime;, &Dagger;/&dagger;)',
      resCase.ok && resCase.entry.fields.title === 'Α vs α, ″ vs ′, ‡ vs †',
      resCase.ok ? resCase.entry.fields.title : resCase.error,
    )
  }

  // T8. Crossref journal-article sin container-title, sin autores y sin fechas + article-number
  {
    const mock = jsonFetchMock({
      message: {
        type: 'journal-article',
        DOI: '10.1000/minimal',
        title: ['Standalone Article'],
        'article-number': 'e012345',
      },
    })
    const res = await fetchMetadata(makeId('doi', '10.1000/minimal'), mock)
    check(
      'T8: journal-article sin container-title, autores ni fechas produce entrada válida, clave ASCII y usa article-number',
      res.ok &&
        res.entry.type === 'article' &&
        res.entry.fields.journal === undefined &&
        res.entry.fields.author === undefined &&
        res.entry.fields.year === undefined &&
        res.entry.fields.pages === 'e012345' &&
        /^[a-z0-9]+$/.test(res.entry.key) &&
        res.entry.key === 'sinautorsinanostandalone',
      res.ok ? JSON.stringify(res.entry) : res.error,
    )
  }

  // T9. Crossref monograph con issued 1995 y created 2024 → book, year 1995 + date-time fallback
  {
    const mock = jsonFetchMock({
      message: {
        type: 'monograph',
        DOI: '10.1000/monograph',
        title: ['Classic Theory'],
        issued: { 'date-parts': [[1995]] },
        created: { 'date-parts': [[2024, 2, 10]] },
      },
    })
    const res = await fetchMetadata(makeId('doi', '10.1000/monograph'), mock)
    check(
      'T9: Crossref monograph prioriza issued (1995) sobre created (2024) y mapea a book',
      res.ok &&
        res.entry.type === 'book' &&
        res.entry.reviewable === false &&
        res.entry.fields.year === '1995',
      res.ok ? JSON.stringify(res.entry) : res.error,
    )

    const mockDateTime = jsonFetchMock({
      message: {
        type: 'posted-content',
        DOI: '10.1000/posted',
        title: ['Working Paper'],
        posted: { 'date-parts': [[null]], 'date-time': '2021-06-15T00:00:00Z' },
        created: { 'date-parts': [[2024, 1, 1]] },
      },
    })
    const resDt = await fetchMetadata(makeId('doi', '10.1000/posted'), mockDateTime)
    check(
      'T9: Crossref usa date-time como respaldo dentro del mismo campo de fecha antes de caer a created',
      resDt.ok && resDt.entry.fields.year === '2021',
      resDt.ok ? JSON.stringify(resDt.entry) : resDt.error,
    )
  }

  // T10. Crossref dissertation→school, report→institution, edited-book sin author con editor
  {
    const mockDiss = jsonFetchMock({
      message: {
        type: 'dissertation',
        DOI: '10.1000/diss',
        title: ['Doctoral Thesis'],
        author: [{ family: 'Turing', given: 'Alan' }],
        institution: [{ name: 'Princeton University' }],
        issued: { 'date-parts': [[1938]] },
      },
    })
    const resDiss = await fetchMetadata(makeId('doi', '10.1000/diss'), mockDiss)
    check(
      'T10: Crossref dissertation rellena school desde institution[0].name',
      resDiss.ok &&
        resDiss.entry.type === 'phdthesis' &&
        resDiss.entry.fields.school === 'Princeton University',
      resDiss.ok ? JSON.stringify(resDiss.entry) : resDiss.error,
    )

    const mockReport = jsonFetchMock({
      message: {
        type: 'report',
        DOI: '10.1000/rep',
        title: ['Technical Note'],
        institution: [{ name: 'CERN &amp; Partners' }],
        issued: { 'date-parts': [[2020]] },
      },
    })
    const resRep = await fetchMetadata(makeId('doi', '10.1000/rep'), mockReport)
    check(
      'T10: Crossref report con institution rellena institution y reviewable=false',
      resRep.ok &&
        resRep.entry.type === 'techreport' &&
        resRep.entry.reviewable === false &&
        resRep.entry.fields.institution === 'CERN \\& Partners',
      resRep.ok ? JSON.stringify(resRep.entry) : resRep.error,
    )

    const mockEdited = jsonFetchMock({
      message: {
        type: 'edited-book',
        DOI: '10.1000/edited',
        title: ['Pattern Recognition'],
        editor: [
          { family: 'Bishop', given: 'Christopher' },
          { family: 'Jordan', given: 'Michael' },
        ],
        issued: { 'date-parts': [[2006]] },
      },
    })
    const resEdited = await fetchMetadata(makeId('doi', '10.1000/edited'), mockEdited)
    check(
      'T10: Crossref edited-book sin author mapea editor y genera clave desde el primer editor',
      resEdited.ok &&
        resEdited.entry.type === 'book' &&
        resEdited.entry.fields.author === undefined &&
        resEdited.entry.fields.editor === 'Bishop, Christopher and Jordan, Michael' &&
        resEdited.entry.key === 'bishop2006pattern',
      resEdited.ok ? JSON.stringify(resEdited.entry) : resEdited.error,
    )
  }

  // =========================================================================
  // arXiv (Atom XML)
  // =========================================================================

  // 10. arXiv XML con 2 autores, published, primary_category, doi, comment y journal_ref
  {
    let capturedUrl = ''
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2301.12345v2</id>
    <published>2023-01-29T18:00:00Z</published>
    <title>Quantum Field Theory in
      Curved Spacetime</title>
    <author><name>Elena Martínez</name></author>
    <author><name>John Doe</name></author>
    <arxiv:doi>10.1103/PhysRevD.107.034021</arxiv:doi>
    <arxiv:comment>24 pages, 5 figures</arxiv:comment>
    <arxiv:journal_ref>Phys. Rev. D 107, 034021 (2023)</arxiv:journal_ref>
    <arxiv:primary_category term="hep-th" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`
    const mock = textFetchMock(xml, 200, (url) => {
      capturedUrl = url
    })
    const res = await fetchMetadata(makeId('arxiv', '2301.12345'), mock)
    check(
      'arXiv consulta export.arxiv.org/api/query?id_list=<id>',
      capturedUrl === 'https://export.arxiv.org/api/query?id_list=2301.12345',
      `url=${capturedUrl}`,
    )
    check(
      'arXiv con journal_ref mapea a article con journal aproximado hasta la primera coma y reviewable=true',
      res.ok &&
        res.entry.type === 'article' &&
        res.entry.reviewable === true &&
        res.entry.fields.journal === 'Phys. Rev. D 107' &&
        res.entry.fields.author === "Elena Mart{\\'\\i}nez and John Doe" &&
        res.entry.fields.year === '2023' &&
        res.entry.fields.note === '24 pages, 5 figures' &&
        res.entry.fields.doi === '10.1103/PhysRevD.107.034021' &&
        res.entry.fields.eprint === '2301.12345' &&
        res.entry.fields.archivePrefix === 'arXiv' &&
        res.entry.fields.primaryClass === 'hep-th' &&
        res.entry.sourceKind === 'arxiv' &&
        res.entry.sourceId === '2301.12345' &&
        res.entry.key === 'martinez2023quantum',
      res.ok ? JSON.stringify(res.entry) : res.error,
    )
  }

  // 11. arXiv XML sin journal_ref → misc (reviewable=false) y soporte de ID antiguo con barra
  {
    let capturedUrl = ''
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/hep-th/9901001v1</id>
    <published>1999-01-04T00:00:00Z</published>
    <title>Strings &amp; Branes</title>
    <author><name>Edward Witten</name></author>
    <arxiv:primary_category term='hep-th'/>
  </entry>
</feed>`
    const mock = textFetchMock(xml, 200, (url) => {
      capturedUrl = url
    })
    const res = await fetchMetadata(makeId('arxiv', 'hep-th/9901001'), mock)
    check(
      'arXiv conserva la barra en IDs antiguos (hep-th/9901001)',
      capturedUrl === 'https://export.arxiv.org/api/query?id_list=hep-th/9901001',
      `url=${capturedUrl}`,
    )
    check(
      'arXiv sin journal_ref mapea a misc (reviewable=false) sin campo journal',
      res.ok &&
        res.entry.type === 'misc' &&
        res.entry.reviewable === false &&
        res.entry.fields.journal === undefined &&
        res.entry.fields.title === 'Strings \\& Branes' &&
        res.entry.fields.eprint === 'hep-th/9901001' &&
        res.entry.fields.primaryClass === 'hep-th' &&
        res.entry.key === 'witten1999strings',
      res.ok ? JSON.stringify(res.entry) : res.error,
    )
  }

  // 12. arXiv XML sin <entry> → not-found
  {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query</title>
</feed>`
    const res = await fetchMetadata(makeId('arxiv', '2301.99999'), textFetchMock(xml))
    check(
      'arXiv sin <entry> devuelve kind=not-found',
      !res.ok && res.kind === 'not-found' && res.error === 'No encontrado en la fuente',
      JSON.stringify(res),
    )
  }

  // 13. arXiv XML con CDATA en el título (y prueba directa de parseArxivAtom)
  {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <published>2024-03-10T10:00:00Z</published>
    <title><![CDATA[Efficient   LaTeX & $x < y$
      Parsing]]></title>
    <author><name><![CDATA[Ada Lovelace]]></name></author>
    <arxiv:primary_category term="cs.CL"/>
  </entry>
</feed>`
    const parsed = parseArxivAtom(xml)
    check(
      'parseArxivAtom extrae título y autor envueltos en CDATA limpiando saltos de línea',
      parsed.length === 1 &&
        parsed[0]?.title === 'Efficient LaTeX & $x < y$ Parsing' &&
        parsed[0]?.authors[0] === 'Ada Lovelace',
      JSON.stringify(parsed),
    )
    const res = await fetchMetadata(makeId('arxiv', '2403.00001'), textFetchMock(xml))
    check(
      'arXiv con CDATA formatea título protegiendo LaTeX, escapando & y conservando $x < y$',
      res.ok && res.entry.fields.title === 'Efficient {LaTeX} \\& $x < y$ Parsing',
      res.ok ? res.entry.fields.title : res.error,
    )
  }

  // 14. arXiv respuesta no-Atom → bad-response
  {
    const res = await fetchMetadata(
      makeId('arxiv', '2301.12345'),
      textFetchMock('<html><body>Error inesperado</body></html>'),
    )
    check(
      'arXiv con respuesta que no es feed Atom devuelve kind=bad-response',
      !res.ok && res.kind === 'bad-response' && res.error === 'Respuesta inesperada de la fuente',
      JSON.stringify(res),
    )
  }

  // T3. arXiv <entry> vacío → not-found; <entry> con id arxiv.org/api/errors#... → not-found
  {
    const emptyEntryXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>   </entry>
</feed>`
    const parsedEmpty = parseArxivAtom(emptyEntryXml)
    const resEmpty = await fetchMetadata(makeId('arxiv', '2301.00000'), textFetchMock(emptyEntryXml))
    check(
      'T3: arXiv <entry> vacío expone id=null y devuelve kind=not-found',
      parsedEmpty.length === 1 &&
        parsedEmpty[0]?.id === null &&
        !resEmpty.ok &&
        resEmpty.kind === 'not-found' &&
        resEmpty.error === 'No encontrado en la fuente',
      `parsed=${JSON.stringify(parsedEmpty)} res=${JSON.stringify(resEmpty)}`,
    )

    const apiErrorXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/api/errors#incorrect_id_format</id>
    <title>Error</title>
    <summary>incorrect id format</summary>
  </entry>
</feed>`
    const parsedErr = parseArxivAtom(apiErrorXml)
    const resErr = await fetchMetadata(makeId('arxiv', '2301.00000'), textFetchMock(apiErrorXml))
    check(
      'T3: arXiv <entry> con id arxiv.org/api/errors#incorrect_id_format devuelve kind=not-found',
      parsedErr[0]?.id === 'http://arxiv.org/api/errors#incorrect_id_format' &&
        parsedErr[0]?.isError === true &&
        !resErr.ok &&
        resErr.kind === 'not-found' &&
        resErr.error === 'No encontrado en la fuente',
      `parsed=${JSON.stringify(parsedErr)} res=${JSON.stringify(resErr)}`,
    )
  }

  // T4. arXiv con <arxiv:affiliation>, varios <link title="pdf"/>, <arxiv:comment/> autocerrado y prefijo atom:
  {
    const complexXml = `<?xml version="1.0" encoding="UTF-8"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <atom:entry/>
  <atom:entry>
    <atom:id>http://arxiv.org/abs/2305.00001v1</atom:id>
    <atom:published>2023-05-01T00:00:00Z</atom:published>
    <atom:link href="http://arxiv.org/abs/2305.00001v1" rel="alternate" type="text/html"/>
    <atom:link title="pdf" href="http://arxiv.org/pdf/2305.00001v1" rel="related" type="application/pdf"/>
    <atom:link title="doi" href="http://dx.doi.org/10.1000/xyz" rel="related"/>
    <atom:title>Galactic Halos</atom:title>
    <atom:author>
      <atom:name>G. G. Kacprzak</atom:name>
      <arxiv:affiliation>NMSU</arxiv:affiliation>
    </atom:author>
    <arxiv:comment/>
    <arxiv:primary_category term="astro-ph.GA"/>
  </atom:entry>
</atom:feed>`
    const parsed = parseArxivAtom(complexXml)
    const res = await fetchMetadata(makeId('arxiv', '2305.00001'), textFetchMock(complexXml))
    check(
      'T4: parseArxivAtom ignora <atom:entry/> y <arxiv:comment/> autocerrados, soporta prefijo atom:, affiliation y <link title="pdf"/>',
      parsed.length === 1 &&
        parsed[0]?.id === 'http://arxiv.org/abs/2305.00001v1' &&
        parsed[0]?.title === 'Galactic Halos' &&
        parsed[0]?.authors.length === 1 &&
        parsed[0]?.authors[0] === 'G. G. Kacprzak' &&
        parsed[0]?.comment === null &&
        parsed[0]?.primaryCategory === 'astro-ph.GA' &&
        res.ok &&
        res.entry.fields.title === 'Galactic Halos' &&
        res.entry.fields.author === 'G. G. Kacprzak' &&
        res.entry.fields.note === undefined,
      `parsed=${JSON.stringify(parsed)} res=${JSON.stringify(res)}`,
    )
  }

  // T5. arXiv journal_ref sin coma y journal_ref empezando por coma
  {
    const noCommaXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2301.11111v1</id>
    <published>2023-01-01T00:00:00Z</published>
    <title>Amplitudes</title>
    <author><name>Jane Roe</name></author>
    <arxiv:journal_ref>JHEP 05 (2023) 123</arxiv:journal_ref>
  </entry>
</feed>`
    const resNoComma = await fetchMetadata(makeId('arxiv', '2301.11111'), textFetchMock(noCommaXml))
    check(
      'T5: arXiv journal_ref sin coma mapea a article con ese journal y reviewable=true',
      resNoComma.ok &&
        resNoComma.entry.type === 'article' &&
        resNoComma.entry.reviewable === true &&
        resNoComma.entry.fields.journal === 'JHEP 05 (2023) 123',
      resNoComma.ok ? JSON.stringify(resNoComma.entry) : resNoComma.error,
    )

    const leadingCommaXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2301.22222v1</id>
    <published>2023-01-01T00:00:00Z</published>
    <title>Leading Comma</title>
    <author><name>Jane Roe</name></author>
    <arxiv:journal_ref>, 2023</arxiv:journal_ref>
  </entry>
</feed>`
    const resComma = await fetchMetadata(makeId('arxiv', '2301.22222'), textFetchMock(leadingCommaXml))
    check(
      'T5: arXiv journal_ref que empieza por coma NO genera @article sin journal',
      resComma.ok &&
        resComma.entry.type === 'misc' &&
        resComma.entry.reviewable === false &&
        resComma.entry.fields.journal === undefined,
      resComma.ok ? JSON.stringify(resComma.entry) : resComma.error,
    )
  }

  // Proxy same-origin de arXiv: base por defecto en Node y opción arxivBase configurable
  {
    const minimalAtom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You Need</title>
    <author><name>Ashish Vaswani</name></author>
  </entry>
</feed>`

    let nodeUrl = ''
    await fetchMetadata(
      makeId('arxiv', '1706.03762'),
      textFetchMock(minimalAtom, 200, (url) => {
        nodeUrl = url
      }),
    )
    check(
      'arXiv en entorno Node usa por defecto https://export.arxiv.org/api/query?id_list=',
      nodeUrl.startsWith('https://export.arxiv.org/api/query?id_list=') &&
        nodeUrl === 'https://export.arxiv.org/api/query?id_list=1706.03762',
      `url=${nodeUrl}`,
    )

    let proxyUrl = ''
    const proxyOptions: FetchOptions = { arxivBase: 'api/arxiv' }
    const resProxy = await fetchMetadata(
      makeId('arxiv', '1706.03762'),
      textFetchMock(minimalAtom, 200, (url) => {
        proxyUrl = url
      }),
      proxyOptions,
    )
    check(
      'arXiv con options.arxivBase="api/arxiv" construye api/arxiv/query?id_list=<id>',
      resProxy.ok && proxyUrl === 'api/arxiv/query?id_list=1706.03762',
      `url=${proxyUrl}`,
    )

    let proxyLegacyUrl = ''
    await fetchMetadata(
      makeId('arxiv', 'hep-th/9901001'),
      textFetchMock(minimalAtom, 200, (url) => {
        proxyLegacyUrl = url
      }),
      { arxivBase: 'api/arxiv/' },
    )
    check(
      'arXiv con arxivBase y ID antiguo conserva la barra y evita doble barra en la base',
      proxyLegacyUrl === 'api/arxiv/query?id_list=hep-th/9901001',
      `url=${proxyLegacyUrl}`,
    )
  }

  // =========================================================================
  // OpenLibrary (ISBN)
  // =========================================================================

  // 15. OpenLibrary libro con subtitle, 2 autores, publisher y publish_date c1999
  {
    let capturedUrl = ''
    const mock = jsonFetchMock(
      {
        'ISBN:9780201616224': {
          title: 'The Pragmatic Programmer',
          subtitle: 'From Journeyman to Master',
          authors: [{ name: 'Andrew Hunt' }, { name: 'David Thomas' }],
          publishers: [{ name: 'Addison-Wesley' }],
          publish_date: 'c1999',
        },
      },
      200,
      (url) => {
        capturedUrl = url
      },
    )
    const res = await fetchMetadata(makeId('isbn', '9780201616224'), mock)
    check(
      'OpenLibrary consulta bibkeys=ISBN:<isbn13>&format=json&jscmd=data',
      capturedUrl ===
        'https://openlibrary.org/api/books?bibkeys=ISBN:9780201616224&format=json&jscmd=data',
      `url=${capturedUrl}`,
    )
    check(
      'OpenLibrary mapea book con subtitle, 2 autores, publisher, publish_date c1999→1999 e isbn',
      res.ok &&
        res.entry.type === 'book' &&
        res.entry.reviewable === false &&
        res.entry.fields.title === 'The Pragmatic Programmer: From Journeyman to Master' &&
        res.entry.fields.author === 'Andrew Hunt and David Thomas' &&
        res.entry.fields.publisher === 'Addison-Wesley' &&
        res.entry.fields.year === '1999' &&
        res.entry.fields.isbn === '9780201616224' &&
        res.entry.sourceKind === 'isbn' &&
        res.entry.sourceId === '9780201616224' &&
        res.entry.key === 'hunt1999pragmatic',
      res.ok ? JSON.stringify(res.entry) : res.error,
    )
  }

  // 16. OpenLibrary clave ausente → not-found
  {
    const res = await fetchMetadata(makeId('isbn', '9780000000002'), jsonFetchMock({}))
    check(
      'OpenLibrary con objeto vacío / clave ausente devuelve kind=not-found',
      !res.ok && res.kind === 'not-found' && res.error === 'No encontrado en la fuente',
      JSON.stringify(res),
    )
  }

  // 17. OpenLibrary libro sin título → bad-response
  {
    const res = await fetchMetadata(
      makeId('isbn', '9780201616224'),
      jsonFetchMock({ 'ISBN:9780201616224': { publishers: [{ name: 'Editorial' }] } }),
    )
    check(
      'OpenLibrary sin campo title devuelve kind=bad-response',
      !res.ok && res.kind === 'bad-response' && res.error === 'Respuesta inesperada de la fuente',
      JSON.stringify(res),
    )
  }

  // T11. OpenLibrary sin autores ni publish_date → ok sin author/year; libro vacío {} → not-found
  {
    const resNoAuthors = await fetchMetadata(
      makeId('isbn', '9780201616224'),
      jsonFetchMock({ 'ISBN:9780201616224': { title: 'Anonymous Manual' } }),
    )
    check(
      'T11: OpenLibrary sin autores ni publish_date devuelve ok sin author/year y clave ASCII válida',
      resNoAuthors.ok &&
        resNoAuthors.entry.type === 'book' &&
        resNoAuthors.entry.fields.author === undefined &&
        resNoAuthors.entry.fields.year === undefined &&
        resNoAuthors.entry.fields.publisher === undefined &&
        resNoAuthors.entry.key === 'sinautorsinanoanonymous',
      resNoAuthors.ok ? JSON.stringify(resNoAuthors.entry) : resNoAuthors.error,
    )

    const resEmptyBook = await fetchMetadata(
      makeId('isbn', '9780201616224'),
      jsonFetchMock({ 'ISBN:9780201616224': {} }),
    )
    check(
      'T11: OpenLibrary con objeto de libro vacío {} devuelve kind=not-found',
      !resEmptyBook.ok &&
        resEmptyBook.kind === 'not-found' &&
        resEmptyBook.error === 'No encontrado en la fuente',
      JSON.stringify(resEmptyBook),
    )
  }

  // =========================================================================
  // Europe PMC (PMID)
  // =========================================================================

  // 18 / T1. Europe PMC artículo en modo core con SRC:MED, EXT_ID, resultType=core, pageInfo en raíz
  {
    let capturedUrl = ''
    const mock = jsonFetchMock(
      {
        resultList: {
          result: [
            {
              pmid: '26017442',
              doi: '10.1038/nature14539',
              title: '<i>In vitro</i> study of SARS-CoV-2',
              pubYear: '2020',
              pageInfo: '497–506',
              pubTypeList: { pubType: ['Journal Article', 'Review'] },
              authorList: {
                author: [
                  { lastName: 'Pérez', firstName: 'María' },
                  { fullName: 'Consorcio Salud' },
                ],
              },
              journalInfo: {
                journal: { title: 'The Lancet &amp; Reviews' },
                volume: '395',
                issue: '10223',
              },
            },
          ],
        },
      },
      200,
      (url) => {
        capturedUrl = url
      },
    )
    const res = await fetchMetadata(makeId('pmid', '26017442'), mock)
    check(
      'T1: Europe PMC consulta query=SRC:MED%20AND%20EXT_ID:<pmid>&resultType=core&pageSize=1&format=json',
      capturedUrl ===
        'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=SRC:MED%20AND%20EXT_ID:26017442&resultType=core&pageSize=1&format=json',
      `url=${capturedUrl}`,
    )
    check(
      'T1: Europe PMC mapea article core con pageInfo en raíz (497–506→497-506), journal limpio, autores mixtos, doi y pmid',
      res.ok &&
        res.entry.type === 'article' &&
        res.entry.reviewable === false &&
        res.entry.fields.title === 'In vitro study of {SARS}-{CoV}-2' &&
        res.entry.fields.author === "P{\\'e}rez, Mar{\\'\\i}a and Consorcio Salud" &&
        res.entry.fields.journal === 'The Lancet \\& Reviews' &&
        res.entry.fields.volume === '395' &&
        res.entry.fields.number === '10223' &&
        res.entry.fields.pages === '497-506' &&
        res.entry.fields.year === '2020' &&
        res.entry.fields.doi === '10.1038/nature14539' &&
        res.entry.fields.pmid === '26017442' &&
        res.entry.sourceKind === 'pmid' &&
        res.entry.sourceId === '26017442' &&
        res.entry.key === 'perez2020vitro',
      res.ok ? JSON.stringify(res.entry) : res.error,
    )
  }

  // T2. Europe PMC lite (authorString) + core pre-2002 (initials) + authorList vacío con respaldo
  {
    const liteMock = jsonFetchMock({
      resultList: {
        result: [
          {
            pmid: '26017442',
            title: 'Deep learning.',
            pubYear: '2015',
            authorList: { author: [] },
            authorString: 'LeCun Y, García Peña AB, Consorcio Salud.',
            journalTitle: 'Nature &amp; Science',
            journalVolume: '521',
            issue: '7553',
            pageInfo: '436–444',
          },
        ],
      },
    })
    const resLite = await fetchMetadata(makeId('pmid', '26017442'), liteMock)
    check(
      'T2: Europe PMC lite/authorString formatea Apellido, Iniciales, respeta colectivos y genera clave lecun2015deep',
      resLite.ok &&
        resLite.entry.fields.author ===
          "LeCun, Y and Garc{\\'\\i}a Pe{\\~n}a, AB and Consorcio Salud" &&
        resLite.entry.key === 'lecun2015deep' &&
        resLite.entry.fields.journal === 'Nature \\& Science' &&
        resLite.entry.fields.volume === '521' &&
        resLite.entry.fields.number === '7553' &&
        resLite.entry.fields.pages === '436-444',
      resLite.ok ? JSON.stringify(resLite.entry) : resLite.error,
    )

    const pre2002Mock = jsonFetchMock({
      resultList: {
        result: [
          {
            pmid: '123456',
            title: 'Classic Genomics',
            pubYear: '1998',
            authorList: {
              author: [
                { lastName: 'Smith', initials: 'JA' },
                { fullName: 'van der Waals JD.' },
                { collectiveName: 'WHO Group.' },
              ],
            },
            journalInfo: { journal: { title: 'Genetics' } },
          },
        ],
      },
    })
    const resPre = await fetchMetadata(makeId('pmid', '123456'), pre2002Mock)
    check(
      'T2: Europe PMC core pre-2002 usa initials, formatea fullName PubMed y respeta collectiveName',
      resPre.ok &&
        resPre.entry.fields.author === 'Smith, JA and van der Waals, JD and WHO Group' &&
        resPre.entry.key === 'smith1998classic',
      resPre.ok ? JSON.stringify(resPre.entry) : resPre.error,
    )
  }

  // 19. Europe PMC resultado vacío → not-found
  {
    const res = await fetchMetadata(
      makeId('pmid', '99999999'),
      jsonFetchMock({ resultList: { result: [] } }),
    )
    check(
      'Europe PMC con resultList.result vacío devuelve kind=not-found',
      !res.ok && res.kind === 'not-found' && res.error === 'No encontrado en la fuente',
      JSON.stringify(res),
    )
  }

  // 20. Europe PMC resultado sin título → bad-response
  {
    const res = await fetchMetadata(
      makeId('pmid', '12345678'),
      jsonFetchMock({ resultList: { result: [{ pmid: '12345678', pubYear: '2021' }] } }),
    )
    check(
      'Europe PMC sin title devuelve kind=bad-response',
      !res.ok && res.kind === 'bad-response' && res.error === 'Respuesta inesperada de la fuente',
      JSON.stringify(res),
    )
  }

  // =========================================================================
  // Casos genéricos: red, timeout, unknown y garantía de no lanzar
  // =========================================================================

  // 21. fetch que rechaza → network
  {
    const failingFetch: FetchFn = async () => {
      throw new TypeError('Failed to fetch')
    }
    const res = await fetchMetadata(makeId('doi', '10.1000/offline'), failingFetch)
    check(
      'fetch que rechaza devuelve kind=network y no lanza',
      !res.ok && res.kind === 'network' && res.error === 'Error de red (¿sin conexión?)',
      JSON.stringify(res),
    )
  }

  // 22. fetch que lanza síncronamente → network (nunca lanza)
  {
    const syncThrowFetch: FetchFn = () => {
      throw new Error('boom síncrono')
    }
    let threw = false
    let res: Awaited<ReturnType<typeof fetchMetadata>> | null = null
    try {
      res = await fetchMetadata(makeId('isbn', '9780201616224'), syncThrowFetch)
    } catch {
      threw = true
    }
    check(
      'fetchMetadata captura excepciones síncronas y nunca lanza',
      !threw && res !== null && !res.ok && res.kind === 'network',
      JSON.stringify(res),
    )
  }

  // 23. Timeout con AbortError explícito → network
  {
    const abortFetch: FetchFn = async (_input, init) => {
      check('fetchMetadata pasa un AbortSignal a fetch', init?.signal instanceof AbortSignal)
      throw new DOMException('The operation was aborted', 'AbortError')
    }
    const res = await fetchMetadata(makeId('pmid', '26017442'), abortFetch)
    check(
      'AbortError (timeout) devuelve kind=network',
      !res.ok && res.kind === 'network' && res.error === 'Error de red (¿sin conexión?)',
      JSON.stringify(res),
    )
  }

  // 24. Timeout real con mock que nunca resuelve: comprueba que AbortController llama a abort()
  {
    const originalSetTimeout = globalThis.setTimeout
    let observedDelay = -1
    let abortFired = false
    globalThis.setTimeout = ((fn: (...args: unknown[]) => void, delay?: number) => {
      observedDelay = delay ?? 0
      return originalSetTimeout(fn, 10)
    }) as typeof setTimeout

    try {
      const hangingFetch: FetchFn = (_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            abortFired = true
            reject(new DOMException('Timeout', 'AbortError'))
          })
        })
      }

      const res = await fetchMetadata(makeId('doi', '10.1000/lento'), hangingFetch)
      check(
        'Timeout de 15 s dispara AbortSignal en peticiones colgadas y devuelve kind=network',
        observedDelay === 15_000 &&
          abortFired &&
          !res.ok &&
          res.kind === 'network' &&
          res.error === 'Error de red (¿sin conexión?)',
        `delay=${observedDelay} abortFired=${abortFired} res=${JSON.stringify(res)}`,
      )
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
  }

  // 25. ParsedIdentifier unknown → bad-response sin llamar a fetch
  {
    let called = false
    const spyFetch: FetchFn = async () => {
      called = true
      return new Response('{}', { status: 200 })
    }
    const res = await fetchMetadata(makeId('unknown', null, 'esto no es un id'), spyFetch)
    check(
      'ParsedIdentifier unknown devuelve bad-response (Formato no reconocido) sin llamar a fetch',
      !called && !res.ok && res.kind === 'bad-response' && res.error === 'Formato no reconocido',
      `called=${called} res=${JSON.stringify(res)}`,
    )
  }

  // T12. fetchMetadata(id, undefined), fetch→null/{}, Response 200 con .text() que rechaza TypeError
  {
    const originalFetch = globalThis.fetch
    let globalCalled = false
    globalThis.fetch = (async () => {
      globalCalled = true
      return new Response(
        JSON.stringify({ 'ISBN:9780201616224': { title: 'Default Fetch Book' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch
    try {
      const resDefault = await fetchMetadata(makeId('isbn', '9780201616224'), undefined)
      check(
        'T12: fetchMetadata(id, undefined) usa globalThis.fetch y funciona',
        globalCalled && resDefault.ok && resDefault.entry.fields.title === 'Default Fetch Book',
        `called=${globalCalled} res=${JSON.stringify(resDefault)}`,
      )
    } finally {
      globalThis.fetch = originalFetch
    }

    const nullFetch: FetchFn = async () => null as unknown as Response
    const resNull = await fetchMetadata(makeId('doi', '10.1000/null'), nullFetch)
    check(
      'T12: fetch que resuelve null devuelve bad-response sin lanzar',
      !resNull.ok &&
        resNull.kind === 'bad-response' &&
        resNull.error === 'Respuesta inesperada de la fuente',
      JSON.stringify(resNull),
    )

    const emptyObjFetch: FetchFn = async () => ({}) as unknown as Response
    const resEmptyObj = await fetchMetadata(makeId('doi', '10.1000/empty'), emptyObjFetch)
    check(
      'T12: fetch que resuelve {} devuelve bad-response (nunca HTTP undefined) sin lanzar',
      !resEmptyObj.ok &&
        resEmptyObj.kind === 'bad-response' &&
        resEmptyObj.error === 'Respuesta inesperada de la fuente' &&
        !resEmptyObj.error.includes('undefined'),
      JSON.stringify(resEmptyObj),
    )

    const brokenBodyFetch: FetchFn = async () =>
      ({
        status: 200,
        ok: true,
        text: async () => {
          throw new TypeError('network stream interrupted')
        },
      }) as unknown as Response
    const resBrokenBody = await fetchMetadata(makeId('doi', '10.1000/cut'), brokenBodyFetch)
    check(
      'T12: Response 200 cuyo .text() rechaza con TypeError devuelve kind=network',
      !resBrokenBody.ok &&
        resBrokenBody.kind === 'network' &&
        resBrokenBody.error === 'Error de red (¿sin conexión?)',
      JSON.stringify(resBrokenBody),
    )

    const badKindId = {
      line: 1,
      raw: 'x',
      kind: 'otro' as unknown as ParsedIdentifier['kind'],
      normalized: 'x',
      error: null,
    }
    const resBadKind = await fetchMetadata(badKindId, jsonFetchMock({}))
    check(
      'T12: switch (id.kind) tiene default defensivo que devuelve bad-response (Formato no reconocido)',
      !resBadKind.ok &&
        resBadKind.kind === 'bad-response' &&
        resBadKind.error === 'Formato no reconocido',
      JSON.stringify(resBadKind),
    )
  }

  if (failed > 0) process.exit(1)
  console.log(`\nfetchers: ${passed} comprobaciones pasaron.`)
}

await runTests()
