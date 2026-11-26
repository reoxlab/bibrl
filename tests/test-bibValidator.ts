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

// Pruebas unitarias del parser, validador y renumerador de archivos .bib (src/bibValidator.ts).

import { parseBib, renumberDuplicateKeys, validateBib } from '../src/bibValidator.ts'

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

// 1. Texto vacío
{
  const report = validateBib('')
  check(
    'validateBib("") devuelve 0 entradas y 0 problemas',
    report.totalEntries === 0 &&
      report.errors.length === 0 &&
      report.warnings.length === 0 &&
      report.entries.length === 0 &&
      report.unclosedBraces === false,
    JSON.stringify(report),
  )
}

// 2. .bib válido sin problemas (varios tipos, espacios entre @ tipo y {, valor sin llaves)
{
  const validBib = `@article{lecun2015deep,
  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  title = {Deep learning},
  journal = {Nature},
  year = 2015,
  doi = {10.1038/nature14539},
}

@ book {goodfellow2016deep,
  author = {Goodfellow, Ian and Bengio, Yoshua and Courville, Aaron},
  title = {Deep Learning},
  publisher = {MIT Press},
  year = {2016},
}

@BOOK{editorOnly2020,
  editor = {Pérez, Ana},
  title = {Manual de pruebas},
  publisher = {Editorial Sur},
  year = {2020},
}

@inproceedings{vaswani2017attention,
  author = {Vaswani, Ashish},
  title = {Attention Is All You Need},
  booktitle = {NeurIPS},
  year = {2017},
}

@misc{reox2026site,
  title = {Reox Lab},
}`

  const report = validateBib(validBib)
  check('bib válido: cuenta 5 entradas', report.totalEntries === 5, `total: ${report.totalEntries}`)
  check('bib válido: 0 errores', report.errors.length === 0, JSON.stringify(report.errors))
  check('bib válido: 0 avisos', report.warnings.length === 0, JSON.stringify(report.warnings))
  check('bib válido: unclosedBraces es false', report.unclosedBraces === false)
  check(
    'bib válido: tipos normalizados en minúsculas y keyOffset exacto',
    report.entries.every(
      (e) =>
        e.type === e.type.toLowerCase() &&
        validBib.slice(e.keyOffset, e.keyOffset + e.keyLength) === e.key,
    ),
  )
}

// 3. Clave repetida (error + línea correcta)
{
  const bib = `@article{smith2020,
  author = {Smith, John},
  title = {First Paper},
  journal = {Science},
  year = {2020},
}

@article{smith2020,
  author = {Doe, Jane},
  title = {Second Paper},
  journal = {Nature},
  year = {2021},
}`

  const report = validateBib(bib)
  check('clave repetida: 1 error', report.errors.length === 1, JSON.stringify(report.errors))
  check(
    'clave repetida: línea 8 y mensaje con primera aparición en línea 1',
    report.errors[0]?.line === 8 &&
      report.errors[0]?.key === 'smith2020' &&
      report.errors[0]?.message ===
        'La clave «smith2020» está repetida (primera aparición en la línea 1)',
    JSON.stringify(report.errors[0]),
  )
}

// 4. Mismo DOI en dos entradas (normalizado en minúsculas y sin llaves)
{
  const bib = `@article{uno2020,
  author = {Uno, Ana},
  title = {Paper Uno},
  journal = {J1},
  year = {2020},
  doi = {{10.1038/Nature12373}},
}

@article{dos2020,
  author = {Dos, Beto},
  title = {Paper Dos},
  journal = {J2},
  year = {2020},
  doi = {10.1038/nature12373},
}`

  const report = validateBib(bib)
  check('mismo DOI: 1 error y 0 avisos', report.errors.length === 1 && report.warnings.length === 0)
  check(
    'mismo DOI: mensaje y línea correctos con primera aparición',
    report.errors[0]?.line === 9 &&
      report.errors[0]?.message ===
        'Dos entradas comparten el DOI «10.1038/nature12373» (primera aparición en «uno2020», línea 1)',
    JSON.stringify(report.errors[0]),
  )
}

// 5. Mismo título + primer autor (warning; ignora tildes, puntuación, mayúsculas y coautores)
{
  const bib = `@article{garcia2022fisica,
  author = {Garc{\\'i}a, Jos{\\'e} and P{\\'e}rez, Ana},
  title = {{Introducci{\\'o}n} a la F{\\'i}sica: Parte 1!},
  journal = {Revista},
  year = {2022},
}

@article{garcia2022duplicado,
  author = {José García},
  title = {introduccion a la fisica parte 1},
  journal = {Otra Revista},
  year = {2022},
}`

  const report = validateBib(bib)
  check('mismo título+autor: 0 errores', report.errors.length === 0, JSON.stringify(report.errors))
  check(
    'mismo título+autor: 1 aviso en línea 8 apuntando a garcia2022fisica',
    report.warnings.length === 1 &&
      report.warnings[0]?.line === 8 &&
      report.warnings[0]?.message ===
        'Posible duplicado de «garcia2022fisica» (mismo título y autor)',
    JSON.stringify(report.warnings),
  )
}

// 6. article sin journal (error)
{
  const bib = `@article{sinjournal2023,
  author = {Ruiz, Elena},
  title = {Sin revista},
  year = {2023},
}`
  const report = validateBib(bib)
  check('article sin journal: 1 error', report.errors.length === 1, JSON.stringify(report.errors))
  check(
    'article sin journal: menciona journal',
    report.errors[0]?.message.includes('«journal»') === true &&
      report.errors[0]?.key === 'sinjournal2023',
    JSON.stringify(report.errors[0]),
  )
}

// 7. book sin publisher ni author/editor (2 errores)
{
  const bib = `@book{libroIncompleto2021,
  title = {Libro sin datos},
  year = {2021},
}`
  const report = validateBib(bib)
  check(
    'book sin publisher ni author/editor: 2 errores',
    report.errors.length === 2,
    JSON.stringify(report.errors),
  )
  check(
    'book sin publisher ni author/editor: reporta ambos campos faltantes',
    report.errors.some((e) => e.message.includes('«publisher»')) &&
      report.errors.some((e) => e.message.includes('«author» o «editor»')),
    JSON.stringify(report.errors),
  )
}

// 8. Otros tipos requeridos (incollection, phdthesis, techreport, proceedings, unpublished, misc sin title)
{
  const bib = `@incollection{inc2020,
  author = {A},
  title = {T},
  year = {2020},
}
@phdthesis{phd2020,
  author = {A},
  title = {T},
  year = {2020},
}
@techreport{tr2020,
  author = {A},
  title = {T},
  year = {2020},
}
@proceedings{proc2020,
  title = {T},
}
@unpublished{unp2020,
  author = {A},
  title = {T},
}
@misc{misc2020,
  author = {A},
}`
  const report = validateBib(bib)
  check(
    'campos obligatorios por tipo: detecta booktitle, publisher, school, institution, year, note',
    report.errors.some((e) => e.key === 'inc2020' && e.message.includes('«booktitle»')) &&
      report.errors.some((e) => e.key === 'inc2020' && e.message.includes('«publisher»')) &&
      report.errors.some((e) => e.key === 'phd2020' && e.message.includes('«school»')) &&
      report.errors.some((e) => e.key === 'tr2020' && e.message.includes('«institution»')) &&
      report.errors.some((e) => e.key === 'proc2020' && e.message.includes('«year»')) &&
      report.errors.some((e) => e.key === 'unp2020' && e.message.includes('«note»')),
    JSON.stringify(report.errors),
  )
  check(
    'misc sin title: genera warning y no error',
    report.errors.every((e) => e.key !== 'misc2020') &&
      report.warnings.some((w) => w.key === 'misc2020' && w.message.includes('«title»')),
    JSON.stringify({ errors: report.errors, warnings: report.warnings }),
  )
}

// 9. Tipo desconocido (warning)
{
  const bib = `@podcast{ep2025,
  author = {Reox},
  title = {Episodio 1},
  year = {2025},
}`
  const report = validateBib(bib)
  check('tipo desconocido: 0 errores', report.errors.length === 0, JSON.stringify(report.errors))
  check(
    'tipo desconocido: 1 warning con mensaje exacto',
    report.warnings.length === 1 &&
      report.warnings[0]?.message ===
        'Tipo de entrada «podcast» no reconocido; se revisan solo los campos comunes',
    JSON.stringify(report.warnings),
  )
}

// 10. Llaves sin cerrar (error + entrada parcial con los campos leídos)
{
  const bib = `@article{abierta2024,
  author = {Lara, Luis},
  title = {Entrada sin llave de cierre},
  journal = {Journal},
  year = {2024}`

  const parsed = parseBib(bib)
  check(
    'llaves sin cerrar (parseBib): unclosedBraces=true, unclosedLines=[1] y 1 entrada parcial',
    parsed.unclosedBraces === true &&
      parsed.unclosedLines.length === 1 &&
      parsed.unclosedLines[0] === 1 &&
      parsed.entries.length === 1 &&
      parsed.entries[0]?.fields['author']?.value === 'Lara, Luis' &&
      parsed.entries[0]?.fields['year']?.value === '2024',
    JSON.stringify(parsed),
  )

  const report = validateBib(bib)
  check(
    'llaves sin cerrar (validateBib): error exacto en línea 1',
    report.unclosedBraces === true &&
      report.totalEntries === 1 &&
      report.errors.length === 1 &&
      report.errors[0]?.line === 1 &&
      report.errors[0]?.message === 'La entrada «abierta2024» tiene llaves sin cerrar',
    JSON.stringify(report.errors),
  )
}

// 11. Campo vacío (warning en la línea exacta del campo)
{
  const bib = `@article{vacio2024,
  author = {},
  title = {Con autor vacío},
  journal = {Journal},
  year = {2024},
}`
  const report = validateBib(bib)
  check('campo vacío: 0 errores', report.errors.length === 0, JSON.stringify(report.errors))
  check(
    'campo vacío: 1 warning en línea 2 con mensaje exacto',
    report.warnings.length === 1 &&
      report.warnings[0]?.line === 2 &&
      report.warnings[0]?.message === 'El campo «author» de «vacio2024» está vacío',
    JSON.stringify(report.warnings),
  )
}

// 12. Comentarios % y bloques @comment / @preamble / @string ignorados
{
  const bib = `% Comentario al inicio
  % @article{falsa2020, author = {No cuenta}}
@comment{
  @article{tampoco2020,
    author = {Ignorado},
  }
}
@preamble{"\\newcommand{\\noop}[1]{}"}
@string{JACM = "Journal of the ACM"}

@article{real2020,
  author = {Real, Autor},
  title = {Entrada real},
  journal = JACM,
  year = {2020},
}`
  const report = validateBib(bib)
  check(
    'comentarios y directivas ignorados: solo 1 entrada válida y 0 problemas',
    report.totalEntries === 1 &&
      report.entries[0]?.key === 'real2020' &&
      report.entries[0]?.fields['journal']?.value === 'Journal of the ACM' &&
      report.errors.length === 0 &&
      report.warnings.length === 0,
    JSON.stringify(report),
  )
}

// 13. Campos con llaves anidadas y con comillas (incluidos escapes \")
{
  const bib = `@article{complejo2024,
  author = {M{\\"u}ller, {Hans-Peter}},
  title = "Estudio sobre \\"{LaTeX}\\" y {BibTeX}",
  journal = {Journal of {AI} and {ML}},
  year = 2024,
}`
  const parsed = parseBib(bib)
  const entry = parsed.entries[0]
  check(
    'llaves anidadas: quita solo llaves externas y conserva interior',
    entry?.fields['author']?.value === 'M{\\"u}ller, {Hans-Peter}' &&
      entry?.fields['journal']?.value === 'Journal of {AI} and {ML}',
    JSON.stringify(entry?.fields),
  )
  check(
    'comillas con escapes \\": quita solo comillas externas y conserva interior',
    entry?.fields['title']?.value === 'Estudio sobre \\"{LaTeX}\\" y {BibTeX}',
    JSON.stringify(entry?.fields['title']),
  )
  check(
    'líneas de campos registradas correctamente',
    entry?.fields['author']?.line === 2 &&
      entry?.fields['title']?.line === 3 &&
      entry?.fields['journal']?.line === 4 &&
      entry?.fields['year']?.line === 5,
    JSON.stringify(entry?.fields),
  )
}

// 14. Entrada mal formada (@article{,) no cuenta como entrada y genera error
{
  const bib = `@article{,
  author = {Sin Clave},
  title = {Hola},
}

@article{buena2024,
  author = {Bien, Autor},
  title = {Válida},
  journal = {J},
  year = {2024},
}`
  const parsed = parseBib(bib)
  const report = validateBib(bib)
  check(
    'entrada mal formada: no se cuenta en entries y genera error en línea 1',
    parsed.entries.length === 1 &&
      parsed.malformed.length === 1 &&
      report.totalEntries === 1 &&
      report.errors.length === 1 &&
      report.errors[0]?.line === 1,
    JSON.stringify({ parsed, errors: report.errors }),
  )
}

// 15. Renumeración: 3 entradas con la misma clave -> a/b/c + única intacta + texto sin duplicados intacto
{
  const dupBib = `% Encabezado conservado
@article{smith2020,
  author = {Smith, A},
  title = {Primero},
  journal = {J1},
  year = {2020},
}

@article{unica2021,
  author = {Unica, B},
  title = {Sola},
  journal = {J2},
  year = {2021},
}

@article{smith2020,
  author = {Smith, C},
  title = {Segundo},
  journal = {J3},
  year = {2020},
}

@article{smith2020,
  author = {Smith, D},
  title = {Tercero},
  journal = {J4},
  year = {2020},
}`

  const res = renumberDuplicateKeys(dupBib)
  const afterReport = validateBib(res.text)

  check(
    'renumeración: lista renamed tiene las 3 entradas con a/b/c y sus líneas',
    res.renamed.length === 3 &&
      res.renamed[0]?.oldKey === 'smith2020' &&
      res.renamed[0]?.newKey === 'smith2020a' &&
      res.renamed[0]?.line === 2 &&
      res.renamed[1]?.oldKey === 'smith2020' &&
      res.renamed[1]?.newKey === 'smith2020b' &&
      res.renamed[1]?.line === 16 &&
      res.renamed[2]?.oldKey === 'smith2020' &&
      res.renamed[2]?.newKey === 'smith2020c' &&
      res.renamed[2]?.line === 23,
    JSON.stringify(res.renamed),
  )
  check(
    'renumeración: el texto resultante tiene claves a/b/c, conserva unica2021 y comentarios, y valida con 0 errores',
    res.text.includes('% Encabezado conservado') &&
      res.text.includes('@article{smith2020a,') &&
      res.text.includes('@article{unica2021,') &&
      res.text.includes('@article{smith2020b,') &&
      res.text.includes('@article{smith2020c,') &&
      afterReport.totalEntries === 4 &&
      afterReport.errors.length === 0,
    res.text,
  )

  const cleanBib = `@article{alpha2020,
  author = {Alpha, A},
  title = {Clean},
  journal = {J},
  year = {2020},
}`
  const unchanged = renumberDuplicateKeys(cleanBib)
  check(
    'renumeración sin duplicados: devuelve texto idéntico y renamed vacío',
    unchanged.text === cleanBib && unchanged.renamed.length === 0,
  )
}

// 16. Orden de problemas por línea (errors y warnings ordenados ascendentemente)
{
  const bib = `@article{primera,
  author = {},
  title = {Uno},
  journal = {J},
  year = {2020},
}

@unknown{segunda,
  author = {B},
  title = {Dos},
}

@article{primera,
  author = {C},
  title = {Tres},
  year = {2021},
}`
  const report = validateBib(bib)
  const errorsSorted = report.errors.every(
    (err, idx) => idx === 0 || (report.errors[idx - 1]?.line ?? 0) <= err.line,
  )
  const warningsSorted = report.warnings.every(
    (warn, idx) => idx === 0 || (report.warnings[idx - 1]?.line ?? 0) <= warn.line,
  )
  check(
    'problemas ordenados por línea en errors y warnings',
    errorsSorted && warningsSorted && report.errors.length === 2 && report.warnings.length === 2,
    JSON.stringify({ errors: report.errors, warnings: report.warnings }),
  )
}

// 17. Renumeración con saltos CRLF conserva offsets exactos y colisión con clave existente (smith2020a)
{
  const crlfBib =
    '@article{smith2020,\r\n  author = {A},\r\n  title = {T1},\r\n  journal = {J},\r\n  year = {2020},\r\n}\r\n\r\n' +
    '@article{smith2020a,\r\n  author = {B},\r\n  title = {T2},\r\n  journal = {J},\r\n  year = {2020},\r\n}\r\n\r\n' +
    '@article{smith2020,\r\n  author = {C},\r\n  title = {T3},\r\n  journal = {J},\r\n  year = {2020},\r\n}'
  const res = renumberDuplicateKeys(crlfBib)
  const after = validateBib(res.text)
  check(
    'renumeración con CRLF y clave smith2020a previa: evita colisión (b/c) y mantiene CRLF',
    res.renamed.length === 2 &&
      res.renamed[0]?.newKey === 'smith2020b' &&
      res.renamed[1]?.newKey === 'smith2020c' &&
      res.text.includes('\r\n') &&
      after.errors.length === 0,
    JSON.stringify(res.renamed),
  )
}

// 18. Entrada sin cerrar seguida de otra entrada válida
{
  const bib = `@article{sinCerrar2020,
  author = {Ana},
  title = {Incompleta},
  journal = {J1},
  year = {2020},

@article{valida2021,
  author = {Beto},
  title = {Completa},
  journal = {J2},
  year = {2021},
}`
  const report = validateBib(bib)
  check(
    'entrada sin cerrar seguida de otra: detecta ambas entradas y marca solo la primera sin cerrar',
    report.totalEntries === 2 &&
      report.unclosedBraces === true &&
      report.errors.length === 1 &&
      report.errors[0]?.key === 'sinCerrar2020' &&
      report.errors[0]?.line === 1,
    JSON.stringify(report.errors),
  )
}

// 19. Duplicado título+autor no compara entradas a las que les falta uno de los dos datos
{
  const bib = `@misc{soloTitulo1,
  title = {Mismo Título},
}
@misc{soloTitulo2,
  title = {Mismo Título},
}`
  const report = validateBib(bib)
  check(
    'título repetido sin autor no dispara aviso de duplicado título+autor',
    report.errors.length === 0 && report.warnings.length === 0,
    JSON.stringify(report.warnings),
  )
}

// 20. Concatenación con '#' y macros @string (incluido '#' tras salto de línea)
{
  const bib = `@string{JACM = "Journal of the ACM"}
@string{mesAbr = "Abril"}
@article{concat2024,
  author = {Autora, Ana},
  title = {Concatenación},
  journal = JACM
    # " (Special Issue)",
  month = jan # "~15",
  year = {2024},
}`
  const report = validateBib(bib)
  const entry = report.entries[0]
  check(
    'concatenación #: journal y month expandidos desde @string y macros de mes',
    entry?.fields['journal']?.value === 'Journal of the ACM (Special Issue)' &&
      entry?.fields['month']?.value === 'January~15',
    JSON.stringify(entry?.fields),
  )
  check(
    'concatenación #: 0 errores y 0 avisos',
    report.errors.length === 0 && report.warnings.length === 0,
    JSON.stringify({ errors: report.errors, warnings: report.warnings }),
  )
}

// 21. DOI duplicado con prefijos URL, doi: y mayúsculas
{
  const bib = `@article{doiUrl2020,
  author = {Uno, Ana},
  title = {Paper URL},
  journal = {J},
  year = {2020},
  doi = {https://doi.org/10.1038/NATURE12373},
}
@article{doiDx2021,
  author = {Dos, Beto},
  title = {Paper DX},
  journal = {J},
  year = {2021},
  doi = {http://dx.doi.org/10.1038/nature12373},
}
@article{doiPrefijo2022,
  author = {Tres, Carla},
  title = {Paper doi},
  journal = {J},
  year = {2022},
  doi = {doi: 10.1038/nature12373},
}`
  const report = validateBib(bib)
  check(
    'DOI con prefijos URL/doi: y mayúsculas: detecta 2 duplicados',
    report.errors.length === 2 &&
      report.errors.every((e) => e.message.includes('10.1038/nature12373')),
    JSON.stringify(report.errors),
  )

  const bibEscapes = `@article{doiEsc1,
  author = {A},
  title = {Uno},
  journal = {J},
  year = {2020},
  doi = {10.1007/978\\_1},
}
@article{doiEsc2,
  author = {B},
  title = {Dos},
  journal = {J},
  year = {2021},
  doi = {10.1007/978_1},
}
@article{doiEsc3,
  author = {C},
  title = {Tres},
  journal = {J},
  year = {2022},
  doi = {10.1234/a%2Fb},
}
@article{doiEsc4,
  author = {D},
  title = {Cuatro},
  journal = {J},
  year = {2023},
  doi = {10.1234/a/b},
}`
  const reportEscapes = validateBib(bibEscapes)
  check(
    'DOI: normaliza \\_ y %2F para detectar duplicados',
    reportEscapes.errors.length === 2,
    JSON.stringify(reportEscapes.errors),
  )
}

// 22. Mismo DOI + mismo título + mismo autor: solo error de DOI, sin aviso redundante
{
  const bib = `@article{mismoDoiA,
  author = {Smith, John},
  title = {Same Paper},
  journal = {J1},
  year = {2020},
  doi = {10.5555/ABC},
}
@article{mismoDoiB,
  author = {Smith, John},
  title = {Same Paper},
  journal = {J2},
  year = {2021},
  doi = {https://doi.org/10.5555/abc},
}`
  const report = validateBib(bib)
  check(
    'mismo DOI+título+autor: 1 error de DOI y 0 avisos',
    report.errors.length === 1 &&
      report.errors[0]?.message.includes('DOI') === true &&
      report.warnings.length === 0,
    JSON.stringify({ errors: report.errors, warnings: report.warnings }),
  )
}

// 23. Comentarios % entre campos, tras coma y tras el cierre de la entrada
{
  const bib = `@article{comentario2024,
  author = {A}, % comentario tras coma
  % comentario entre campos
  title = {T},
  journal = {J}, % ok
  year = {2020},
} % @article{comentada2020, author = {No}, title = {No}, journal = {No}, year = {2020}}`
  const report = validateBib(bib)
  check(
    'comentarios %: 1 entrada válida, 0 errores y 0 avisos',
    report.totalEntries === 1 &&
      report.entries[0]?.key === 'comentario2024' &&
      report.errors.length === 0 &&
      report.warnings.length === 0,
    JSON.stringify(report),
  )
}

// 24. Directivas @string/@preamble/@comment sin cerrar
{
  const directivas = ['string', 'preamble', 'comment']
  for (const directiva of directivas) {
    const bib = `@${directiva}{
  contenido = {x}

@article{despues2024,
  author = {A},
  title = {T},
  journal = {J},
  year = {2024},
}`
    const parsed = parseBib(bib)
    const report = validateBib(bib)
    check(
      `directiva @${directiva} sin cerrar: unclosedBraces y error en la línea de la directiva`,
      parsed.unclosedBraces === true &&
        parsed.unclosedLines.includes(1) &&
        report.errors.some(
          (e) => e.line === 1 && e.message.includes(`@${directiva}`) && e.message.includes('sin cerrar'),
        ),
      JSON.stringify({ parsed, errors: report.errors }),
    )
  }
}

// 25. Entradas y campos mal formados
{
  const sinClave = validateBib('@article{author = {X}}')
  check(
    'mal formada: @article{author = {X}} (sin clave) no cuenta y genera error',
    sinClave.totalEntries === 0 &&
      sinClave.errors.length >= 1 &&
      sinClave.errors.some((e) => e.message.includes('mal formada')),
    JSON.stringify(sinClave.errors),
  )

  const claveSinComa = validateBib(`@article{claveSinComa
  author = {X}}`)
  check(
    'mal formada: clave sin coma genera error y no cuenta',
    claveSinComa.totalEntries === 0 &&
      claveSinComa.errors.some((e) => e.message.includes('falta la coma tras la clave')),
    JSON.stringify(claveSinComa.errors),
  )

  const malFormadaSinCerrar = validateBib(`@article{,
  author = {X}`)
  check(
    'mal formada y sin cerrar: reporta error de entrada y de llaves sin cerrar',
    malFormadaSinCerrar.unclosedBraces === true &&
      malFormadaSinCerrar.totalEntries === 0 &&
      malFormadaSinCerrar.errors.some((e) => e.message.includes('mal formada')) &&
      malFormadaSinCerrar.errors.some((e) => e.message.includes('sin cerrar')),
    JSON.stringify(malFormadaSinCerrar.errors),
  )

  const sinComaCampo = validateBib(`@article{sinComa2024,
  author = {A},
  title = {T},
  journal = {J}
  year = {2020},
}`)
  check(
    'falta de coma entre campos: error en la línea del campo',
    sinComaCampo.errors.some(
      (e) => e.line === 4 && e.message.includes('Falta la coma tras el campo «journal»'),
    ),
    JSON.stringify(sinComaCampo.errors),
  )

  const sinIgual = validateBib(`@article{sinIgual2024,
  author = {A},
  title = {T},
  journal = {J},
  year = {2020},
  note {Texto}
}`)
  check(
    'campo sin «=»: error y la entrada no se cierra en falso',
    sinIgual.totalEntries === 1 &&
      sinIgual.errors.some(
        (e) => e.line === 6 && e.message.includes('Falta «=» tras el campo «note»'),
      ),
    JSON.stringify(sinIgual.errors),
  )

  const cabeceraInvalida = validateBib(`@{sinTipo2024,
  author = {A},
}`)
  check(
    'cabecera @ inválida al inicio de línea: entrada mal formada',
    cabeceraInvalida.totalEntries === 0 &&
      cabeceraInvalida.errors.some((e) => e.line === 1 && e.message.includes('mal formada')),
    JSON.stringify(cabeceraInvalida.errors),
  )
}

// 26. Llaves sueltas dentro de comillas en @string y en campos
{
  const bib = `@string{X = "texto } con llave"}
@string{Y = "texto { con llave"}
@article{comillasLlave2024,
  author = {A},
  title = "A } B",
  journal = "C { D",
  year = {2024},
}`
  const parsed = parseBib(bib)
  const report = validateBib(bib)
  const entry = report.entries[0]
  check(
    'llaves sueltas en comillas: no rompen el equilibrio externo',
    parsed.unclosedBraces === false &&
      report.totalEntries === 1 &&
      entry?.fields['title']?.value === 'A } B' &&
      entry?.fields['journal']?.value === 'C { D' &&
      report.errors.length === 0,
    JSON.stringify({ parsed, errors: report.errors, fields: entry?.fields }),
  )
}

// 27. Renumeración: solo cambian las cabeceras, no comentarios ni valores
{
  const bib = `% ver smith2020
@article{smith2020,
  author = {Smith, A},
  title = {Uno},
  journal = {J},
  year = {2020},
  note = {cita a smith2020},
}
@article{smith2020,
  author = {Smith, B},
  title = {Dos},
  journal = {J},
  year = {2021},
  note = {otra cita a smith2020},
}`
  const res = renumberDuplicateKeys(bib)
  check(
    'renumeración: solo cambian las cabeceras, no el comentario ni note',
    res.renamed.length === 2 &&
      res.text.includes('@article{smith2020a,') &&
      res.text.includes('@article{smith2020b,') &&
      res.text.includes('% ver smith2020') &&
      res.text.includes('note = {cita a smith2020}') &&
      res.text.includes('note = {otra cita a smith2020}'),
    res.text,
  )

  const caseBib = `@article{Smith2020,
  author = {A},
  title = {Uno},
  journal = {J},
  year = {2020},
}
@article{smith2020,
  author = {B},
  title = {Dos},
  journal = {J},
  year = {2021},
}`
  const caseRes = renumberDuplicateKeys(caseBib)
  check(
    'renumeración: claves que solo difieren en mayúsculas se renumeran',
    caseRes.renamed.length === 2 &&
      new Set(caseRes.renamed.map((r) => r.newKey.toLowerCase())).size === 2,
    JSON.stringify(caseRes.renamed),
  )
}

// 28. Tipos de entrada: obligatorios de mastersthesis/inbook/conference/booklet/manual y tipos modernos
{
  const bib = `@mastersthesis{m1,
  author = {A},
  title = {T},
  year = {2020},
}
@inbook{i1,
  author = {A},
  title = {T},
  year = {2020},
}
@conference{c1,
  author = {A},
  title = {T},
  year = {2020},
}
@booklet{b1,
  author = {A},
}
@manual{man1,
  author = {A},
}
@online{o1,
  title = {Recurso web},
  url = {https://example.com},
  year = {2024},
}
@software{sw1,
  title = {Programa},
  year = {2024},
}
@dataset{ds1,
  title = {Datos},
  year = {2024},
}
@thesis{th1,
  author = {A},
  title = {Tesis de ejemplo},
  school = {S},
  year = {2024},
}
@report{rp1,
  author = {A},
  title = {Informe de ejemplo},
  institution = {I},
  year = {2024},
}`
  const report = validateBib(bib)
  check(
    'tipos: mastersthesis sin school, inbook incompleto, conference sin booktitle',
    report.errors.some((e) => e.key === 'm1' && e.message.includes('«school»')) &&
      report.errors.some((e) => e.key === 'i1' && e.message.includes('«publisher»')) &&
      report.errors.some((e) => e.key === 'i1' && e.message.includes('«chapter» o «pages»')) &&
      report.errors.some((e) => e.key === 'c1' && e.message.includes('«booktitle»')),
    JSON.stringify(report.errors),
  )
  check(
    'tipos: booklet y manual sin title son error, no warning',
    report.errors.some((e) => e.key === 'b1' && e.message.includes('«title»')) &&
      report.errors.some((e) => e.key === 'man1' && e.message.includes('«title»')),
    JSON.stringify(report.errors),
  )
  check(
    'tipos modernos online/software/dataset/thesis/report reconocidos sin avisos',
    ['o1', 'sw1', 'ds1', 'th1', 'rp1'].every(
        (key) =>
          report.errors.every((e) => e.key !== key) &&
          report.warnings.every((w) => w.key !== key),
      ) &&
      !report.warnings.some((w) => w.message.includes('no reconocido')),
    JSON.stringify({ errors: report.errors, warnings: report.warnings }),
  )
}

if (failed > 0) process.exit(1)
console.log(`\nbibValidator: ${passed} comprobaciones pasaron.`)
