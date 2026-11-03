/* Repara .xlsx exportados direto do Power BI / Kiwi cujas células vêm SEM o endereço r="A1".
   O Excel aceita (usa a posição), mas a biblioteca de leitura (read-excel-file) quebra.
   Só acrescenta os endereços que faltam: arquivos que já têm endereço voltam idênticos
   (mesmos bytes), e valores, estilos e fórmulas nunca são alterados. */
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'

const letras = (n) => {
  let s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}
const numero = (L) => L.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0)

// há alguma célula <c ...> sem r="..."?
const faltaEndereco = (xml) => /<c\b(?![^>]*\sr=")[^>]*>/.test(xml)

export function repararPlanilhaXml(xml) {
  if (!faltaEndereco(xml)) return xml
  let linhaSeq = 0
  return xml.replace(/<row\b([^>]*?)(\/?)>([\s\S]*?)(?=<row\b|<\/sheetData>)/g, (_, attrs, fecha, resto) => {
    const mr = attrs.match(/\sr="(\d+)"/)
    const nLinha = mr ? parseInt(mr[1], 10) : ++linhaSeq
    if (mr) linhaSeq = nLinha
    const attrsLinha = mr ? attrs : `${attrs} r="${nLinha}"`
    let col = 0
    const corpo = resto.replace(/<c\b([^>]*?)(\/?)>/g, (c, a, auto) => {
      const mc = a.match(/\sr="([A-Z]+)\d+"/)
      if (mc) { col = numero(mc[1]); return c }
      col += 1
      return `<c r="${letras(col)}${nLinha}"${a}${auto}>`
    })
    return `<row${attrsLinha}${fecha}>${corpo}`
  })
}

/** bytes (Uint8Array) → bytes; devolve o MESMO objeto se não precisou mudar nada */
export function repararXlsx(bytes) {
  const arquivos = unzipSync(bytes)
  let mudou = false
  for (const nome of Object.keys(arquivos)) {
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(nome)) continue
    const xml = strFromU8(arquivos[nome])
    const novo = repararPlanilhaXml(xml)
    if (novo !== xml) { arquivos[nome] = strToU8(novo); mudou = true }
  }
  return mudou ? zipSync(arquivos) : bytes
}

/** File/Blob → File/Blob pronto para o read-excel-file. Se não for um zip válido, devolve o original
    (a leitura seguinte mostra o erro de verdade). */
export async function repararArquivo(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const rep = repararXlsx(bytes)
    return rep === bytes ? file : new Blob([rep], { type: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  } catch {
    return file
  }
}
