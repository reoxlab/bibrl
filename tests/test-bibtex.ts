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

// Pruebas del núcleo BibTeX: escape, protección de siglas, claves y formato de entradas.
import {
  type BibEntry,
  VERBATIM_FIELDS,
  assignUniqueKeys,
  buildKey,
  escapeBibtex,
  escapeFieldValue,
  escapeVerbatim,
  formatEntry,
  formatTitle,
  makeUniqueKey,
  protectAcronyms,
  stripAccents,
} from '../src/bibtex.ts'

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

function hasBalancedBraces(s: string): boolean {
  let depth = 0
  for (const ch of s) {
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth < 0) return false
    }
  }
  return depth === 0
}

// --- stripAccents ---
{
  const got = stripAccents('González Cervera — Ñandú, pingüino, façade, àèìòù')
  const want = 'Gonzalez Cervera — Nandu, pinguino, facade, aeiou'
  check('stripAccents elimina diacríticos en mayúsculas y minúsculas', got === want, `got: ${got}`)
}
{
  const got = stripAccents('a\u0301e\u0301n\u0303')
  check('stripAccents funciona también con entradas ya en NFD', got === 'aen', `got: ${got}`)
}

// --- escapeBibtex: caracteres especiales (llaves siempre equilibradas) ---
const specialCases: Array<[string, string, string]> = [
  ['barra invertida', '\\', '{\\textbackslash}'],
  ['llave abierta', '{', '{\\textbraceleft}'],
  ['llave cerrada', '}', '{\\textbraceright}'],
  ['dólar', '$', '\\$'],
  ['porcentaje', '%', '\\%'],
  ['ampersand', '&', '\\&'],
  ['almohadilla', '#', '\\#'],
  ['guion bajo', '_', '\\_'],
  ['circunflejo', '^', '{\\textasciicircum}'],
  ['virgulilla', '~', '{\\textasciitilde}'],
]
for (const [label, input, expected] of specialCases) {
  const got = escapeBibtex(input)
  check(`escapeBibtex escapa ${label} (${input})`, got === expected, `got: ${got}`)
}
{
  const got = escapeBibtex('a\\b {hola} $100 50% & #1 x_2 y^3 ~z')
  const want =
    'a{\\textbackslash}b {\\textbraceleft}hola{\\textbraceright} \\$100 50\\% \\& \\#1 x\\_2 y{\\textasciicircum}3 {\\textasciitilde}z'
  check(
    'escapeBibtex escapa todos los especiales juntos en una sola pasada sin doble escape',
    got === want && hasBalancedBraces(got),
    `got: ${got}`,
  )
}
// T1: llaves sueltas equilibradas
{
  const got1 = escapeBibtex('Set {a')
  const got2 = escapeBibtex('b} c')
  check(
    'T1: escapeBibtex mantiene llaves equilibradas con llaves sueltas',
    got1 === 'Set {\\textbraceleft}a' &&
      got2 === 'b{\\textbraceright} c' &&
      hasBalancedBraces(got1) &&
      hasBalancedBraces(got2),
    `got: "${got1}" | "${got2}"`,
  )
}
// T5 y T6: vacío y sin especiales
{
  check('T5: escapeBibtex("") devuelve ""', escapeBibtex('') === '')
  check(
    'T6: escapeBibtex deja texto sin especiales sin cambios',
    escapeBibtex('Deep learning') === 'Deep learning',
  )
}

// --- escapeBibtex: acentos NFD genéricos, letras sueltas y signos tipográficos ---
{
  const got = escapeBibtex('áéíóúÁÉÍÓÚ')
  const want = "{\\'a}{\\'e}{\\'\\i}{\\'o}{\\'u}{\\'A}{\\'E}{\\'I}{\\'O}{\\'U}"
  check(
    'escapeBibtex convierte vocales con tilde aguda usando \\i para í',
    got === want,
    `got: ${got}`,
  )
}
{
  const got = escapeBibtex('àèìòùÀÈÌÒÙ')
  const want = '{\\`a}{\\`e}{\\`\\i}{\\`o}{\\`u}{\\`A}{\\`E}{\\`I}{\\`O}{\\`U}'
  check(
    'escapeBibtex convierte vocales con tilde grave usando \\i para ì',
    got === want,
    `got: ${got}`,
  )
}
{
  const got = escapeBibtex('ñÑüÜïÏçÇ')
  const want = '{\\~n}{\\~N}{\\"u}{\\"U}{\\"\\i}{\\"I}{\\c c}{\\c C}'
  check('escapeBibtex convierte ñ, Ñ, ü, Ü, ï (con \\i), Ï, ç y Ç', got === want, `got: ${got}`)
}
{
  const got = escapeBibtex('a\u0301')
  check('escapeBibtex normaliza NFD antes de escapar acentos', got === "{\\'a}", `got: ${got}`)
}
// T2: letras sueltas
{
  const got = escapeBibtex('ø Ø ł Ł ß æ œ å Å')
  const want = '{\\o} {\\O} {\\l} {\\L} {\\ss} {\\ae} {\\oe} {\\aa} {\\AA}'
  check('T2: escapeBibtex convierte letras sueltas ø Ø ł Ł ß æ œ å Å', got === want, `got: ${got}`)
}
{
  const got = escapeBibtex('Æ Œ ı')
  const want = '{\\AE} {\\OE} {\\i}'
  check('escapeBibtex convierte Æ, Œ e ı (i sin punto)', got === want, `got: ${got}`)
}
// T3: acentos europeos (caron, doble aguda, ogonek, breve, macron, punto, anillo)
{
  const got = escapeBibtex('čšžř őű ą ę')
  const want = '{\\v c}{\\v s}{\\v z}{\\v r} {\\H o}{\\H u} {\\k a} {\\k e}'
  check('T3: escapeBibtex convierte čšžř őű ą ę vía NFD genérico', got === want, `got: ${got}`)
}
{
  const got = escapeBibtex('ă ā ż ů')
  const want = '{\\u a} {\\=a} {\\.z} {\\r u}'
  check('escapeBibtex convierte breve, macron, punto superior y anillo', got === want, `got: ${got}`)
}
// T4: signos tipográficos
{
  const got = escapeBibtex('a – b — c')
  check('T4: escapeBibtex convierte rayas tipográficas en -- y ---', got === 'a -- b --- c', `got: ${got}`)
}
{
  const got = escapeBibtex('“cita” y ‘simple’')
  check(
    'escapeBibtex convierte comillas tipográficas inglesas',
    got === "``cita'' y `simple'",
    `got: ${got}`,
  )
}
{
  const got = escapeBibtex('张伟 Физика й ά')
  check(
    'escapeBibtex conserva en UTF-8 caracteres no latinos sin deformarlos',
    got === '张伟 Физика й ά',
    `got: ${got}`,
  )
}

// --- escapeVerbatim y escapeFieldValue (T9) ---
{
  check(
    'VERBATIM_FIELDS contiene doi, url, eprint, isbn y pmid',
    VERBATIM_FIELDS.has('doi') &&
      VERBATIM_FIELDS.has('url') &&
      VERBATIM_FIELDS.has('eprint') &&
      VERBATIM_FIELDS.has('isbn') &&
      VERBATIM_FIELDS.has('pmid') &&
      VERBATIM_FIELDS.size === 5,
  )
}
{
  const url = 'https://x.org/a_b%20c#d~e'
  const doi = '10.1000/a_b<c>;#1'
  check(
    'T9: escapeFieldValue deja url y doi literales sin escapar _, %, #, ~',
    escapeFieldValue('url', url) === url && escapeFieldValue('DOI', doi) === doi,
    `got: ${escapeFieldValue('url', url)} | ${escapeFieldValue('DOI', doi)}`,
  )
}
{
  const balanced = 'https://x.org/{id}/page'
  const unbalanced = 'https://x.org/{id/a}b}c'
  const gotUnbalanced = escapeVerbatim(unbalanced)
  check(
    'escapeVerbatim respeta llaves equilibradas y sustituye solo llaves sueltas',
    escapeVerbatim(balanced) === balanced &&
      gotUnbalanced === 'https://x.org/{id/a}b{\\textbraceright}c' &&
      hasBalancedBraces(gotUnbalanced),
    `got: ${gotUnbalanced}`,
  )
}
{
  const got = escapeFieldValue('note', '50% & a_b')
  check(
    'escapeFieldValue aplica escapeBibtex a campos no literales',
    got === '50\\% \\& a\\_b',
    `got: ${got}`,
  )
}

// --- protectAcronyms (solo tests) y formatTitle ---
{
  const got = protectAcronyms('Deep learning at NASA with LaTeX and BibTeX on GPU')
  const want = 'Deep learning at {NASA} with {LaTeX} and {BibTeX} on {GPU}'
  check(
    'protectAcronyms protege NASA, LaTeX, BibTeX y GPU pero deja Deep sin proteger',
    got === want,
    `got: ${got}`,
  )
}
{
  const got = protectAcronyms('Using {NASA} and {LaTeX} with GPUs and COVID-19')
  const want = 'Using {NASA} and {LaTeX} with {GPUs} and {COVID}-19'
  check(
    'protectAcronyms no duplica llaves existentes y respeta guiones',
    got === want,
    `got: ${got}`,
  )
}
// T10: palabras no siglas
{
  const got = protectAcronyms('I think A is Einstein')
  check('T10: protectAcronyms deja I, A y Einstein sin cambios', got === 'I think A is Einstein', `got: ${got}`)
}
// T11: NFD en protectAcronyms y formatTitle
{
  const nfdMexico = 'MÉXICO'.normalize('NFD')
  const gotProtected = protectAcronyms(nfdMexico)
  const gotFormatted = formatTitle(nfdMexico)
  check(
    'T11: NFD de MÉXICO produce {MÉXICO} en NFC y {M{\\\'E}XICO} en formatTitle',
    gotProtected === '{MÉXICO}' && gotFormatted === "{M{\\'E}XICO}",
    `got: "${gotProtected}" | "${gotFormatted}"`,
  )
}
// T12: siglas con guiones, minúscula inicial y dígitos
{
  const got = protectAcronyms('SARS-CoV-2 mRNA 3D pH')
  const want = '{SARS}-{CoV}-2 {mRNA} {3D} {pH}'
  check('T12: protectAcronyms protege SARS-CoV-2, mRNA, 3D y pH', got === want, `got: ${got}`)
}
// T15: formatTitle con acentos y siglas
{
  const got = formatTitle('Café NASA')
  check('T15: formatTitle("Café NASA") produce Caf{\\\'e} {NASA}', got === "Caf{\\'e} {NASA}", `got: ${got}`)
}
{
  const got = formatTitle('Estudio de la NASA con LaTeX: 100% & GPU en España')
  const want = 'Estudio de la {NASA} con {LaTeX}: 100\\% \\& {GPU} en Espa{\\~n}a'
  check('formatTitle escapa especiales y acentos mientras protege siglas en una pasada', got === want, `got: ${got}`)
}
// T7 / T14: protección previa y llaves sueltas en formatTitle
{
  const got = formatTitle('The {NASA} set {a')
  const want = 'The {NASA} set {\\textbraceleft}a'
  check(
    'T7/T14: formatTitle protege {NASA} y equilibra llaves sueltas en "The {NASA} set {a"',
    got === want && hasBalancedBraces(got),
    `got: ${got}`,
  )
}
{
  const got = formatTitle('{Einstein} y conjuntos {a, b}')
  const want = '{Einstein} y conjuntos {\\textbraceleft}a, b{\\textbraceright}'
  check(
    'T7: formatTitle conserva {Einstein} como protección y escapa {a, b}',
    got === want && hasBalancedBraces(got),
    `got: ${got}`,
  )
}
// (9) LaTeX $...$ en títulos
{
  const got1 = formatTitle('On $O(n \\log n)$ algorithms at NASA: 100%')
  const want1 = 'On $O(n \\log n)$ algorithms at {NASA}: 100\\%'
  const got2 = formatTitle('$\\alpha$-stable processes & GPU')
  const want2 = '$\\alpha$-stable processes \\& {GPU}'
  check(
    'formatTitle conserva verbatim segmentos $...$ y escapa/protege el resto',
    got1 === want1 && got2 === want2,
    `got: "${got1}" | "${got2}"`,
  )
}
{
  const got = formatTitle('Costs $100 for GPU')
  check(
    'formatTitle escapa un $ suelto que no cierra matemática',
    got === 'Costs \\$100 for {GPU}',
    `got: ${got}`,
  )
}
// T13 / (15): títulos todo en mayúsculas (>60 % palabras de ≥2 letras en mayúsculas)
{
  const got = formatTitle('DEEP LEARNING FOR NLP & AI')
  const want = 'DEEP LEARNING FOR NLP \\& AI'
  check(
    'T13: formatTitle no protege siglas en títulos todo en mayúsculas (>60 %)',
    got === want,
    `got: ${got}`,
  )
}

// --- buildKey ---
{
  const got = buildKey({ full: 'LeCun, Yann' }, '2015', 'Deep learning')
  check('buildKey genera lecun2015deep con formato Apellido, Nombre', got === 'lecun2015deep', `got: ${got}`)
}
{
  const got = buildKey({ full: 'Yann LeCun' }, '2015', 'Deep learning')
  check('buildKey genera lecun2015deep con formato Nombre Apellido', got === 'lecun2015deep', `got: ${got}`)
}
{
  const got = buildKey({ full: 'González Cervera, José Antonio' }, '2021', 'Estudio sobre energía solar')
  check(
    'buildKey genera gonzalezcervera2021estudio con apellido compuesto y coma',
    got === 'gonzalezcervera2021estudio',
    `got: ${got}`,
  )
}
{
  const got = buildKey({ full: 'José Antonio González Cervera' }, '2021', 'Estudio sobre energía solar')
  check(
    'buildKey genera gonzalezcervera2021estudio con nombre compuesto sin coma',
    got === 'gonzalezcervera2021estudio',
    `got: ${got}`,
  )
}
// T16: apellido separado (family) sin heurística
{
  const got1 = buildKey({ family: 'González Cervera' }, '2020', 'Energía')
  const got2 = buildKey({ family: 'García Márquez' }, '1967', 'Cien años')
  check(
    'T16: buildKey con family usa el apellido compuesto tal cual sin heurística',
    got1 === 'gonzalezcervera2020energia' && got2 === 'garciamarquez1967cien',
    `got: ${got1}, ${got2}`,
  )
}
// T17: partículas insensibles a mayúsculas
{
  const got1 = buildKey({ full: 'Van Der Waals' }, '1873', 'On the continuity of the gaseous state')
  const got2 = buildKey({ full: 'Johannes Van der Waals' }, '1873', 'Over de continuiteit')
  const got3 = buildKey({ full: 'van der Waals' }, '1873', 'On the continuity of the gaseous state')
  check(
    'T17: buildKey reconoce partículas sin distinguir mayúsculas (Van Der Waals)',
    got1 === 'vanderwaals1873continuity' &&
      got2 === 'vanderwaals1873over' &&
      got3 === 'vanderwaals1873continuity',
    `got: ${got1}, ${got2}, ${got3}`,
  )
}
// T18: De la Cruz (solo apellido y nombre completo)
{
  const got1 = buildKey({ family: 'De la Cruz' }, '2020', 'Estudio')
  const got2 = buildKey({ full: 'Juan De la Cruz' }, '2020', 'Estudio')
  check(
    'T18: buildKey genera delacruz con family y con full ("Juan De la Cruz")',
    got1 === 'delacruz2020estudio' && got2 === 'delacruz2020estudio',
    `got: ${got1}, ${got2}`,
  )
}
// T19: transliteración
{
  const got1 = buildKey({ family: 'Łukasiewicz' }, '1920', 'Logic')
  const got2 = buildKey({ family: 'Ørsted' }, '1820', 'Field')
  const got3 = buildKey({ family: 'Strauß' }, '1900', 'Music')
  const got4 = buildKey({ family: 'Ælfric Đorđević Þór' }, '2000', 'Œuvre ı')
  check(
    'T19: buildKey translitera ł, ø, ß, æ, œ, đ, ð, þ e ı antes de quitar acentos',
    got1 === 'lukasiewicz1920logic' &&
      got2 === 'orsted1820field' &&
      got3 === 'strauss1900music' &&
      got4 === 'aelfricdordevicthor2000oeuvre',
    `got: ${got1}, ${got2}, ${got3}, ${got4}`,
  )
}
// T20: escrituras no latinas (fallback documentado sinautor/sintitulo)
{
  const got1 = buildKey({ full: '张伟' }, '2020', '深度学习')
  const got2 = buildKey({ full: 'Иванов, Иван' }, '2020', 'Физика')
  check(
    'T20: escrituras no latinas usan el fallback documentado sinautor/sintitulo',
    got1 === 'sinautor2020sintitulo' && got2 === 'sinautor2020sintitulo',
    `got: ${got1}, ${got2}`,
  )
}
{
  const got = buildKey({ full: 'Donald E. Knuth' }, '1968', 'The Art of Computer Programming')
  check(
    'buildKey descarta iniciales intermedias y stopwords inglesas',
    got === 'knuth1968art',
    `got: ${got}`,
  )
}
{
  const got = buildKey({ family: 'García' }, null, 'El análisis de los datos en la física')
  check(
    'buildKey usa sinano (ASCII) cuando falta el año y salta stopwords en español',
    got === 'garciasinanoanalisis',
    `got: ${got}`,
  )
}
{
  const got = buildKey({ family: 'Pérez' }, '2024', 'El de la y con por para sobre entre')
  check(
    'buildKey usa sintitulo cuando el título solo tiene stopwords',
    got === 'perez2024sintitulo',
    `got: ${got}`,
  )
}
// T22: año tolerante
{
  const got1 = buildKey({ family: 'Knuth' }, 'c1999', 'Art')
  const got2 = buildKey({ family: 'Knuth' }, '[1999]', 'Art')
  const got3 = buildKey({ family: 'Knuth' }, '2020-05-12', 'Art')
  check(
    'T22: buildKey extrae años de formatos c1999, [1999] y fecha ISO',
    got1 === 'knuth1999art' && got2 === 'knuth1999art' && got3 === 'knuth2020art',
    `got: ${got1}, ${got2}, ${got3}`,
  )
}
// T23: elisiones y stopwords ampliadas
{
  const got1 = buildKey({ family: 'Darwin' }, '1859', "L'évolution des espèces")
  const got2 = buildKey({ family: 'Adams' }, '1979', "Don't Panic in the Galaxy")
  check(
    'T23: buildKey maneja elisiones (l\', don\'t) y stopwords ampliadas',
    got1 === 'darwin1859evolution' && got2 === 'adams1979panic',
    `got: ${got1}, ${got2}`,
  )
}
// T24: palabras solo numéricas y de una letra saltadas
{
  const got = buildKey({ family: 'Clarke' }, '1968', '2001: A Space Odyssey')
  check(
    'T24: buildKey exige al menos una letra y ≥2 caracteres ("2001: A Space Odyssey" -> space)',
    got === 'clarke1968space',
    `got: ${got}`,
  )
}
// T25: sufijos de nombre Jr., Sr., II, III, IV
{
  const got1 = buildKey({ full: 'Martin Luther King Jr.' }, '1963', 'Dream')
  const got2 = buildKey({ full: 'Henry Ford II' }, '1950', 'Industry')
  const got3 = buildKey({ full: 'John Doe Sr.' }, '1980', 'Notes')
  check(
    'T25: buildKey quita sufijos Jr., Sr., II, III, IV al final del nombre completo',
    got1 === 'king1963dream' && got2 === 'ford1950industry' && got3 === 'doe1980notes',
    `got: ${got1}, ${got2}, ${got3}`,
  )
}
// T26: todo vacío / null
{
  const got = buildKey({}, null, '')
  check(
    'T26: autor vacío, año null y título vacío generan sinautorsinanosintitulo',
    got === 'sinautorsinanosintitulo',
    `got: ${got}`,
  )
}
// T21: TODA clave generada cumple /^[a-z0-9]+$/
{
  const sampleKeys = [
    buildKey({ family: 'González Cervera' }, null, 'Estudio'),
    buildKey({ full: 'Łukasiewicz, Jan' }, 'c1999', "L'évolution"),
    buildKey({ full: '张伟' }, null, '深度学习'),
    buildKey({ family: 'Strauß' }, '2020', '2001: A Space Odyssey'),
    buildKey({}, '', '--- ???'),
    buildKey({ full: 'Martin Luther King Jr.' }, '1963', 'Ñandú'),
  ]
  const asciiRe = /^[a-z0-9]+$/
  check(
    'T21: toda clave generada cumple /^[a-z0-9]+$/ (100 % ASCII)',
    sampleKeys.every((k) => asciiRe.test(k)),
    `keys: ${sampleKeys.join(', ')}`,
  )
}

// --- makeUniqueKey y assignUniqueKeys ---
{
  const existing = new Set<string>(['otra2020'])
  const got = makeUniqueKey('autor2020', existing)
  check('makeUniqueKey devuelve la clave base si no hay colisión', got === 'autor2020', `got: ${got}`)
}
{
  const existing = new Set<string>(['autor2020'])
  const a = makeUniqueKey('autor2020', existing)
  existing.add(a)
  const b = makeUniqueKey('autor2020', existing)
  existing.add(b)
  const c = makeUniqueKey('autor2020', existing)
  check(
    'makeUniqueKey añade sufijos a, b, c en colisiones sucesivas',
    a === 'autor2020a' && b === 'autor2020b' && c === 'autor2020c',
    `got: ${a}, ${b}, ${c}`,
  )
}
{
  const existing = new Set<string>(['k'])
  for (let i = 0; i < 26; i++) {
    existing.add(`k${String.fromCharCode(97 + i)}`)
  }
  const got = makeUniqueKey('k', existing)
  check('makeUniqueKey continúa con aa tras agotar a-z', got === 'kaa', `got: ${got}`)
}
// T27: assignUniqueKeys (convención de dos pasadas)
{
  const got = assignUniqueKeys(['autor2020', 'autor2020'])
  check(
    'T27: assignUniqueKeys asigna sufijo a y b a todas las apariciones duplicadas',
    got.length === 2 && got[0] === 'autor2020a' && got[1] === 'autor2020b',
    `got: ${JSON.stringify(got)}`,
  )
}
{
  const got = assignUniqueKeys(['unica2020', 'dup2020', 'dup2020'])
  check(
    'assignUniqueKeys deja intactas las bases únicas y renumera solo las duplicadas',
    got.length === 3 && got[0] === 'unica2020' && got[1] === 'dup2020a' && got[2] === 'dup2020b',
    `got: ${JSON.stringify(got)}`,
  )
}
// T28: colisión de base terminada en letra con sufijo generado
{
  const existing = new Set<string>(['smith2020deep', 'smith2020deepa'])
  const gotInc = makeUniqueKey('smith2020deep', existing)
  const gotBatch = assignUniqueKeys(['smith2020deep', 'smith2020deep', 'smith2020deepa'])
  check(
    'T28: colisión con clave base terminada en letra no produce duplicados ni en incremental ni en dos pasadas',
    gotInc === 'smith2020deepb' &&
      gotBatch.length === 3 &&
      new Set(gotBatch).size === 3 &&
      gotBatch[2] === 'smith2020deepa',
    `gotInc: ${gotInc}, gotBatch: ${JSON.stringify(gotBatch)}`,
  )
}

// --- formatEntry ---
{
  const entry: BibEntry = {
    type: 'article',
    key: 'lecun2015deep',
    sourceKind: 'doi',
    sourceId: '10.1038/nature14539',
    reviewable: false,
    fields: {
      author: 'LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey',
      title: 'Deep learning',
      journal: 'Nature',
      year: '2015',
      volume: '521',
      number: '7553',
      pages: '436--444',
      doi: '10.1038/nature14539',
    },
  }
  const expected = [
    '@article{lecun2015deep,',
    '  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},',
    '  title = {Deep learning},',
    '  journal = {Nature},',
    '  volume = {521},',
    '  number = {7553},',
    '  pages = {436--444},',
    '  year = {2015},',
    '  doi = {10.1038/nature14539},',
    '}',
  ].join('\n')
  const got = formatEntry(entry)
  check('formatEntry renderiza exactamente una entrada completa en el orden canónico nuevo', got === expected, `\n${got}`)
}
{
  const entry: BibEntry = {
    type: 'inproceedings',
    key: 'vaswani2017attention',
    sourceKind: 'arxiv',
    sourceId: '1706.03762',
    reviewable: true,
    fields: {
      primaryClass: 'cs.CL',
      year: '2017',
      url: 'https://arxiv.org/abs/1706.03762',
      booktitle: 'Advances in Neural Information Processing Systems',
      eprint: '1706.03762',
      title: 'Attention is all you need',
      author: 'Vaswani, Ashish',
      archivePrefix: 'arXiv',
      pages: '5998--6008',
    },
  }
  const expected = [
    '@inproceedings{vaswani2017attention,',
    '  author = {Vaswani, Ashish},',
    '  title = {Attention is all you need},',
    '  booktitle = {Advances in Neural Information Processing Systems},',
    '  pages = {5998--6008},',
    '  year = {2017},',
    '  url = {https://arxiv.org/abs/1706.03762},',
    '  eprint = {1706.03762},',
    '  archivePrefix = {arXiv},',
    '  primaryClass = {cs.CL},',
    '}',
  ].join('\n')
  const got = formatEntry(entry)
  check(
    'formatEntry ordena los campos según el orden canónico aunque vengan desordenados',
    got === expected,
    `\n${got}`,
  )
}
{
  const entry: BibEntry = {
    type: 'book',
    key: 'knuth1968art',
    sourceKind: 'isbn',
    sourceId: '9780201896831',
    reviewable: false,
    fields: {
      Zebra: 'ultimo',
      isbn: '9780201896831',
      abstract: 'primero extra',
      keywords: 'algoritmos',
      publisher: 'Addison-Wesley',
      title: 'The Art of Computer Programming',
      author: 'Knuth, Donald E.',
      year: '1968',
      note: '',
    },
  }
  const expected = [
    '@book{knuth1968art,',
    '  author = {Knuth, Donald E.},',
    '  title = {The Art of Computer Programming},',
    '  publisher = {Addison-Wesley},',
    '  year = {1968},',
    '  isbn = {9780201896831},',
    '  abstract = {primero extra},',
    '  keywords = {algoritmos},',
    '  zebra = {ultimo},',
    '}',
  ].join('\n')
  const got = formatEntry(entry)
  check(
    'formatEntry normaliza y ordena campos desconocidos al final en minúscula y omite vacíos',
    got === expected,
    `\n${got}`,
  )
}
// T29, T30, T31, T32, T33, T34 y validación de clave
{
  const emptyEntry: BibEntry = {
    type: 'misc',
    key: 'k',
    sourceKind: 'doi',
    sourceId: '10.1000/x',
    reviewable: false,
    fields: {},
  }
  check('T29: formatEntry con fields vacío devuelve "@misc{k,\\n}"', formatEntry(emptyEntry) === '@misc{k,\n}')
}
{
  const entry: BibEntry = {
    type: 'unpublished',
    key: 'test2024',
    sourceKind: 'pmid',
    sourceId: '12345678',
    reviewable: false,
    fields: {
      Title: '  Primer título  ',
      title: 'Segundo título',
      primaryclass: 'cs.AI',
      month: 'May',
      year: '2024',
      note: '   ',
      author: '  Doe, Jane  ',
    },
  }
  const expected = [
    '@unpublished{test2024,',
    '  author = {Doe, Jane},',
    '  title = {Primer título},',
    '  month = {May},',
    '  year = {2024},',
    '  primaryClass = {cs.AI},',
    '}',
  ].join('\n')
  const got = formatEntry(entry)
  check(
    'T30-T33: formatEntry omite campos de solo espacios, deduplica Title/title quedándose con el primero, recorta valores y ubica month/primaryClass',
    got === expected,
    `\n${got}`,
  )
}
{
  const a: BibEntry = {
    type: 'inbook',
    key: 'a2020',
    sourceKind: 'isbn',
    sourceId: '9780306406157',
    reviewable: false,
    fields: { author: 'A', title: 'T1', chapter: '3', year: '2020' },
  }
  const b: BibEntry = {
    type: 'proceedings',
    key: 'b2021',
    sourceKind: 'doi',
    sourceId: '10.1000/b',
    reviewable: false,
    fields: { editor: 'B', title: 'T2', organization: 'Org', year: '2021' },
  }
  const joined = `${formatEntry(a)}\n\n${formatEntry(b)}`
  check(
    'T34: dos entradas unidas con "\\n\\n" no tienen líneas en blanco de más',
    !joined.startsWith('\n') && !joined.endsWith('\n') && !joined.includes('\n\n\n'),
    `\n${joined}`,
  )
}
{
  let threw = false
  try {
    formatEntry({
      type: 'misc',
      key: 'clave con espacio',
      sourceKind: 'doi',
      sourceId: '10.1000/x',
      reviewable: false,
      fields: {},
    })
  } catch {
    threw = true
  }
  check('formatEntry lanza Error si la clave BibTeX es inválida', threw)
}

if (failed > 0) process.exit(1)
console.log(`\nbibtex: ${passed} comprobaciones pasaron.`)
