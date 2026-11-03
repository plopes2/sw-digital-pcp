import readXlsxFile from 'read-excel-file/browser'
import { repararArquivo } from './repararXlsx.js'

/* ------------------------------------------------------------------
 * Definição de cada tipo de carga: colunas esperadas (com apelidos) e regras.
 * O cabeçalho é localizado automaticamente (pode haver linhas de filtro acima,
 * como nos exports do BI) e os nomes são comparados sem acento/maiúscula.
 * ------------------------------------------------------------------ */

export const TIPOS = {
  pedidos: {
    titulo: 'Pedidos em carteira',
    origem: 'Export do BI (Kiwi) — arquivo "Pedidos em carteira"',
    campos: {
      material: { nomes: ['material'], tipo: 'texto', obrigatorio: true },
      numero_pedido: { nomes: ['numero do pedido', 'pedido'], tipo: 'texto' },
      // "Tipo de ordem" do BI é IGNORADO de propósito: não é lido, validado, gravado nem usado em nenhum cálculo.
      cliente: { nomes: ['cliente'], tipo: 'texto' },
      papelao: { nomes: ['papelao'], tipo: 'texto' },
      qtde_lotes: { nomes: ['lote'], tipo: 'int' },
      saldo: { nomes: ['saldo'], tipo: 'num' },
      qtde_produzida: { nomes: ['quantidade produzida'], tipo: 'num' },
      area_pedido: { nomes: ['area pedido'], tipo: 'num' },
      // M linear vazio NÃO bloqueia: o pedido entra e o material é avisado ("sem metro linear cadastrado" → cadastrar bobina no Kiwi)
      m_linear: { nomes: ['m linear'], tipo: 'num' },
      data_entrega: { nomes: ['data de entrega'], tipo: 'data', obrigatorio: true },
      data_onduladeira: { nomes: ['data onduladeira'], tipo: 'data', obrigatorio: true },
      data_cadastro: { nomes: ['data de cadastro'], tipo: 'data' },
      status_onduladeira: { nomes: ['status de onduladeira'], tipo: 'texto' },
      status_pedido: { nomes: ['status do pedido'], tipo: 'texto', obrigatorio: true },
    },
    chave: 'material',
    valida() {},
    resumo: (ls) => `${ls.length} pedidos · ${new Set(ls.map((l) => l.material)).size} materiais`,
  },
  estoque_bobinas: {
    titulo: 'Estoque de bobinas',
    origem: 'Export do BI (Kiwi) — arquivo "Estoque Bobinas" · única base de estoque (MTO e contratos MTS)',
    campos: {
      sku_bobina: { nomes: ['codigo papel', 'sku bobina', 'codigo'], tipo: 'texto', obrigatorio: true },
      classificacao_bobina: { nomes: ['classificacao bobina'], tipo: 'texto', obrigatorio: true },
      material: { nomes: ['material'], tipo: 'texto' },
      planta: { nomes: ['planta'], tipo: 'texto' },
      qtde_lotes: { nomes: ['lote'], tipo: 'num' },
      m_linear: { nomes: ['m lineares', 'm linear'], tipo: 'num', obrigatorio: true },
      caixas_previstas: { nomes: ['caixas previstas'], tipo: 'num' },
    },
    chave: 'sku_bobina',
    valida(l, erro) {
      const c = (l.classificacao_bobina || '').toLowerCase()
      if (c === 'bobina') l.classificacao_bobina = 'Bobina'
      else if (c === 'toco') l.classificacao_bobina = 'Toco'
      else erro(`Classificação "${l.classificacao_bobina}" inválida (esperado Bobina ou Toco)`)
    },
    resumo: (ls) => `${ls.length} linhas · ${num(ls.reduce((a, l) => a + (l.m_linear || 0), 0))} m lineares`,
  },
  estoque_papel: {
    titulo: 'Estoque de papel',
    origem: 'Tabela dinâmica do SAP — "Row Labels" (código do papel) e "Contagem de Lote"',
    campos: {
      papel_codigo: { nomes: ['row labels', 'rotulos de linha', 'codigo papel', 'papel', 'codigo'], tipo: 'texto', obrigatorio: true },
      qtde_lotes: { nomes: ['contagem de lote', 'count of lote', 'qtde lotes', 'lotes', 'quantidade'], tipo: 'int', obrigatorio: true },
    },
    chave: 'papel_codigo',
    valida(l, erro) {
      if (!/^\d{10}$/.test(l.papel_codigo)) return 'ignorar' // ex.: "Grand Total"
      if (l.qtde_lotes == null) erro('Quantidade de lotes vazia')
    },
    resumo: (ls) => `${ls.length} códigos de papel · ${ls.reduce((a, l) => a + (l.qtde_lotes || 0), 0)} lotes`,
  },
}

export const ORDEM_TIPOS = ['pedidos', 'estoque_bobinas', 'estoque_papel']

function num(n) { return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) }

/* ---------- normalização ---------- */
export function normCab(v) {
  let s = String(v ?? '').trim()
  const m = s.match(/\[([^\]]+)\]\s*$/)
  if (m) s = m[1]
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  s = s.replace(/^(count of|sum of|first|last|average of|min of|max of)\s+/, '')
  s = s.replace(/[^a-z0-9]+/g, ' ').trim()
  return s
}

const vazio = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

function toTexto(v) {
  if (vazio(v)) return null
  if (v instanceof Date) return null
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v)
  return String(v).replace(/ /g, ' ').trim() || null
}
function toNum(v) {
  if (vazio(v)) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    let s = v.trim()
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.') // 1.234,5
    else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.')
    const n = Number(s)
    return Number.isFinite(n) ? n : NaN
  }
  return NaN
}
function toData(v) {
  if (vazio(v)) return null
  if (v instanceof Date) {
    const d = new Date(v.getTime() + 500) // a biblioteca devolve 08:00 como 07:59:59.999
    return d.toISOString().slice(0, 10)
  }
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    if (/^\d{4}-\d{2}-\d{2}/.test(v.trim())) return v.trim().slice(0, 10)
  }
  return 'INVALIDA'
}

/* ---------- leitura e validação ---------- */
export async function lerArquivo(file, tipo) {
  const def = TIPOS[tipo]
  const nomesCampos = Object.entries(def.campos)
  const obrig = nomesCampos.filter(([, c]) => c.obrigatorio).map(([k]) => k)

  let planilhas
  try {
    planilhas = await readXlsxFile(await repararArquivo(file))
  } catch (e) {
    throw new Error(`Não consegui abrir o arquivo. Ele precisa ser .xlsx (Excel). (detalhe técnico: ${e?.message || e})`)
  }

  // procura, em todas as abas, a linha de cabeçalho que contém as colunas obrigatórias
  let achou = null
  for (const pl of planilhas) {
    const dados = pl.data
    for (let i = 0; i < Math.min(dados.length, 30); i++) {
      const norm = dados[i].map(normCab)
      const map = {}
      for (const [campo, c] of nomesCampos) {
        const idx = norm.findIndex((n) => c.nomes.includes(n))
        if (idx >= 0) map[campo] = idx
      }
      if (obrig.every((k) => map[k] !== undefined)) { achou = { aba: pl.sheet, i, map, dados }; break }
    }
    if (achou) break
  }
  if (!achou) {
    const falta = obrig.map((k) => def.campos[k].nomes[0])
    throw new Error(`Não encontrei as colunas esperadas. Preciso de um cabeçalho com: ${falta.join(', ')}.`)
  }

  const { map, dados, i: iCab } = achou
  const linhas = []
  const erros = []
  let ignoradas = 0
  let lidas = 0 // linhas com algum conteúdo abaixo do cabeçalho (só informativo)

  for (let r = iCab + 1; r < dados.length; r++) {
    const bruto = dados[r]
    if (bruto.every(vazio)) continue
    lidas++
    const l = {}
    const errosLinha = []
    const erro = (m) => errosLinha.push(m)
    for (const [campo, c] of nomesCampos) {
      const idx = map[campo]
      const v = idx === undefined ? null : bruto[idx]
      if (c.tipo === 'texto') l[campo] = toTexto(v)
      else if (c.tipo === 'num' || c.tipo === 'int') {
        const n = toNum(v)
        if (Number.isNaN(n)) { erro(`"${def.campos[campo].nomes[0]}" não é número (${String(v)})`); l[campo] = null }
        else l[campo] = c.tipo === 'int' && n !== null ? Math.round(n) : n
      } else if (c.tipo === 'data') {
        const d = toData(v)
        if (d === 'INVALIDA') { erro(`"${def.campos[campo].nomes[0]}" não é data (${String(v)})`); l[campo] = null }
        else l[campo] = d
      }
    }
    // linha sem o identificador principal (totais, linhas em branco): ignora
    if (!l[def.chave]) { ignoradas++; continue }
    const r2 = def.valida(l, erro)
    if (r2 === 'ignorar') { ignoradas++; continue }
    for (const k of obrig) if (l[k] === null || l[k] === undefined) erro(`Falta "${def.campos[k].nomes[0]}"`)
    if (errosLinha.length) { erros.push({ linha: r + 1, msg: errosLinha.join('; ') }); continue }
    linhas.push(l)
  }

  const avisos = []
  if (ignoradas) avisos.push(`${ignoradas} linha(s) sem identificador ou de total foram ignoradas.`)
  if (tipo === 'pedidos') {
    const semData = linhas.filter((l) => !l.data_onduladeira).length
    if (semData) avisos.push(`${semData} pedido(s) sem Data onduladeira.`)
    // um aviso por material sem metro linear (a análise mostra "CADASTRAR BOBINA KIWI")
    const semM = new Map()
    for (const l of linhas) if (l.m_linear === null) semM.set(l.material, [...(semM.get(l.material) || []), l.numero_pedido || 's/ nº'])
    const mats = [...semM.keys()].sort()
    for (const m of mats.slice(0, 40)) {
      const peds = semM.get(m)
      avisos.push(`Material ${m} sem metro linear cadastrado — cadastrar a bobina no Kiwi (${peds.length} pedido${peds.length > 1 ? 's' : ''}: ${peds.slice(0, 5).join(', ')}${peds.length > 5 ? '…' : ''})`)
    }
    if (mats.length > 40) avisos.push(`… e mais ${mats.length - 40} material(is) sem metro linear cadastrado.`)
  }

  return {
    aba: achou.aba,
    colunas: Object.fromEntries(Object.keys(map).map((k) => [k, String(dados[iCab][map[k]]).replace(/\s+/g, ' ').trim()])),
    linhas,
    lidas,
    erros,
    avisos,
    resumo: linhas.length ? def.resumo(linhas) : '',
  }
}
