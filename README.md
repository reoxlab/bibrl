# bibRL

Conversor DOI / arXiv / ISBN / PMID a BibTeX, con validación de archivos `.bib`.
Hecho en Reox Lab.

- **Ruta:** `/herramientas/bibrl/`
- **Stack:** TypeScript, Vite, rl-ui, Nginx + Docker
- **Licencia:** GPL v3 (`GPL-3.0-or-later`)

## Qué hace

**Pestaña «Importar identificadores»:** pegas hasta 50 identificadores, uno por
línea, mezclados — DOI (`10.…`), ID de arXiv (`2301.12345` o `hep-th/9901001`),
ISBN (10 o 13, con o sin guiones) y PMID — y bibRL busca sus metadatos y genera
una entrada BibTeX por cada uno, en el orden pegado. Cada línea muestra su
estado (pendiente, encontrado o fallido, con el motivo del fallo) y cada entrada
se puede revisar antes de copiarla. Los duplicados (mismo DOI o mismo arXiv dos
veces) se generan una sola vez y se avisa qué línea era duplicada. Al final
puedes copiar todo el `.bib` o descargarlo como `bibrl.bib`.

**Pestaña «Validar .bib»:** pegas un archivo `.bib` existente (o lo cargas desde
disco) y bibRL lo analiza sin tocar las fuentes: claves repetidas, entradas
duplicadas (mismo DOI o mismo título+autor), campos obligatorios que faltan según
el tipo de entrada (`article` sin `journal`, `book` sin `publisher`…), llaves sin
cerrar y campos vacíos. El informe lista los problemas numerados con su línea
aproximada, y puedes descargar el `.bib` con las claves duplicadas renumeradas
(`autor2020a`, `autor2020b`).

## Claves y formato

Las claves siguen el estilo `apellidoAñoPalabra` (p. ej. `lecun2015deep`). Los
caracteres especiales se escapan para LaTeX, las tildes se protegen entre llaves
(`{\'a}`, `{\~n}`) y las siglas quedan protegidas (`{NASA}`, `{LaTeX}`) para que
BibTeX no las pase a minúsculas. Los títulos con matemática LaTeX (`$…$`) se
conservan tal cual. Si una entrada no trae año, la clave usa `sinano`; si no
trae autor, `sinautor`.

## Fuentes de metadatos

| Fuente | Identificador |
|---|---|
| Crossref | DOI |
| arXiv | ID de arXiv |
| OpenLibrary | ISBN |
| Europe PMC | PMID |

Las consultas a Crossref, OpenLibrary y Europe PMC salen directamente desde el
navegador del usuario. arXiv se consulta a través de un proxy same-origin en
nginx (`/herramientas/bibrl/api/arxiv/`) porque su API no envía cabeceras CORS;
el proxy no guarda nada y no añade ninguna clave. La app no tiene backend de
aplicación ni guarda datos entre sesiones.

## Desarrollo local

Requisitos: Node.js 20+.

```bash
npm install
npm run dev      # servidor local de desarrollo
npm test         # pruebas unitarias
npm run build    # verificación de tipos y paquete de producción en dist/
```

Las pruebas usan `esbuild` para empaquetar cada archivo `tests/test-*.ts` y
ejecutarlo con Node; no hace falta ningún framework de testing.

## Licencia

bibRL es software libre bajo la licencia **GNU General Public License v3.0 o
posterior** (`GPL-3.0-or-later`). Consulta el archivo [LICENSE](LICENSE) para
más detalles.
