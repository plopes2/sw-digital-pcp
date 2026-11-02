import readXlsxFile from 'read-excel-file/browser'
import { normCab } from './importacao.js'
import { supabase } from './supabase.js'

const vazio = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
const txt = (v) => {
  if (vazio(v) || v instanceof Date) return null
  const s = String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
  return s === '' || s.startsWith('#') ? null : s
}
const numero = (v) => {
  if (vazio(v)) return null
  if (typeof v === 'number') return v
  const n = Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Lê a aba DADOS da planilha de Programação (RG.PP-002, .xlsm/.xlsx) e devolve os clichês.
 * SKU repetido = versões: a ordem na aba define a versão (1, 2, 3...); a última é a vigente
 * (igual ao XLOOKUP da planilha, que pega a última ocorrência).
 */
export async function lerDadosCliches(file) {
  let planilhas
  try { planilhas = await readXlsxFile(file) } catch { throw new Error('Não consegui abrir o arquivo. Envie a planilha de Programação (.xlsm ou .xlsx).') }
  const aba = planilhas.find((p) => normCab(p.sheet) === 'dados')
  if (!aba) throw new Error('Não encontrei a aba "DADOS" nesse arquivo.')
  const dados = aba.data
  const iCab = dados.findIndex((r, i) => i < 30 && normCab(r[0]) === 'sku' && r.some((c) => normCab(c) === 'cliente'))
  if (iCab < 0) throw new Error('Não encontrei o cabeçalho (SKU, Cliente, Rótulo...) na aba DADOS.')
  const cab = dados[iCab].map(normCab)
  const col = (nome) => cab.findIndex((n) => n === nome)
  const iSku = col('sku'), iCli = col('cliente'), iRot = col('rotulo'), iFmt = col('formato'), iCam = col('camisa'), iAda = col('adaptador')
  const iObs = col('observacao'), iSta = col('status'), iFsc = cab.findIndex((n) => n.startsWith('possui selo fsc'))
  const cores = []
  for (let k = 1; k <= 9; k++) {
    const i = cab.findIndex((n) => n === `cor ${k}`)
    if (i >= 0) cores.push({ pos: k, cor: i, anilox: i + 1, litros: i + 2 })
  }
  if (iRot < 0 || iCam < 0 || cores.length === 0) throw new Error('A aba DADOS não tem as colunas esperadas (Rótulo, Camisa, COR #1...).')

  const linhas = []
  const contador = new Map()
  let ignoradas = 0
  const amostraIgnoradas = []
  for (let r = iCab + 1; r < dados.length; r++) {
    const b = dados[r]
    const sku = txt(b[iSku])?.toUpperCase()
    if (!sku) continue
    // o SKU é a chave exata da planilha (há C205748B/1, C147972B#, 23PZ2613/2...). Só saem linhas de teste e SKUs inválidos.
    if (sku.length < 5 || /^99\d{3}B$/.test(sku) || (txt(b[iCli]) || '').toUpperCase() === 'TESTE') { ignoradas++; if (amostraIgnoradas.length < 5) amostraIgnoradas.push(sku); continue }
    const versao = (contador.get(sku) || 0) + 1
    contador.set(sku, versao)
    const st = (txt(b[iSta]) || '').toLowerCase()
    const fsc = (txt(b[iFsc]) || '').toLowerCase()
    linhas.push({
      sku, versao,
      cliente: txt(b[iCli]),
      rotulo: txt(b[iRot]),
      formato: numero(b[iFmt]) != null ? Math.round(numero(b[iFmt])) : null,
      camisa: txt(b[iCam]),
      adaptador: txt(b[iAda]),
      status: st === 'ativo' ? 'ativo' : st === 'obsoleto' ? 'obsoleto' : null,
      possui_fsc: fsc.startsWith('sim') ? true : fsc.startsWith('n') ? false : null,
      observacao: txt(b[iObs]),
      cores: cores.map((c) => ({ pos: c.pos, cor: txt(b[c.cor]), anilox: txt(b[c.anilox]), litros: numero(b[c.litros]) })).filter((c) => c.cor),
    })
  }
  const avisos = []
  if (ignoradas) avisos.push(`${ignoradas} linha(s) de teste ou com SKU inválido (ex.: ${amostraIgnoradas.join(', ')}) foram ignoradas.`)
  const multi = [...contador.values()].filter((v) => v > 1).length
  return {
    linhas, avisos,
    resumo: `${linhas.length} linhas · ${contador.size} clichês · ${multi} com mais de uma versão · ${new Set(linhas.map((l) => (l.cliente || '').toUpperCase())).size} nomes de cliente`,
  }
}

/** Envia em blocos (cumulativo/idempotente) e soma os retornos. */
export async function enviarCliches(linhas, aoProgredir) {
  const tot = { novos: 0, atualizados: 0, clientes_novos: 0, camisas_novas: 0, adaptadores_novos: 0 }
  const TAM = 120
  for (let i = 0; i < linhas.length; i += TAM) {
    const { data, error } = await supabase.schema('cadastro').rpc('importar_cliches', { p_linhas: linhas.slice(i, i + TAM) })
    if (error) throw new Error(`Falhou no bloco a partir da linha ${i + 1}: ${error.message}`)
    Object.keys(tot).forEach((k) => { tot[k] += data[k] || 0 })
    aoProgredir?.(Math.min(i + TAM, linhas.length), linhas.length)
  }
  return tot
}
